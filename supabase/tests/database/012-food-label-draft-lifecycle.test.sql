begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(23);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'a6100000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'label-draft-owner@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a6200000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'label-draft-other-owner@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

create temporary table pg_temp.label_test_payloads (
  name text primary key,
  data jsonb not null
);

insert into pg_temp.label_test_payloads (name, data)
values (
  'valid',
  '{
    "brandName": "Lifecycle Brand",
    "productName": "Lifecycle Protein",
    "variantName": "Chocolate",
    "gtin": "",
    "packageDescription": "10 servings",
    "servingWeightGrams": 30,
    "servingDescription": "1 scoop",
    "calories": 120,
    "proteinGrams": 22,
    "carbohydrateGrams": 4,
    "fatGrams": 2,
    "ingredientsText": "Pea protein, cocoa.",
    "allergenStatement": "No declared allergens.",
    "categorySlugs": ["protein"],
    "allergenSlugs": [],
    "restrictionSlugs": [],
    "sourceNote": "",
    "shareNormalizedProduct": false,
    "allergensReviewed": true,
    "restrictionsReviewed": true,
    "confirmedAccurate": false
  }'::jsonb
);

insert into pg_temp.label_test_payloads (name, data)
select 'mismatch', data || '{"productName":"Different Protein"}'::jsonb
from pg_temp.label_test_payloads
where name = 'valid'
union all
select 'unknown-key', data || '{"unexpectedValue":true}'::jsonb
from pg_temp.label_test_payloads
where name = 'valid'
union all
select 'out-of-range', data || '{"calories":10001}'::jsonb
from pg_temp.label_test_payloads
where name = 'valid'
union all
select 'unknown-category', data || '{"categorySlugs":["not-a-category"]}'::jsonb
from pg_temp.label_test_payloads
where name = 'valid'
union all
select
  'missing-allergens',
  data || '{"allergenStatement":"Contains eggs and almonds."}'::jsonb
from pg_temp.label_test_payloads
where name = 'valid';

grant select on pg_temp.label_test_payloads to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a6100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select ok(
  (
    select status = 'draft' and not replayed
    from public.create_food_label_draft(
      'a6300000-0000-4000-8000-000000000001',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'valid'
      )
    )
  ),
  'an authenticated owner can create one validated private-label draft'
);

select is(
  (
    select replayed
    from public.create_food_label_draft(
      'a6300000-0000-4000-8000-000000000001',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'valid'
      )
    )
  ),
  true,
  'an exact lost-response replay returns the existing draft'
);

select throws_ok(
  $$
    select public.create_food_label_draft(
      'a6300000-0000-4000-8000-000000000001',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'mismatch'
      )
    )
  $$,
  '22023',
  'LABEL_DRAFT_REPLAY_MISMATCH',
  'a reused draft ID cannot replace the saved payload'
);

select throws_ok(
  $$
    select public.create_food_label_draft(
      'a6300000-0000-4000-8000-000000000011',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'unknown-key'
      )
    )
  $$,
  '22023',
  'FOOD_LABEL_DRAFT_INVALID_DATA',
  'database validation rejects unknown private-label keys'
);

select throws_ok(
  $$
    select public.create_food_label_draft(
      'a6300000-0000-4000-8000-000000000012',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'out-of-range'
      )
    )
  $$,
  '22023',
  'FOOD_LABEL_DRAFT_INVALID_DATA',
  'database validation rejects out-of-range nutrition values'
);

select throws_ok(
  $$
    select public.create_food_label_draft(
      'a6300000-0000-4000-8000-000000000013',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'unknown-category'
      )
    )
  $$,
  '22023',
  'FOOD_LABEL_DRAFT_INVALID_DATA',
  'database validation rejects unknown category identifiers'
);

select throws_ok(
  $$
    select public.create_food_label_draft(
      'a6300000-0000-4000-8000-000000000014',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'missing-allergens'
      )
    )
  $$,
  '22023',
  'FOOD_LABEL_DRAFT_INVALID_DATA',
  'database validation requires plural named allergens to be selected'
);

