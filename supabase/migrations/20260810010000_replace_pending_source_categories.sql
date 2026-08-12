begin;

-- Preserve the reviewed implementation as an internal step, then wrap it so
-- repeated source refreshes replace (rather than accumulate) provider-derived
-- categories. The wrapper only changes unreviewed source-reported catalog rows.
alter function public.cache_external_food(
  public.food_source_provider,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) rename to cache_external_food_without_category_replacement;

alter function public.cache_external_food_without_category_replacement(
  public.food_source_provider,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) set schema private;

revoke all on function private.cache_external_food_without_category_replacement(
  public.food_source_provider,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

create function public.cache_external_food(
  source_provider public.food_source_provider,
  source_external_id text,
  normalized_food jsonb,
  normalized_nutrition jsonb,
  source_metadata jsonb,
  source_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_food_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'External food caching is restricted to the trusted server.';
  end if;

  if source_provider is null
    or source_external_id is null
    or char_length(btrim(source_external_id)) not between 1 and 240
  then
    raise exception using
      errcode = '22023',
      message = 'The external food payload is invalid.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'external-food-cache:' || source_provider::text || ':' ||
        btrim(source_external_id),
      0
    )
  );

  result_food_id := private.cache_external_food_without_category_replacement(
    source_provider,
    source_external_id,
    normalized_food,
    normalized_nutrition,
    source_metadata,
    source_snapshot
  );

  delete from public.food_category_links mapping
  using public.foods food, public.food_categories category
  where mapping.food_id = result_food_id
    and food.id = mapping.food_id
    and category.id = mapping.category_id
    and food.ownership_type = 'catalog'
    and food.verification_status = 'source_reported'
    and food.catalog_status = 'pending_review'
    and not exists (
      select 1
      from jsonb_array_elements_text(
        coalesce(normalized_food -> 'category_slugs', '[]'::jsonb)
      ) requested(slug)
      where requested.slug = category.slug
    );

  return result_food_id;
end;
$$;

revoke all on function public.cache_external_food(
  public.food_source_provider,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.cache_external_food(
  public.food_source_provider,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to service_role;

comment on function public.cache_external_food(
  public.food_source_provider,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) is
  'Serializes provider refreshes and replaces categories only while a source-reported catalog record remains pending review.';

commit;
