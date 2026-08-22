begin;

-- Named negative claims such as "contains no milk" must not be converted into
-- positive allergen selections, while contains/may-contain statements remain
-- mandatory. Replace the earlier helper so every confirmation layer agrees.
create or replace function private.food_label_allergens_are_consistent(
  label_data jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  statement_text text;
  selected_slugs text[];
  allergen_words constant text :=
    '(milk|dairy|whey|casein|caseinate|lactalbumin|eggs?|albumen|ovalbumin|fish|anchovy|anchovies|cod|salmon|tuna|shellfish|shrimp|prawn|crab|lobster|crayfish|tree[ -]?nuts?|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil[ -]?nuts?|peanuts?|wheat|spelt|semolina|durum|soy|soya|sesame)';
begin
  if pg_catalog.jsonb_typeof(label_data) is distinct from 'object' then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(
      coalesce(label_data -> 'allergenSlugs', '[]'::jsonb)
    ) is distinct from 'array'
  then
    return false;
  end if;

  if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        coalesce(label_data -> 'allergenSlugs', '[]'::jsonb)
      ) selected
      where pg_catalog.jsonb_typeof(selected) <> 'string'
    ) then
    return false;
  end if;

  statement_text := pg_catalog.lower(
    coalesce(label_data ->> 'allergenStatement', '')
  );
  statement_text := pg_catalog.regexp_replace(
    statement_text,
    '(^|[^[:alnum:]])' || allergen_words
      || '[ -]free([^[:alnum:]]|$)',
    ' ',
    'g'
  );
  statement_text := pg_catalog.regexp_replace(
    statement_text,
    '(^|[^[:alnum:]])(no|without|free[ ]+from)[ ]+'
      || '(declared[ ]+)?' || allergen_words
      || '([ ]*(,|and|or)[ ]*' || allergen_words || ')*',
    ' ',
    'g'
  );

  select coalesce(pg_catalog.array_agg(selected.slug), '{}'::text[])
  into selected_slugs
  from pg_catalog.jsonb_array_elements_text(
    coalesce(label_data -> 'allergenSlugs', '[]'::jsonb)
  ) as selected(slug);

  return not (
    (statement_text ~ '(^|[^[:alnum:]])(milk|dairy|whey|casein|caseinate|lactalbumin)([^[:alnum:]]|$)'
      and not ('milk' = any(selected_slugs)))
    or (statement_text ~ '(^|[^[:alnum:]])(eggs?|albumen|ovalbumin)([^[:alnum:]]|$)'
      and not ('egg' = any(selected_slugs)))
    or (statement_text ~ '(^|[^[:alnum:]])(fish|anchovy|anchovies|cod|salmon|tuna)([^[:alnum:]]|$)'
      and not ('fish' = any(selected_slugs)))
    or (statement_text ~ '(^|[^[:alnum:]])(shellfish|shrimp|prawn|crab|lobster|crayfish)([^[:alnum:]]|$)'
      and not ('shellfish' = any(selected_slugs)))
    or (statement_text ~ '(^|[^[:alnum:]])(tree[ -]?nuts?|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil[ -]?nuts?)([^[:alnum:]]|$)'
      and not ('tree-nuts' = any(selected_slugs)))
    or (statement_text ~ '(^|[^[:alnum:]])peanuts?([^[:alnum:]]|$)'
      and not ('peanuts' = any(selected_slugs)))
    or (statement_text ~ '(^|[^[:alnum:]])(wheat|spelt|semolina|durum)([^[:alnum:]]|$)'
      and not ('wheat' = any(selected_slugs)))
    or (statement_text ~ '(^|[^[:alnum:]])(soy|soya)([^[:alnum:]]|$)'
      and not ('soy' = any(selected_slugs)))
    or (statement_text ~ '(^|[^[:alnum:]])sesame([^[:alnum:]]|$)'
      and not ('sesame' = any(selected_slugs)))
  );
end;
$$;

revoke all on function private.food_label_allergens_are_consistent(jsonb)
  from public, anon, authenticated, service_role;

-- Preserve trusted creation timestamps after an abandoned draft is discarded,
-- so repeated create/discard cycles cannot bypass the rolling daily limit.
create table private.food_label_draft_creation_events (
  draft_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null
);
create index food_label_draft_creation_events_user_time_idx
  on private.food_label_draft_creation_events (user_id, created_at desc);

insert into private.food_label_draft_creation_events (
  draft_id,
  user_id,
  created_at
)
select
  submission.id,
  submission.user_id,
  least(submission.created_at, pg_catalog.clock_timestamp())
from public.food_label_submissions submission
on conflict (draft_id) do nothing;

-- Discard cleanup must outlive the submission and its cascading reservation
-- metadata until the trusted server has deleted every private storage object.
create table private.food_label_discard_cleanup (
  object_path text primary key
    check (pg_catalog.char_length(object_path) between 1 and 1024),
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  queued_at timestamptz not null
);
create index food_label_discard_cleanup_user_time_idx
  on private.food_label_discard_cleanup (user_id, queued_at);

revoke all on private.food_label_draft_creation_events
  from public, anon, authenticated, service_role;
revoke all on private.food_label_discard_cleanup
  from public, anon, authenticated, service_role;