select throws_ok(
  $$
    insert into public.food_label_submissions (
      id,
      user_id,
      status,
      brand_name,
      product_name,
      label_data
    ) values (
      'a6300000-0000-4000-8000-000000000015',
      'a6100000-0000-4000-8000-000000000001',
      'draft',
      'Bypass Brand',
      'Bypass Product',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'valid'
      )
    )
  $$,
  '42501',
  'permission denied for table food_label_submissions',
  'an authenticated client cannot bypass draft quotas with direct insert'
);

reset role;

insert into storage.objects (id, bucket_id, name)
values (
  'a6400000-0000-4000-8000-000000000001',
  'food-labels',
  'a6100000-0000-4000-8000-000000000001/a6300000-0000-4000-8000-000000000001/a6400000-0000-4000-8000-000000000001.png'
);

insert into public.food_label_images (
  id,
  submission_id,
  user_id,
  object_path,
  image_kind,
  mime_type,
  byte_size,
  pixel_width,
  pixel_height,
  sha256
)
values (
  'a6400000-0000-4000-8000-000000000001',
  'a6300000-0000-4000-8000-000000000001',
  'a6100000-0000-4000-8000-000000000001',
  'a6100000-0000-4000-8000-000000000001/a6300000-0000-4000-8000-000000000001/a6400000-0000-4000-8000-000000000001.png',
  'nutrition',
  'image/png',
  1024,
  800,
  800,
  repeat('a', 64)
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select ok(
  (
    select discarded and already_absent and cleanup_queued = 0
    from public.discard_food_label_draft(
      'a6200000-0000-4000-8000-000000000002',
      'a6300000-0000-4000-8000-000000000001'
    )
  ),
  'discarding with another owner ID reveals no cross-account draft details'
);

select ok(
  (
    select discarded and not already_absent and cleanup_queued = 1
    from public.discard_food_label_draft(
      'a6100000-0000-4000-8000-000000000001',
      'a6300000-0000-4000-8000-000000000001'
    )
  ),
  'trusted discard queues the private object before deleting draft metadata'
);

reset role;

select ok(
  not exists (
    select 1
    from public.food_label_submissions
    where id = 'a6300000-0000-4000-8000-000000000001'
  )
    and not exists (
      select 1
      from public.food_label_images
      where submission_id = 'a6300000-0000-4000-8000-000000000001'
    )
    and exists (
      select 1
      from private.food_label_discard_cleanup
      where object_path =
        'a6100000-0000-4000-8000-000000000001/a6300000-0000-4000-8000-000000000001/a6400000-0000-4000-8000-000000000001.png'
    )
    and exists (
      select 1
      from private.food_label_draft_creation_events
      where draft_id = 'a6300000-0000-4000-8000-000000000001'
    )
    and exists (
      select 1
      from storage.objects
      where id = 'a6400000-0000-4000-8000-000000000001'
    ),
  'discard preserves trusted creation and cleanup ledgers until storage deletion succeeds'
);

set local role service_role;

select ok(
  (
    select discarded and already_absent and cleanup_queued = 1
    from public.discard_food_label_draft(
      'a6100000-0000-4000-8000-000000000001',
      'a6300000-0000-4000-8000-000000000001'
    )
  ),
  'a lost discard response can be replayed without losing queued cleanup'
);

select is(
  (
    select pg_catalog.array_agg(object_path order by object_path)
    from public.pending_food_label_object_cleanup(
      'a6100000-0000-4000-8000-000000000001',
      10
    )
  ),
  array[
    'a6100000-0000-4000-8000-000000000001/a6300000-0000-4000-8000-000000000001/a6400000-0000-4000-8000-000000000001.png'
  ]::text[],
  'the owner-scoped cleanup queue returns the discarded private object'
);

reset role;
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where id = 'a6400000-0000-4000-8000-000000000001';
select set_config('storage.allow_delete_query', 'false', true);
set local role service_role;

select is(
  public.complete_food_label_object_cleanup(
    'a6100000-0000-4000-8000-000000000001',
    'a6100000-0000-4000-8000-000000000001/a6300000-0000-4000-8000-000000000001/a6400000-0000-4000-8000-000000000001.png'
  ),
  true,
  'trusted cleanup acknowledges the storage deletion'
);

reset role;

select ok(
  not exists (
    select 1
    from private.food_label_discard_cleanup
    where object_path =
      'a6100000-0000-4000-8000-000000000001/a6300000-0000-4000-8000-000000000001/a6400000-0000-4000-8000-000000000001.png'
  ),
  'successful object deletion clears the durable discard queue entry'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'a6200000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a6200000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    select public.create_food_label_draft(
      'a6300000-0000-4000-8000-000000000001',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'valid'
      )
    )
  $$,
  '23505',
  'LABEL_DRAFT_ID_CONFLICT',
  'a discarded draft ID cannot be reused by another account'
);

