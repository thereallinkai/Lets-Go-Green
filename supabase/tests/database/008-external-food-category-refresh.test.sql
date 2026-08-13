begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

select has_function(
  'public',
  'cache_external_food',
  array[
    'food_source_provider',
    'text',
    'jsonb',
    'jsonb',
    'jsonb',
    'jsonb'
  ],
  'the serialized external-food cache wrapper exists'
);

select has_function(
  'private',
  'cache_external_food_without_category_replacement',
  array[
    'food_source_provider',
    'text',
    'jsonb',
    'jsonb',
    'jsonb',
    'jsonb'
  ],
  'the original cache implementation is private'
);

select ok(
  (
    select
      procedure_entry.prosecdef
      and coalesce(array_to_string(procedure_entry.proconfig, ','), '')
        like '%search_path=""%'
      and pg_catalog.has_function_privilege(
        'service_role',
        procedure_entry.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'anon',
        procedure_entry.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated',
        procedure_entry.oid,
        'EXECUTE'
      )
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = to_regprocedure(
      'public.cache_external_food(public.food_source_provider,text,jsonb,jsonb,jsonb,jsonb)'
    )
  ),
  'only the trusted service can execute the hardened public cache wrapper'
);

select ok(
  (
    select
      procedure_entry.prosecdef
      and coalesce(array_to_string(procedure_entry.proconfig, ','), '')
        like '%search_path=""%'
      and not pg_catalog.has_function_privilege(
        'anon',
        procedure_entry.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated',
        procedure_entry.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role',
        procedure_entry.oid,
        'EXECUTE'
      )
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = to_regprocedure(
      'private.cache_external_food_without_category_replacement(public.food_source_provider,text,jsonb,jsonb,jsonb,jsonb)'
    )
  ),
  'no API or service role can bypass category replacement through the private helper'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
set local role service_role;

select lives_ok(
  $$
    select public.cache_external_food(
      'open_food_facts',
      'category-refresh-fixture',
      '{
        "slug": "category-refresh-fixture",
        "english_name": "Category Refresh Fixture",
        "food_kind": "branded_product",
        "brand_name": "Fixture Brand",
        "product_name": "Fixture Product",
        "category_slugs": ["protein", "supplement"]
      }'::jsonb,
      '{
        "measurement_basis": "as_sold",
        "reference_quantity": 100,
        "reference_unit": "g",
        "calories": 120,
        "protein_g": 20,
        "carbohydrate_g": 4,
        "fat_g": 2
      }'::jsonb,
      jsonb_build_object(
        'source_name', 'Open Food Facts',
        'source_reference', 'Category refresh fixture',
        'parser_version', 'category-test-v1',
        'payload_sha256', repeat('a', 64)
      ),
      '{"version":1}'::jsonb
    )
  $$,
  'the trusted cache creates the initial provider-owned category set'
);

reset role;

select is(
  (
    select array_agg(category.slug order by category.slug)
    from public.food_sources source
    join public.food_category_links mapping on mapping.food_id = source.food_id
    join public.food_categories category on category.id = mapping.category_id
    where source.provider = 'open_food_facts'
      and source.external_id = 'category-refresh-fixture'
  ),
  array['protein', 'supplement']::text[],
  'the first provider snapshot owns both reported categories'
);

set local role service_role;

select lives_ok(
  $$
    select public.cache_external_food(
      'open_food_facts',
      'category-refresh-fixture',
      '{
        "slug": "category-refresh-fixture",
        "english_name": "Category Refresh Fixture v2",
        "food_kind": "branded_product",
        "brand_name": "Fixture Brand",
        "product_name": "Fixture Product",
        "category_slugs": ["protein"]
      }'::jsonb,
      '{
        "measurement_basis": "as_sold",
        "reference_quantity": 100,
        "reference_unit": "g",
        "calories": 121,
        "protein_g": 21,
        "carbohydrate_g": 4,
        "fat_g": 2
      }'::jsonb,
      jsonb_build_object(
        'source_name', 'Open Food Facts',
        'source_reference', 'Category refresh fixture',
        'parser_version', 'category-test-v1',
        'payload_sha256', repeat('b', 64)
      ),
      '{"version":2}'::jsonb
    )
  $$,
  'a later provider snapshot refreshes the same source record'
);

reset role;

select is(
  (
    select array_agg(category.slug order by category.slug)
    from public.food_sources source
    join public.food_category_links mapping on mapping.food_id = source.food_id
    join public.food_categories category on category.id = mapping.category_id
    where source.provider = 'open_food_facts'
      and source.external_id = 'category-refresh-fixture'
  ),
  array['protein']::text[],
  'a pending source record does not retain a stale provider category'
);

update public.foods food
set verification_status = 'verified', catalog_status = 'active'
from public.food_sources source
where source.food_id = food.id
  and source.provider = 'open_food_facts'
  and source.external_id = 'category-refresh-fixture';

insert into public.food_category_links (food_id, category_id)
select source.food_id, category.id
from public.food_sources source
cross join public.food_categories category
where source.provider = 'open_food_facts'
  and source.external_id = 'category-refresh-fixture'
  and category.slug = 'supplement'
on conflict (food_id, category_id) do nothing;

set local role service_role;

select lives_ok(
  $$
    select public.cache_external_food(
      'open_food_facts',
      'category-refresh-fixture',
      '{
        "slug": "category-refresh-fixture-overwrite-attempt",
        "english_name": "Untrusted overwrite attempt",
        "food_kind": "branded_product",
        "brand_name": "Fixture Brand",
        "product_name": "Fixture Product",
        "category_slugs": ["protein"]
      }'::jsonb,
      '{
        "measurement_basis": "as_sold",
        "reference_quantity": 100,
        "reference_unit": "g",
        "calories": 999,
        "protein_g": 1,
        "carbohydrate_g": 1,
        "fat_g": 1
      }'::jsonb,
      jsonb_build_object(
        'source_name', 'Open Food Facts',
        'source_reference', 'Category refresh fixture',
        'parser_version', 'category-test-v1',
        'payload_sha256', repeat('c', 64)
      ),
      '{"version":3}'::jsonb
    )
  $$,
  'a refresh safely returns the reviewed record without rewriting it'
);

reset role;

select is(
  (
    select array_agg(category.slug order by category.slug)
    from public.food_sources source
    join public.food_category_links mapping on mapping.food_id = source.food_id
    join public.food_categories category on category.id = mapping.category_id
    where source.provider = 'open_food_facts'
      and source.external_id = 'category-refresh-fixture'
  ),
  array['protein', 'supplement']::text[],
  'reviewed category mappings remain untouched by later source refreshes'
);

select is(
  (
    select food.english_name
    from public.food_sources source
    join public.foods food on food.id = source.food_id
    where source.provider = 'open_food_facts'
      and source.external_id = 'category-refresh-fixture'
  ),
  'Category Refresh Fixture v2',
  'reviewed food details also remain unchanged by a source refresh'
);

select * from finish();
rollback;