create function private.food_label_payload_is_valid(
  candidate jsonb,
  expected_confirmed boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if candidate is null
    or pg_catalog.jsonb_typeof(candidate) is distinct from 'object'
  then
    return false;
  end if;

  -- Reject oversized payloads before invoking the recursive JSON safety walk.
  -- SQL boolean-expression evaluation order is not a security boundary.
  if pg_catalog.pg_column_size(candidate) > 65536 then
    return false;
  end if;

  if not private.onboarding_draft_is_safe(candidate) then
    return false;
  end if;

  if candidate - array[
      'brandName', 'productName', 'variantName', 'gtin',
      'packageDescription', 'servingWeightGrams', 'servingDescription',
      'calories', 'energyKilojoules', 'proteinGrams',
      'carbohydrateGrams', 'fatGrams', 'fiberGrams',
      'sodiumMilligrams', 'saturatedFatGrams', 'transFatGrams',
      'totalSugarsGrams', 'addedSugarsGrams', 'cholesterolMilligrams',
      'potassiumMilligrams', 'calciumMilligrams', 'ironMilligrams',
      'vitaminDMicrograms', 'ingredientsText', 'allergenStatement',
      'categorySlugs', 'allergenSlugs', 'restrictionSlugs', 'sourceNote',
      'shareNormalizedProduct', 'allergensReviewed',
      'restrictionsReviewed', 'confirmedAccurate'
    ] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(candidate -> 'brandName')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(candidate -> 'productName')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(candidate -> 'variantName')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(candidate -> 'gtin')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(candidate -> 'packageDescription')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(candidate -> 'servingDescription')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(candidate -> 'ingredientsText')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(candidate -> 'allergenStatement')
      is distinct from 'string'
    or coalesce(
      pg_catalog.char_length(pg_catalog.btrim(candidate ->> 'brandName')),
      0
    ) not between 1 and 160
    or coalesce(
      pg_catalog.char_length(pg_catalog.btrim(candidate ->> 'productName')),
      0
    ) not between 1 and 240
    or pg_catalog.char_length(candidate ->> 'variantName') > 160
    or pg_catalog.char_length(candidate ->> 'packageDescription') > 240
    or pg_catalog.char_length(candidate ->> 'servingDescription') > 160
    or coalesce(
      pg_catalog.char_length(
        pg_catalog.btrim(candidate ->> 'ingredientsText')
      ),
      0
    ) not between 1 and 10000
    or coalesce(
      pg_catalog.char_length(
        pg_catalog.btrim(candidate ->> 'allergenStatement')
      ),
      0
    ) not between 1 and 4000
    or candidate ->> 'brandName'
      is distinct from pg_catalog.btrim(candidate ->> 'brandName')
    or candidate ->> 'productName'
      is distinct from pg_catalog.btrim(candidate ->> 'productName')
    or candidate ->> 'variantName'
      is distinct from pg_catalog.btrim(candidate ->> 'variantName')
    or candidate ->> 'packageDescription'
      is distinct from pg_catalog.btrim(candidate ->> 'packageDescription')
    or candidate ->> 'servingDescription'
      is distinct from pg_catalog.btrim(candidate ->> 'servingDescription')
    or candidate ->> 'ingredientsText'
      is distinct from pg_catalog.btrim(candidate ->> 'ingredientsText')
    or candidate ->> 'allergenStatement'
      is distinct from pg_catalog.btrim(candidate ->> 'allergenStatement')
    or candidate ->> 'gtin' !~ '^(|[0-9]{8,14})$'
    or pg_catalog.jsonb_typeof(candidate -> 'servingWeightGrams')
      is distinct from 'number'
    or pg_catalog.jsonb_typeof(candidate -> 'calories')
      is distinct from 'number'
    or pg_catalog.jsonb_typeof(candidate -> 'proteinGrams')
      is distinct from 'number'
    or pg_catalog.jsonb_typeof(candidate -> 'carbohydrateGrams')
      is distinct from 'number'
    or pg_catalog.jsonb_typeof(candidate -> 'fatGrams')
      is distinct from 'number'
    or pg_catalog.jsonb_typeof(candidate -> 'categorySlugs')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(candidate -> 'allergenSlugs')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(candidate -> 'restrictionSlugs')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(candidate -> 'shareNormalizedProduct')
      is distinct from 'boolean'
    or candidate -> 'allergensReviewed' is distinct from 'true'::jsonb
    or candidate -> 'restrictionsReviewed' is distinct from 'true'::jsonb
    or candidate -> 'sourceNote' is distinct from '""'::jsonb
    or candidate -> 'confirmedAccurate'
      is distinct from pg_catalog.to_jsonb(expected_confirmed)
  then
    return false;
  end if;

  if (candidate ->> 'servingWeightGrams')::numeric <= 0
    or (candidate ->> 'servingWeightGrams')::numeric > 10000
    or (candidate ->> 'calories')::numeric not between 0 and 10000
    or (candidate ->> 'proteinGrams')::numeric not between 0 and 10000
    or (candidate ->> 'carbohydrateGrams')::numeric not between 0 and 10000
    or (candidate ->> 'fatGrams')::numeric not between 0 and 10000
    or pg_catalog.jsonb_array_length(candidate -> 'categorySlugs')
      not between 1 and 7
    or pg_catalog.jsonb_array_length(candidate -> 'allergenSlugs') > 50
    or pg_catalog.jsonb_array_length(candidate -> 'restrictionSlugs') > 50
    or exists (
      select 1
      from pg_catalog.jsonb_each(candidate) optional_nutrient
      where optional_nutrient.key in (
        'energyKilojoules', 'fiberGrams', 'sodiumMilligrams',
        'saturatedFatGrams', 'transFatGrams', 'totalSugarsGrams',
        'addedSugarsGrams', 'cholesterolMilligrams',
        'potassiumMilligrams', 'calciumMilligrams', 'ironMilligrams',
        'vitaminDMicrograms'
      )
        and optional_nutrient.value <> 'null'::jsonb
        and pg_catalog.jsonb_typeof(optional_nutrient.value) <> 'number'
    )
  then
    return false;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each(candidate) optional_nutrient
    where optional_nutrient.key in (
      'fiberGrams', 'saturatedFatGrams', 'transFatGrams',
      'totalSugarsGrams', 'addedSugarsGrams'
    )
      and optional_nutrient.value <> 'null'::jsonb
      and (optional_nutrient.value #>> '{}')::numeric
        not between 0 and 10000
  ) or exists (
    select 1
    from pg_catalog.jsonb_each(candidate) optional_nutrient
    where optional_nutrient.key = 'energyKilojoules'
      and optional_nutrient.value <> 'null'::jsonb
      and (optional_nutrient.value #>> '{}')::numeric
        not between 0 and 100000
  ) or exists (
    select 1
    from pg_catalog.jsonb_each(candidate) optional_nutrient
    where optional_nutrient.key in (
      'sodiumMilligrams', 'cholesterolMilligrams',
      'potassiumMilligrams', 'calciumMilligrams', 'ironMilligrams',
      'vitaminDMicrograms'
    )
      and optional_nutrient.value <> 'null'::jsonb
      and (optional_nutrient.value #>> '{}')::numeric
        not between 0 and 1000000
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      candidate -> 'categorySlugs'
    ) selected_slug
    where pg_catalog.jsonb_typeof(selected_slug) <> 'string'
      or pg_catalog.char_length(selected_slug #>> '{}') not between 1 and 60
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      candidate -> 'allergenSlugs'
    ) selected_slug
    where pg_catalog.jsonb_typeof(selected_slug) <> 'string'
      or pg_catalog.char_length(selected_slug #>> '{}') not between 1 and 80
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      candidate -> 'restrictionSlugs'
    ) selected_slug
    where pg_catalog.jsonb_typeof(selected_slug) <> 'string'
      or pg_catalog.char_length(selected_slug #>> '{}') not between 1 and 80
  ) then
    return false;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(
      candidate -> 'categorySlugs'
    ) selected_slug(slug)
    where not exists (
      select 1
      from public.food_categories category
      where category.slug = selected_slug.slug
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(
      candidate -> 'allergenSlugs'
    ) selected_slug(slug)
    where not exists (
      select 1
      from public.allergens allergen
      where allergen.slug = selected_slug.slug
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(
      candidate -> 'restrictionSlugs'
    ) selected_slug(slug)
    where not exists (
      select 1
      from public.dietary_restriction_types restriction
      where restriction.slug = selected_slug.slug
    )
  ) or not private.food_label_allergens_are_consistent(candidate) then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function private.food_label_payload_is_valid(jsonb, boolean)
  from public, anon, authenticated, service_role;

create function public.append_meal_preference(
  selected_meal_type public.meal_type,
  selected_food_id uuid
)
returns table (
  id uuid,
  meal_type public.meal_type,
  food_id uuid,
  sort_order integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_onboarding_status public.onboarding_status;
  preference_count integer;
  next_sort_order integer;
begin
  if current_user_id is null
    or coalesce((select auth.role()), '') <> 'authenticated'
  then
    raise exception using
      errcode = '42501',
      message = 'MEAL_PREFERENCE_AUTH_REQUIRED';
  end if;

  if selected_meal_type is null
    or selected_meal_type not in ('breakfast', 'lunch', 'dinner')
  then
    raise exception using
      errcode = '22023',
      message = 'MEAL_PREFERENCE_INVALID_MEAL';
  end if;

  if selected_food_id is null then
    raise exception using
      errcode = '22023',
      message = 'MEAL_PREFERENCE_INVALID_FOOD';
  end if;

  -- Settings is available only after onboarding. Lock the profile row so a
  -- first onboarding completion cannot replace the same preference list while
  -- this RPC is appending to it.
  select profile.onboarding_status
  into current_onboarding_status
  from public.profiles profile
  where profile.user_id = current_user_id
  for update;

  if current_onboarding_status is distinct from 'completed' then
    raise exception using
      errcode = '55000',
      message = 'ONBOARDING_NOT_COMPLETED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'meal-preference:'
        || current_user_id::text
        || ':'
        || selected_meal_type::text,
      0
    )
  );

  if exists (
    select 1
    from public.meal_preferences existing_preference
    where existing_preference.user_id = current_user_id
      and existing_preference.meal_type = selected_meal_type
      and existing_preference.food_id = selected_food_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'DUPLICATE_MEAL_PREFERENCE';
  end if;

  select
    count(*),
    coalesce(max(existing_preference.sort_order), -1) + 1
  into preference_count, next_sort_order
  from public.meal_preferences existing_preference
  where existing_preference.user_id = current_user_id
    and existing_preference.meal_type = selected_meal_type;

  if preference_count >= 50 then
    raise exception using
      errcode = '23514',
      message = 'MEAL_PREFERENCE_LIMIT_REACHED';
  end if;

  if not exists (
    select 1
    from public.plan_eligible_food_ids(array[selected_food_id]) eligible_food
    where eligible_food.food_id = selected_food_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'FOOD_NOT_PLAN_ELIGIBLE';
  end if;

  return query
  insert into public.meal_preferences as saved_preference (
    user_id,
    meal_type,
    food_id,
    sort_order
  )
  values (
    current_user_id,
    selected_meal_type,
    selected_food_id,
    next_sort_order
  )
  returning
    saved_preference.id,
    saved_preference.meal_type,
    saved_preference.food_id,
    saved_preference.sort_order;
end;
$$;

create function public.remove_meal_preference(
  selected_meal_type public.meal_type,
  selected_food_id uuid
)
returns table (
  removed boolean,
  already_absent boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_onboarding_status public.onboarding_status;
  removed_count integer;
begin
  if current_user_id is null
    or coalesce((select auth.role()), '') <> 'authenticated'
  then
    raise exception using
      errcode = '42501',
      message = 'MEAL_PREFERENCE_AUTH_REQUIRED';
  end if;

  if selected_meal_type is null
    or selected_meal_type not in ('breakfast', 'lunch', 'dinner')
  then
    raise exception using
      errcode = '22023',
      message = 'MEAL_PREFERENCE_INVALID_MEAL';
  end if;

  if selected_food_id is null then
    raise exception using
      errcode = '22023',
      message = 'MEAL_PREFERENCE_INVALID_FOOD';
  end if;

  select profile.onboarding_status
  into current_onboarding_status
  from public.profiles profile
  where profile.user_id = current_user_id
  for update;

  if current_onboarding_status is distinct from 'completed' then
    raise exception using
      errcode = '55000',
      message = 'ONBOARDING_NOT_COMPLETED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'meal-preference:'
        || current_user_id::text
        || ':'
        || selected_meal_type::text,
      0
    )
  );

  delete from public.meal_preferences preference
  where preference.user_id = current_user_id
    and preference.meal_type = selected_meal_type
    and preference.food_id = selected_food_id;
  get diagnostics removed_count = row_count;

  return query select true, removed_count = 0;
end;
$$;

create function public.create_food_label_draft(
  target_draft_id uuid,
  target_label_data jsonb
)
returns table (
  id uuid,
  status public.food_label_submission_status,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  trusted_now timestamptz := pg_catalog.clock_timestamp();
  existing_submission public.food_label_submissions%rowtype;
  existing_creation_user_id uuid;
  active_draft_count integer;
  recent_draft_count integer;
begin
  if current_user_id is null
    or coalesce((select auth.role()), '') <> 'authenticated'
  then
    raise exception using
      errcode = '42501',
      message = 'FOOD_LABEL_DRAFT_AUTH_REQUIRED';
  end if;

  if target_draft_id is null then
    raise exception using
      errcode = '22023',
      message = 'FOOD_LABEL_DRAFT_INVALID_ID';
  end if;

  if not private.food_label_payload_is_valid(target_label_data, false) then
    raise exception using
      errcode = '22023',
      message = 'FOOD_LABEL_DRAFT_INVALID_DATA';
  end if;

  -- One lock protects both quota predicates and insertion for this account.
  -- The ID lock additionally makes a deliberately reused UUID deterministic
  -- across accounts without disclosing which account owns it.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'food-label-draft-owner:' || current_user_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'food-label-draft-id:' || target_draft_id::text,
      0
    )
  );

  select submission.*
  into existing_submission
  from public.food_label_submissions submission
  where submission.id = target_draft_id
  for update;

  if found then
    if existing_submission.user_id <> current_user_id then
      raise exception using
        errcode = '23505',
        message = 'LABEL_DRAFT_ID_CONFLICT';
    end if;
    if existing_submission.status <> 'draft' then
      raise exception using
        errcode = '55000',
        message = 'LABEL_DRAFT_ALREADY_PROCESSED';
    end if;
    if existing_submission.label_data <> target_label_data then
      raise exception using
        errcode = '22023',
        message = 'LABEL_DRAFT_REPLAY_MISMATCH';
    end if;

    return query
    select
      existing_submission.id,
      existing_submission.status,
      true;
    return;
  end if;

  select creation_event.user_id
  into existing_creation_user_id
  from private.food_label_draft_creation_events creation_event
  where creation_event.draft_id = target_draft_id;

  if found then
    raise exception using
      errcode = '23505',
      message = 'LABEL_DRAFT_ID_CONFLICT';
  end if;

  select
    count(*) filter (
      where submission.status in ('draft', 'needs_changes')
    )::integer,
    0
  into active_draft_count, recent_draft_count
  from public.food_label_submissions submission
  where submission.user_id = current_user_id;

  select count(*)::integer
  into recent_draft_count
  from private.food_label_draft_creation_events creation_event
  where creation_event.user_id = current_user_id
    and creation_event.created_at >= trusted_now - interval '24 hours';

  if active_draft_count >= 8 or recent_draft_count >= 20 then
    raise exception using
      errcode = '54000',
      message = 'LABEL_UPLOAD_RATE_LIMITED';
  end if;

  insert into private.food_label_draft_creation_events (
    draft_id,
    user_id,
    created_at
  )
  values (target_draft_id, current_user_id, trusted_now);

  return query
  with created_submission as (
    insert into public.food_label_submissions as submission (
      id,
      user_id,
      status,
      brand_name,
      product_name,
      variant_name,
      gtin,
      package_description,
      label_data,
      created_at,
      updated_at
    )
    values (
      target_draft_id,
      current_user_id,
      'draft',
      target_label_data ->> 'brandName',
      target_label_data ->> 'productName',
      nullif(target_label_data ->> 'variantName', ''),
      nullif(target_label_data ->> 'gtin', ''),
      nullif(target_label_data ->> 'packageDescription', ''),
      target_label_data,
      trusted_now,
      trusted_now
    )
    returning submission.id, submission.status
  )
  select
    created_submission.id,
    created_submission.status,
    false
  from created_submission;
end;
$$;

alter function public.create_confirmed_label_food(jsonb, uuid)
  rename to create_confirmed_label_food_beta5;
alter function public.create_confirmed_label_food_beta5(jsonb, uuid)
  set schema private;
revoke all on function private.create_confirmed_label_food_beta5(jsonb, uuid)
  from public, anon, authenticated, service_role;

create function public.create_confirmed_label_food(
  label_data jsonb,
  label_submission_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  stored_label_data jsonb;
  normalized_label_data jsonb;
  normalized_stored_label_data jsonb;
  stored_draft_found boolean := false;
begin
  if current_user_id is null
    or coalesce((select auth.role()), '') <> 'authenticated'
  then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if label_data is null
    or pg_catalog.jsonb_typeof(label_data) is distinct from 'object'
    or pg_catalog.pg_column_size(label_data) > 65536
  then
    raise exception using
      errcode = '22023',
      message = 'The confirmed package-label payload is invalid.';
  end if;

  if label_data ? 'shareNormalizedProduct'
    and pg_catalog.jsonb_typeof(label_data -> 'shareNormalizedProduct')
      is distinct from 'boolean'
  then
    raise exception using
      errcode = '22023',
      message = 'Choose whether to share this product using true or false.';
  end if;

  if pg_catalog.jsonb_typeof(label_data -> 'confirmedAccurate')
      is distinct from 'boolean'
    or label_data -> 'confirmedAccurate' is distinct from 'true'::jsonb
    or pg_catalog.jsonb_typeof(label_data -> 'allergensReviewed')
      is distinct from 'boolean'
    or label_data -> 'allergensReviewed' is distinct from 'true'::jsonb
    or pg_catalog.jsonb_typeof(label_data -> 'restrictionsReviewed')
      is distinct from 'boolean'
    or label_data -> 'restrictionsReviewed' is distinct from 'true'::jsonb
    or nullif(
      pg_catalog.btrim(coalesce(label_data ->> 'sourceNote', '')),
      ''
    ) is not null
  then
    raise exception using
      errcode = '23514',
      message = 'Confirm the nutrition, allergen, and dietary-restriction review before using this label.';
  end if;

  if pg_catalog.jsonb_typeof(label_data -> 'allergenStatement') = 'string'
    and pg_catalog.jsonb_typeof(label_data -> 'allergenSlugs') = 'array'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        label_data -> 'allergenSlugs'
      ) selected_allergen
      where pg_catalog.jsonb_typeof(selected_allergen) <> 'string'
    )
    and not private.food_label_allergens_are_consistent(label_data)
  then
    raise exception using
      errcode = '23514',
      message = 'Every allergen named in the package statement must be selected before confirmation.';
  end if;

  normalized_label_data := pg_catalog.jsonb_set(
    label_data,
    '{shareNormalizedProduct}',
    coalesce(label_data -> 'shareNormalizedProduct', 'false'::jsonb),
    true
  );

  if not private.food_label_payload_is_valid(normalized_label_data, true) then
    raise exception using
      errcode = '22023',
      message = 'The confirmed package-label payload is invalid.';
  end if;

  select submission.label_data
  into stored_label_data
  from public.food_label_submissions submission
  where submission.id = label_submission_id
    and submission.user_id = current_user_id
    and submission.status in ('draft', 'needs_changes')
  for update;
  stored_draft_found := found;

  normalized_stored_label_data := case
    when stored_draft_found
      and pg_catalog.jsonb_typeof(stored_label_data) = 'object'
      and pg_catalog.pg_column_size(stored_label_data) <= 65536
    then pg_catalog.jsonb_set(
      stored_label_data,
      '{shareNormalizedProduct}',
      coalesce(
        stored_label_data -> 'shareNormalizedProduct',
        'false'::jsonb
      ),
      true
    )
    else stored_label_data
  end;

  if stored_draft_found
    and not private.food_label_payload_is_valid(
      normalized_stored_label_data,
      false
    )
  then
    raise exception using
      errcode = '22023',
      message = 'The saved package-label draft must be replaced before confirmation.';
  end if;

  return private.create_confirmed_label_food_beta5(
    normalized_label_data,
    label_submission_id
  );
end;
$$;

create function public.discard_food_label_draft(
  target_user_id uuid,
  target_submission_id uuid
)
returns table (
  discarded boolean,
  already_absent boolean,
  cleanup_queued integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_submission_status public.food_label_submission_status;
  current_private_food_id uuid;
  current_published_food_id uuid;
  current_submitted_at timestamptz;
  current_reviewed_at timestamptz;
  queued_count integer;
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
    or target_submission_id is null
  then
    raise exception using
      errcode = '42501',
      message = 'FOOD_LABEL_DISCARD_SERVER_ONLY';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'food-label-draft-owner:' || target_user_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'food-label-draft-id:' || target_submission_id::text,
      0
    )
  );

  -- Match the existing upload lock order before touching the submission row.
  -- An in-flight upload completes or rolls back before its draft can disappear.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'food-label-upload:' || target_user_id::text || ':'
        || target_submission_id::text || ':front',
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'food-label-upload:' || target_user_id::text || ':'
        || target_submission_id::text || ':nutrition',
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'food-label-upload:' || target_user_id::text || ':'
        || target_submission_id::text || ':ingredients',
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'food-label-upload:' || target_user_id::text || ':'
        || target_submission_id::text || ':barcode',
      0
    )
  );

  if exists (
    select 1
    from private.food_label_upload_reservations reservation
    where reservation.user_id = target_user_id
      and reservation.submission_id = target_submission_id
      and reservation.status in ('reserved', 'uploaded', 'superseded')
      and reservation.updated_at >=
        pg_catalog.clock_timestamp() - interval '30 minutes'
  ) then
    raise exception using
      errcode = '55000',
      message = 'LABEL_DRAFT_UPLOAD_IN_PROGRESS';
  end if;

  select
    submission.status,
    submission.private_food_id,
    submission.published_food_id,
    submission.submitted_at,
    submission.reviewed_at
  into
    current_submission_status,
    current_private_food_id,
    current_published_food_id,
    current_submitted_at,
    current_reviewed_at
  from public.food_label_submissions submission
  where submission.id = target_submission_id
    and submission.user_id = target_user_id
  for update;

  if not found then
    select count(*)::integer
    into queued_count
    from private.food_label_discard_cleanup cleanup
    where cleanup.user_id = target_user_id
      and cleanup.submission_id = target_submission_id;
    return query select true, true, queued_count;
    return;
  end if;

  if current_submission_status not in ('draft', 'needs_changes')
    or current_private_food_id is not null
    or current_published_food_id is not null
    or current_submitted_at is not null
    or current_reviewed_at is not null
  then
    raise exception using
      errcode = '55000',
      message = 'LABEL_DRAFT_NOT_DISCARDABLE';
  end if;

  insert into private.food_label_discard_cleanup as cleanup (
    object_path,
    user_id,
    submission_id,
    queued_at
  )
  select
    pending_path.object_path,
    target_user_id,
    target_submission_id,
    pg_catalog.clock_timestamp()
  from (
    select image.object_path
    from public.food_label_images image
    where image.user_id = target_user_id
      and image.submission_id = target_submission_id
    union
    select reservation.object_path
    from private.food_label_upload_reservations reservation
    where reservation.user_id = target_user_id
      and reservation.submission_id = target_submission_id
    union
    select stored_object.name
    from storage.objects stored_object
    where stored_object.bucket_id = 'food-labels'
      and stored_object.name like (
        target_user_id::text || '/' || target_submission_id::text || '/%'
      )
  ) pending_path
  where pending_path.object_path ~ (
    '^' || target_user_id::text || '/' || target_submission_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-'
      || '[0-9a-f]{12}[.](jpg|png)$'
  )
  on conflict (object_path) do update
  set
    user_id = excluded.user_id,
    submission_id = excluded.submission_id,
    queued_at = excluded.queued_at;
  get diagnostics queued_count = row_count;

  delete from public.food_label_submissions submission
  where submission.id = target_submission_id
    and submission.user_id = target_user_id
    and submission.status in ('draft', 'needs_changes')
    and submission.private_food_id is null
    and submission.published_food_id is null
    and submission.submitted_at is null
    and submission.reviewed_at is null;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'LABEL_DRAFT_DISCARD_CONFLICT';
  end if;

  return query select true, false, queued_count;