select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a6100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select ok(
  (
    select status = 'draft' and not replayed
    from public.create_food_label_draft(
      'a6300000-0000-4000-8000-000000000002',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'valid'
      )
    )
  ),
  'the owner can create another draft after the first is discarded'
);

reset role;

insert into private.food_label_upload_reservations (
  id,
  user_id,
  submission_id,
  image_kind,
  object_path,
  sha256,
  status,
  is_latest,
  created_at,
  updated_at
)
values (
  'a6500000-0000-4000-8000-000000000001',
  'a6100000-0000-4000-8000-000000000001',
  'a6300000-0000-4000-8000-000000000002',
  'nutrition',
  'a6100000-0000-4000-8000-000000000001/a6300000-0000-4000-8000-000000000002/a6500000-0000-4000-8000-000000000001.png',
  repeat('b', 64),
  'reserved',
  true,
  now(),
  now()
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$
    select public.discard_food_label_draft(
      'a6100000-0000-4000-8000-000000000001',
      'a6300000-0000-4000-8000-000000000002'
    )
  $$,
  '55000',
  'LABEL_DRAFT_UPLOAD_IN_PROGRESS',
  'discard cannot race an active upload reservation'
);

reset role;

select ok(
  exists (
    select 1
    from public.food_label_submissions
    where id = 'a6300000-0000-4000-8000-000000000002'
  )
    and exists (
      select 1
      from private.food_label_upload_reservations
      where id = 'a6500000-0000-4000-8000-000000000001'
        and status = 'reserved'
    )
    and not exists (
      select 1
      from private.food_label_discard_cleanup
      where submission_id = 'a6300000-0000-4000-8000-000000000002'
    ),
  'a blocked concurrent discard leaves draft and upload state unchanged'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a6100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    select public.create_food_label_draft(
      pg_catalog.format(
        'a6600000-0000-4000-8000-%s',
        pg_catalog.lpad(draft_number::text, 12, '0')
      )::uuid,
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'valid'
      )
    )
    from pg_catalog.generate_series(1, 7) draft_number
  $$,
  'serialized draft creation admits up to eight active drafts'
);

select throws_ok(
  $$
    select public.create_food_label_draft(
      'a6600000-0000-4000-8000-000000000008',
      (
        select data
        from pg_temp.label_test_payloads
        where name = 'valid'
      )
    )
  $$,
  '54000',
  'LABEL_UPLOAD_RATE_LIMITED',
  'the ninth active draft is rejected inside the database transaction'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.food_label_submissions
    where user_id = 'a6100000-0000-4000-8000-000000000001'
      and status in ('draft', 'needs_changes')
  ),
  8,
  'a rejected quota attempt leaves exactly eight active drafts'
);

select is(
  (
    select count(*)::integer
    from private.food_label_draft_creation_events
    where user_id = 'a6100000-0000-4000-8000-000000000001'
  ),
  9,
  'the trusted rolling ledger retains the discarded creation event'
);

select * from finish();
rollback;