end;
$$;

create or replace function public.pending_food_label_object_cleanup(
  target_user_id uuid,
  result_limit integer default 10
)
returns table (object_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
  then
    raise exception using
      errcode = '42501',
      message = 'Label-upload cleanup is restricted to the trusted server.';
  end if;

  delete from private.food_label_object_cleanup cleanup
  using public.food_label_images image
  where cleanup.user_id = target_user_id
    and image.object_path = cleanup.object_path;

  delete from private.food_label_discard_cleanup cleanup
  using public.food_label_images image
  where cleanup.user_id = target_user_id
    and image.object_path = cleanup.object_path;

  with stale as (
    update private.food_label_upload_reservations reservation
    set
      is_latest = false,
      status = 'cleanup_pending',
      updated_at = pg_catalog.now()
    where reservation.user_id = target_user_id
      and reservation.status in ('reserved', 'uploaded', 'superseded')
      and reservation.created_at < pg_catalog.now() - interval '30 minutes'
    returning reservation.*
  )
  insert into private.food_label_object_cleanup (
    object_path,
    reservation_id,
    user_id,
    submission_id,
    reason
  )
  select
    stale.object_path,
    stale.id,
    stale.user_id,
    stale.submission_id,
    'stale_reservation'
  from stale
  on conflict on constraint food_label_object_cleanup_pkey do update
  set
    reason = excluded.reason,
    queued_at = pg_catalog.now();

  return query
  select pending.object_path
  from (
    select cleanup.object_path, cleanup.queued_at
    from private.food_label_object_cleanup cleanup
    where cleanup.user_id = target_user_id
    union all
    select cleanup.object_path, cleanup.queued_at
    from private.food_label_discard_cleanup cleanup
    where cleanup.user_id = target_user_id
  ) pending
  where not exists (
    select 1
    from public.food_label_images image
    where image.object_path = pending.object_path
  )
  group by pending.object_path
  order by min(pending.queued_at), pending.object_path
  limit least(greatest(coalesce(result_limit, 10), 1), 50);
end;
$$;

create or replace function public.complete_food_label_object_cleanup(
  target_user_id uuid,
  target_object_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleanup_reservation_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
    or target_object_path is null
  then
    raise exception using
      errcode = '42501',
      message = 'Label-upload cleanup is restricted to the trusted server.';
  end if;

  if exists (
    select 1
    from public.food_label_images image
    where image.object_path = target_object_path
  ) then
    return false;
  end if;

  select cleanup.reservation_id
  into cleanup_reservation_id
  from private.food_label_object_cleanup cleanup
  where cleanup.object_path = target_object_path
    and cleanup.user_id = target_user_id
  for update;

  delete from private.food_label_object_cleanup cleanup
  where cleanup.object_path = target_object_path
    and cleanup.user_id = target_user_id;

  delete from private.food_label_discard_cleanup cleanup
  where cleanup.object_path = target_object_path
    and cleanup.user_id = target_user_id;

  update private.food_label_upload_reservations reservation
  set
    status = 'cleaned',
    is_latest = false,
    updated_at = pg_catalog.now()
  where reservation.id = cleanup_reservation_id
    and reservation.status <> 'current';

  return true;
end;
$$;

revoke all on function public.append_meal_preference(
  public.meal_type,
  uuid
) from public, anon, service_role;
grant execute on function public.append_meal_preference(
  public.meal_type,
  uuid
) to authenticated;

revoke all on function public.remove_meal_preference(
  public.meal_type,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.remove_meal_preference(
  public.meal_type,
  uuid
) to authenticated;

revoke all on function public.create_food_label_draft(
  uuid,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_food_label_draft(
  uuid,
  jsonb
) to authenticated;

revoke all on function public.create_confirmed_label_food(jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_confirmed_label_food(jsonb, uuid)
  to authenticated;

revoke all on function public.discard_food_label_draft(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.discard_food_label_draft(uuid, uuid)
  to service_role;

-- Meal-preference writes and food-label draft creation are available only
-- through the serialized RPCs above. Owner-scoped reads remain protected by
-- RLS, while direct writes cannot bypass capacity or idempotency checks.
revoke insert, update, delete on public.meal_preferences from authenticated;
drop policy if exists "food_label_submissions_insert_own_draft"
  on public.food_label_submissions;
revoke insert on public.food_label_submissions from authenticated;

comment on function public.append_meal_preference(
  public.meal_type,
  uuid
) is
  'Atomically appends one eligible owner-accessible food to a primary meal preference list, serialized per user and meal.';

comment on function public.remove_meal_preference(
  public.meal_type,
  uuid
) is
  'Atomically and idempotently removes one owner meal preference, serialized with append for the same user and meal.';

comment on function public.create_food_label_draft(uuid, jsonb) is
  'Atomically creates or exactly replays one owner food-label draft while enforcing database-trusted capacity limits.';

-- Preserve the complete Beta 5 readiness contract and layer the meal-
-- preference mutation boundary on top without duplicating the prior checks.
alter function public.application_health(text)
  rename to application_health_beta5;
alter function public.application_health_beta5(text)
  set schema private;
revoke all on function private.application_health_beta5(text)
  from public, anon, authenticated, service_role;

create function public.application_health(
  expected_migration text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_migration constant text :=
    '20260814000000_append_meal_preferences';
  previous_health jsonb;
  append_rpc oid := pg_catalog.to_regprocedure(
    'public.append_meal_preference(public.meal_type,uuid)'
  );
  remove_rpc oid := pg_catalog.to_regprocedure(
    'public.remove_meal_preference(public.meal_type,uuid)'
  );
  create_label_draft_rpc oid := pg_catalog.to_regprocedure(
    'public.create_food_label_draft(uuid,jsonb)'
  );
  payload_validator_rpc oid := pg_catalog.to_regprocedure(
    'private.food_label_payload_is_valid(jsonb,boolean)'
  );
  allergen_consistency_rpc oid := pg_catalog.to_regprocedure(
    'private.food_label_allergens_are_consistent(jsonb)'
  );
  confirm_label_rpc oid := pg_catalog.to_regprocedure(
    'public.create_confirmed_label_food(jsonb,uuid)'
  );
  private_confirm_label_rpc oid := pg_catalog.to_regprocedure(
    'private.create_confirmed_label_food_beta5(jsonb,uuid)'
  );
  discard_label_draft_rpc oid := pg_catalog.to_regprocedure(
    'public.discard_food_label_draft(uuid,uuid)'
  );
  pending_cleanup_rpc oid := pg_catalog.to_regprocedure(
    'public.pending_food_label_object_cleanup(uuid,integer)'
  );
  complete_cleanup_rpc oid := pg_catalog.to_regprocedure(
    'public.complete_food_label_object_cleanup(uuid,text)'
  );
  creation_events_table oid := pg_catalog.to_regclass(
    'private.food_label_draft_creation_events'
  );
  discard_cleanup_table oid := pg_catalog.to_regclass(
    'private.food_label_discard_cleanup'
  );
  previous_health_rpc oid := pg_catalog.to_regprocedure(
    'private.application_health_beta5(text)'
  );
  trusted_owner oid := (
    select table_entry.relowner
    from pg_catalog.pg_class table_entry
    join pg_catalog.pg_namespace namespace_entry
      on namespace_entry.oid = table_entry.relnamespace
    where namespace_entry.nspname = 'public'
      and table_entry.relname = 'profiles'
  );
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message =
        'Health details are restricted to the trusted server boundary.';
  end if;

  previous_health := private.application_health_beta5(
    '20260813000000_reserve_external_food_import_capacity'
  );

  if coalesce(
      (previous_health ->> 'databaseReachable')::boolean,
      false
    ) is not true
    or coalesce(
      (previous_health ->> 'migrationCompatible')::boolean,
      false
    ) is not true
    or append_rpc is null
    or remove_rpc is null
    or create_label_draft_rpc is null
    or payload_validator_rpc is null
    or allergen_consistency_rpc is null
    or confirm_label_rpc is null
    or private_confirm_label_rpc is null
    or discard_label_draft_rpc is null
    or pending_cleanup_rpc is null
    or complete_cleanup_rpc is null
    or creation_events_table is null
    or discard_cleanup_table is null
    or previous_health_rpc is null
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = previous_health_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and procedure_entry.prorettype = 'jsonb'::pg_catalog.regtype
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      previous_health_rpc,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      previous_health_rpc,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      previous_health_rpc,
      'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = payload_validator_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and procedure_entry.prorettype = 'boolean'::pg_catalog.regtype
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'pg_column_size(candidate) > 65536'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'onboarding_draft_is_safe'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'candidate - array['
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'jsonb_array_length'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'expected_confirmed'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'public.food_categories'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'food_label_allergens_are_consistent'
        ) > 0
    )
    or pg_catalog.has_function_privilege(
      'anon', payload_validator_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', payload_validator_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role', payload_validator_rpc, 'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = allergen_consistency_rpc
        and procedure_entry.proowner = trusted_owner
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'free[ ]+from'
        ) > 0
    )
    or pg_catalog.has_function_privilege(
      'anon', allergen_consistency_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', allergen_consistency_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role', allergen_consistency_rpc, 'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_class table_entry
      where table_entry.oid in (creation_events_table, discard_cleanup_table)
        and table_entry.relowner = trusted_owner
      group by table_entry.relowner
      having count(*) = 2
    )
    or pg_catalog.has_table_privilege(
      'anon', creation_events_table, 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', creation_events_table,
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'service_role', creation_events_table,
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'anon', discard_cleanup_table, 'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated', discard_cleanup_table,
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'service_role', discard_cleanup_table,
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = append_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'pg_advisory_xact_lock'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'for update'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'ONBOARDING_NOT_COMPLETED'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'DUPLICATE_MEAL_PREFERENCE'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'preference_count >= 50'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'plan_eligible_food_ids'
        ) > 0
    )
    or not pg_catalog.has_function_privilege(
      'authenticated',
      append_rpc,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege('anon', append_rpc, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'service_role',
      append_rpc,
      'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = remove_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'pg_advisory_xact_lock'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'delete from public.meal_preferences'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'removed_count = 0'
        ) > 0
    )
    or not pg_catalog.has_function_privilege(
      'authenticated',
      remove_rpc,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege('anon', remove_rpc, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'service_role',
      remove_rpc,
      'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = create_label_draft_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'pg_advisory_xact_lock'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'for update'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'active_draft_count >= 8'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'recent_draft_count >= 20'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'clock_timestamp'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'LABEL_DRAFT_REPLAY_MISMATCH'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'LABEL_DRAFT_ID_CONFLICT'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'food_label_payload_is_valid'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'food_label_draft_creation_events'
        ) > 0
    )
    or not pg_catalog.has_function_privilege(
      'authenticated',
      create_label_draft_rpc,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      create_label_draft_rpc,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      create_label_draft_rpc,
      'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = confirm_label_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'food_label_payload_is_valid(normalized_label_data, true)'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'normalized_stored_label_data'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'private.create_confirmed_label_food_beta5'
        ) > 0
    )
    or not pg_catalog.has_function_privilege(
      'authenticated', confirm_label_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege('anon', confirm_label_rpc, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'service_role', confirm_label_rpc, 'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = private_confirm_label_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
    )
    or pg_catalog.has_function_privilege(
      'anon', private_confirm_label_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', private_confirm_label_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role', private_confirm_label_rpc, 'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = discard_label_draft_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'food-label-upload:'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          '''reserved'', ''uploaded'', ''superseded'''
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'private_food_id is null'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'submitted_at is null'
        ) > 0
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'food_label_discard_cleanup'
        ) > 0
    )
    or not pg_catalog.has_function_privilege(
      'service_role', discard_label_draft_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon', discard_label_draft_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', discard_label_draft_rpc, 'EXECUTE'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = pending_cleanup_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'food_label_discard_cleanup'
        ) > 0
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = complete_cleanup_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
        and pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(procedure_entry.oid),
          'food_label_discard_cleanup'
        ) > 0
    )
    or not pg_catalog.has_function_privilege(
      'service_role', pending_cleanup_rpc, 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role', complete_cleanup_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon', pending_cleanup_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', pending_cleanup_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon', complete_cleanup_rpc, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', complete_cleanup_rpc, 'EXECUTE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.meal_preferences',
      'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.meal_preferences',
      'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.meal_preferences',
      'DELETE'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.meal_preferences',
      'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.food_label_submissions',
      'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.food_label_submissions',
      'SELECT'
    )
    or exists (
      select 1
      from pg_catalog.pg_policy policy_entry
      where policy_entry.polrelid =
        'public.food_label_submissions'::pg_catalog.regclass
        and policy_entry.polcmd = 'a'
    )
  then
    return pg_catalog.jsonb_build_object(
      'databaseReachable', true,
      'migrationCompatible', false
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'databaseReachable', true,
    'migrationCompatible', expected_migration = current_migration
  );
end;
$$;

revoke all on function public.application_health(text)
  from public, anon, authenticated, service_role;
grant execute on function public.application_health(text) to service_role;

commit;
