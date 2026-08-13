begin;

-- Keep the verification trigger and the recovery RPC on one implementation so
-- an interrupted Auth hook cannot produce a second, weaker profile-creation
-- path. This helper is owner-only; the public wrapper below accepts no user id.
create function private.ensure_verified_user_profile(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_user auth.users%rowtype;
  metadata jsonb;
  metadata_age smallint;
  metadata_date_of_birth date;
  metadata_date_of_birth_text text;
  metadata_time_zone text;
  metadata_gender public.profile_gender;
  legacy_account boolean;
  legacy_age smallint;
  legacy_time_zone text;
  registration_date date;
  terms_version text;
  privacy_version text;
begin
  if target_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'A verified account is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'verified-profile:' || target_user_id::text,
      0
    )
  );

  select auth_record.*
  into auth_user
  from auth.users auth_record
  where auth_record.id = target_user_id;

  if not found or auth_user.email_confirmed_at is null then
    raise exception using
      errcode = '42501',
      message = 'A verified account is required.';
  end if;

  metadata := coalesce(auth_user.raw_user_meta_data, '{}'::jsonb);
  metadata_date_of_birth_text := btrim(
    coalesce(metadata ->> 'date_of_birth', '')
  );
  metadata_time_zone := btrim(
    coalesce(metadata ->> 'registration_time_zone', '')
  );

  select
    legacy.legacy_age,
    legacy.legacy_time_zone
  into
    legacy_age,
    legacy_time_zone
  from private.legacy_age_only_accounts legacy
  where legacy.user_id = target_user_id;
  legacy_account := found;

  if metadata_date_of_birth_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      metadata_date_of_birth := metadata_date_of_birth_text::date;
      if pg_catalog.to_char(metadata_date_of_birth, 'YYYY-MM-DD')
        <> metadata_date_of_birth_text
      then
        metadata_date_of_birth := null;
      end if;
    exception
      when datetime_field_overflow or invalid_datetime_format then
        metadata_date_of_birth := null;
    end;
  end if;

  if metadata_date_of_birth is not null then
    if not private.is_valid_time_zone(metadata_time_zone) then
      metadata_date_of_birth := null;
    else
      registration_date := (
        current_timestamp at time zone metadata_time_zone
      )::date;
      metadata_age := private.profile_age_on_date(
        metadata_date_of_birth,
        registration_date
      );
      if metadata_age not between 13 and 120 then
        metadata_date_of_birth := null;
        metadata_age := null;
      end if;
    end if;
  end if;

  if metadata_date_of_birth is null then
    if not legacy_account then
      raise exception using
        errcode = '23514',
        message =
          'A valid date of birth and registration time zone are required.';
    end if;

    metadata_age := legacy_age;
    metadata_time_zone := case
      when private.is_valid_time_zone(legacy_time_zone)
        then legacy_time_zone
      else 'UTC'
    end;
  end if;

  metadata_gender := case
    when metadata ->> 'gender' in (
      'male',
      'female',
      'another_identity',
      'prefer_not_to_say'
    )
      then (metadata ->> 'gender')::public.profile_gender
    else 'prefer_not_to_say'::public.profile_gender
  end;

  terms_version := left(
    btrim(coalesce(metadata ->> 'terms_version', '')),
    80
  );
  privacy_version := left(
    btrim(coalesce(metadata ->> 'privacy_version', '')),
    80
  );

  if not (
    (terms_version = '1.0' and privacy_version = '1.0')
    or (terms_version = '1.1' and privacy_version = '1.1')
    or (terms_version = '1.1' and privacy_version = '1.2')
    or (terms_version = '1.2' and privacy_version = '1.3')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Recognized registration legal acceptances are required.';
  end if;

  insert into public.profiles (
    user_id,
    full_name,
    gender,
    age,
    date_of_birth,
    preferred_weight_unit,
    time_zone,
    onboarding_status
  )
  values (
    target_user_id,
    left(
      coalesce(
        nullif(btrim(metadata ->> 'full_name'), ''),
        'Let''s Go Green! member'
      ),
      120
    ),
    metadata_gender,
    metadata_age,
    metadata_date_of_birth,
    'kg',
    metadata_time_zone,
    'in_progress'
  )
  on conflict (user_id) do nothing;

  insert into public.legal_acceptances (
    user_id,
    document_type,
    document_version
  )
  values
    (target_user_id, 'terms', terms_version),
    (target_user_id, 'privacy', privacy_version)
  on conflict (user_id, document_type, document_version) do nothing;

  return exists (
    select 1
    from public.profiles profile
    where profile.user_id = target_user_id
  );
end;
$$;

revoke all on function private.ensure_verified_user_profile(uuid)
  from public, anon, authenticated, service_role;

-- Registration legal versions are an immutable acceptance transport just like
-- registration DOB and time zone. Values must be present at Auth user creation;
-- later account-metadata edits cannot add, remove, or replace either version.
create or replace function private.protect_auth_date_of_birth_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(old.raw_user_meta_data, '{}'::jsonb) ? 'date_of_birth'
    and coalesce(old.raw_user_meta_data, '{}'::jsonb) -> 'date_of_birth'
      is distinct from
      coalesce(new.raw_user_meta_data, '{}'::jsonb) -> 'date_of_birth'
  then
    raise exception using
      errcode = '23514',
      message = 'Date of birth cannot be changed after account creation.';
  end if;

  if coalesce(old.raw_user_meta_data, '{}'::jsonb)
      ? 'registration_time_zone'
    and coalesce(old.raw_user_meta_data, '{}'::jsonb)
      -> 'registration_time_zone'
      is distinct from
      coalesce(new.raw_user_meta_data, '{}'::jsonb)
        -> 'registration_time_zone'
  then
    raise exception using
      errcode = '23514',
      message =
        'Registration time zone cannot be changed after account creation.';
  end if;

  if coalesce(old.raw_user_meta_data, '{}'::jsonb) -> 'terms_version'
      is distinct from
      coalesce(new.raw_user_meta_data, '{}'::jsonb) -> 'terms_version'
    or coalesce(old.raw_user_meta_data, '{}'::jsonb) -> 'privacy_version'
      is distinct from
      coalesce(new.raw_user_meta_data, '{}'::jsonb) -> 'privacy_version'
  then
    raise exception using
      errcode = '23514',
      message =
        'Registration legal versions cannot be changed after account creation.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_auth_date_of_birth_metadata()
  from public, anon, authenticated, service_role;

-- The Auth trigger delegates to the same idempotent implementation used by
-- recovery. Replacing the function preserves the existing trigger binding.
create or replace function private.initialize_verified_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is not null or new.email_confirmed_at is null then
    return new;
  end if;

  perform private.ensure_verified_user_profile(new.id);
  return new;
end;
$$;

revoke all on function private.initialize_verified_user()
  from public, anon, authenticated, service_role;

create function public.repair_verified_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  profile_existed boolean;
  profile_ready boolean;
begin
  if (select auth.role()) is distinct from 'authenticated'
    or current_user_id is null
  then
    raise exception using
      errcode = '42501',
      message = 'A verified account is required.';
  end if;

  if not exists (
    select 1
    from auth.users auth_user
    where auth_user.id = current_user_id
      and auth_user.email_confirmed_at is not null
  ) then
    raise exception using
      errcode = '42501',
      message = 'A verified account is required.';
  end if;

  profile_existed := exists (
    select 1
    from public.profiles profile
    where profile.user_id = current_user_id
  );
  profile_ready := private.ensure_verified_user_profile(current_user_id);

  return jsonb_build_object(
    'ready', profile_ready,
    'repaired', not profile_existed and profile_ready
  );
end;
$$;

revoke all on function public.repair_verified_profile()
  from public, anon, authenticated, service_role;
grant execute on function public.repair_verified_profile() to authenticated;

comment on function private.ensure_verified_user_profile(uuid) is
  'Owner-only idempotent implementation shared by verified-user initialization and recovery.';
comment on function public.repair_verified_profile() is
  'Repairs only the authenticated verified account from immutable registration metadata and legacy compatibility state.';

-- Profile creation is now restricted to the verification trigger and repair
-- RPC. Owners retain RLS-scoped reads and updates, including the immutable-DOB
-- trigger that rejects attempts to replace the canonical birth date.
revoke insert on public.profiles from authenticated;
drop policy if exists profiles_insert_own on public.profiles;
grant select, update on public.profiles to authenticated;

-- Preserve the complete acceptance audit history, including registrations from
-- older published versions, while closing the direct client-write path that
-- allowed an authenticated session to manufacture arbitrary future rows.
revoke insert on public.legal_acceptances from authenticated;
drop policy if exists legal_acceptances_insert_own
  on public.legal_acceptances;
grant select on public.legal_acceptances to authenticated;

-- Preserve lost-response idempotency without allowing a second onboarding
-- request to rewrite a completed account. Keep the original validated slug
-- implementation private, then expose a guard that returns the existing goal
-- only when every persisted input still matches the replay exactly.
alter function public.complete_onboarding_from_slugs(
  numeric,
  public.weight_unit,
  text,
  public.activity_level,
  smallint,
  text[],
  text[],
  text[],
  text,
  text,
  public.goal_type,
  numeric,
  numeric,
  date,
  date,
  jsonb,
  jsonb
) rename to complete_onboarding_from_slugs_without_completion_guard;

alter function public.complete_onboarding_from_slugs_without_completion_guard(
  numeric,
  public.weight_unit,
  text,
  public.activity_level,
  smallint,
  text[],
  text[],
  text[],
  text,
  text,
  public.goal_type,
  numeric,
  numeric,
  date,
  date,
  jsonb,
  jsonb
) set schema private;

revoke all on function private.complete_onboarding_from_slugs_without_completion_guard(
  numeric,
  public.weight_unit,
  text,
  public.activity_level,
  smallint,
  text[],
  text[],
  text[],
  text,
  text,
  public.goal_type,
  numeric,
  numeric,
  date,
  date,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

create function public.complete_onboarding_from_slugs(
  profile_height_cm numeric,
  profile_weight_unit public.weight_unit,
  profile_time_zone text,
  profile_activity_level public.activity_level,
  profile_training_days smallint,
  profile_dietary_restrictions text[],
  profile_allergies text[],
  profile_disliked_foods text[],
  profile_safety_context text,
  profile_notes text,
  selected_goal_type public.goal_type,
  current_weight_kg numeric,
  target_weight_kg numeric,
  plan_start_date date,
  target_date date,
  preference_slugs jsonb,
  acknowledged_warnings jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  stored_profile public.profiles%rowtype;
  stored_goal public.goals%rowtype;
  stored_baseline public.weight_entries%rowtype;
  active_goal_count integer;
  baseline_count integer;
  preference record;
  preference_key text;
  sort_key text;
  seen_preference_keys text[] := '{}';
  seen_sort_keys text[] := '{}';
  breakfast_count integer := 0;
  lunch_count integer := 0;
  dinner_count integer := 0;
  requested_preferences jsonb;
  saved_preferences jsonb;
  requested_warnings jsonb;
  saved_warnings jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  select profile.*
  into stored_profile
  from public.profiles profile
  where profile.user_id = current_user_id
  for update;

  if not found or stored_profile.onboarding_status <> 'completed' then
    return private.complete_onboarding_from_slugs_without_completion_guard(
      profile_height_cm,
      profile_weight_unit,
      profile_time_zone,
      profile_activity_level,
      profile_training_days,
      profile_dietary_restrictions,
      profile_allergies,
      profile_disliked_foods,
      profile_safety_context,
      profile_notes,
      selected_goal_type,
      current_weight_kg,
      target_weight_kg,
      plan_start_date,
      target_date,
      preference_slugs,
      acknowledged_warnings
    );
  end if;

  -- Keep the same safe structural errors for malformed retries before checking
  -- whether a valid request differs from the immutable completed state.
  if jsonb_typeof(preference_slugs) is distinct from 'array'
    or jsonb_typeof(acknowledged_warnings) is distinct from 'array'
  then
    raise exception using
      errcode = '22023',
      message = 'Onboarding preference and warning payloads must be arrays.';
  end if;

  if jsonb_array_length(preference_slugs) > 150 then
    raise exception using
      errcode = '22023',
      message = 'Onboarding supports no more than 50 foods per primary meal.';
  end if;

  if jsonb_array_length(acknowledged_warnings) > 30 then
    raise exception using
      errcode = '22023',
      message = 'Onboarding contains too many acknowledged warnings.';
  end if;
  if jsonb_array_length(acknowledged_warnings) > 8 then
    raise exception using
      errcode = '22023',
      message = 'Onboarding supports no more than eight acknowledged meal warnings.';
  end if;

  for preference in
    select value
    from jsonb_array_elements(preference_slugs)
  loop
    if jsonb_typeof(preference.value) <> 'object'
      or preference.value ->> 'mealType' not in (
        'breakfast',
        'lunch',
        'dinner'
      )
      or coalesce(preference.value ->> 'foodSlug', '') !~
        '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or char_length(preference.value ->> 'foodSlug') > 120
      or coalesce(preference.value ->> 'sortOrder', '') !~
        '^([0-9]|[1-4][0-9])$'
    then
      raise exception using
        errcode = '22023',
        message = 'Onboarding meal preferences have an unsupported structure.';
    end if;

    preference_key := concat(
      preference.value ->> 'mealType',
      ':',
      preference.value ->> 'foodSlug'
    );
    if preference_key = any(seen_preference_keys) then
      raise exception using
        errcode = '23505',
        message = 'A food was selected more than once for the same meal.';
    end if;
    seen_preference_keys := array_append(
      seen_preference_keys,
      preference_key
    );

    sort_key := concat(
      preference.value ->> 'mealType',
      ':',
      preference.value ->> 'sortOrder'
    );
    if sort_key = any(seen_sort_keys) then
      raise exception using
        errcode = '22023',
        message = 'Each selected food needs a unique order within its meal.';
    end if;
    seen_sort_keys := array_append(seen_sort_keys, sort_key);

    case preference.value ->> 'mealType'
      when 'breakfast' then breakfast_count := breakfast_count + 1;
      when 'lunch' then lunch_count := lunch_count + 1;
      when 'dinner' then dinner_count := dinner_count + 1;
    end case;
  end loop;

  if breakfast_count = 0 or lunch_count = 0 or dinner_count = 0 then
    raise exception using
      errcode = '23514',
      message = 'Breakfast, lunch, and dinner must each contain at least one selected food.';
  end if;

  select
    count(*),
    (array_agg(goal.id order by goal.created_at desc, goal.id))[1]
  into active_goal_count, stored_goal.id
  from public.goals goal
  where goal.user_id = current_user_id
    and goal.status = 'active';

  if active_goal_count = 1 then
    select goal.*
    into stored_goal
    from public.goals goal
    where goal.id = stored_goal.id
      and goal.user_id = current_user_id;
  end if;

  select
    count(*),
    (array_agg(entry.id order by entry.created_at, entry.id))[1]
  into baseline_count, stored_baseline.id
  from public.weight_entries entry
  where entry.user_id = current_user_id
    and entry.is_onboarding_baseline;

  if baseline_count = 1 then
    select entry.*
    into stored_baseline
    from public.weight_entries entry
    where entry.id = stored_baseline.id
      and entry.user_id = current_user_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'mealType', requested.meal_type,
        'foodSlug', requested.food_slug,
        'sortOrder', requested.sort_order
      )
      order by requested.meal_type, requested.sort_order, requested.food_slug
    ),
    '[]'::jsonb
  )
  into requested_preferences
  from (
    select
      (value ->> 'mealType')::public.meal_type as meal_type,
      value ->> 'foodSlug' as food_slug,
      (value ->> 'sortOrder')::integer as sort_order
    from jsonb_array_elements(preference_slugs)
  ) requested;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'mealType', saved_preference.meal_type::text,
        'foodSlug', food.slug,
        'sortOrder', saved_preference.sort_order
      )
      order by
        saved_preference.meal_type,
        saved_preference.sort_order,
        food.slug
    ),
    '[]'::jsonb
  )
  into saved_preferences
  from public.meal_preferences saved_preference
  join public.foods food on food.id = saved_preference.food_id
  where saved_preference.user_id = current_user_id;

  select coalesce(
    jsonb_agg(requested.item order by requested.item::text),
    '[]'::jsonb
  )
  into requested_warnings
  from (
    select distinct jsonb_build_object(
      'warningCode', value ->> 'warningCode',
      'mealType', value ->> 'mealType',
      'contextVersion', value ->> 'contextVersion'
    ) as item
    from jsonb_array_elements(acknowledged_warnings)
  ) requested;

  select coalesce(
    jsonb_agg(saved.item order by saved.item::text),
    '[]'::jsonb
  )
  into saved_warnings
  from (
    select distinct jsonb_build_object(
      'warningCode', warning.warning_code,
      'mealType', warning.meal_type::text,
      'contextVersion', warning.context_version
    ) as item
    from public.onboarding_warnings warning
    where warning.user_id = current_user_id
      and warning.context_type = 'onboarding'
  ) saved;

  if stored_profile.height_cm is not distinct from profile_height_cm
    and stored_profile.preferred_weight_unit is not distinct from
      profile_weight_unit
    and stored_profile.time_zone is not distinct from profile_time_zone
    and stored_profile.activity_level is not distinct from
      profile_activity_level
    and stored_profile.training_days_per_week is not distinct from
      profile_training_days
    and stored_profile.dietary_restrictions is not distinct from
      coalesce(profile_dietary_restrictions, '{}')
    and stored_profile.allergies is not distinct from
      coalesce(profile_allergies, '{}')
    and stored_profile.disliked_foods is not distinct from
      coalesce(profile_disliked_foods, '{}')
    and stored_profile.safety_context is not distinct from
      profile_safety_context
    and stored_profile.notes is not distinct from profile_notes
    and active_goal_count = 1
    and stored_goal.goal_type is not distinct from selected_goal_type
    and stored_goal.target_weight_kg is not distinct from target_weight_kg
    and stored_goal.plan_start_date is not distinct from plan_start_date
    and stored_goal.target_date is not distinct from target_date
    and baseline_count = 1
    and stored_baseline.local_date is not distinct from plan_start_date
    and stored_baseline.weight_kg is not distinct from current_weight_kg
    and stored_baseline.source_display_unit is not distinct from
      profile_weight_unit
    and requested_preferences = saved_preferences
    and requested_warnings = saved_warnings
  then
    return stored_goal.id;
  end if;

  raise exception using
    errcode = '23514',
    message = 'Onboarding is already completed and cannot be changed through setup.';
end;
$$;

revoke all on function public.complete_onboarding_from_slugs(
  numeric,
  public.weight_unit,
  text,
  public.activity_level,
  smallint,
  text[],
  text[],
  text[],
  text,
  text,
  public.goal_type,
  numeric,
  numeric,
  date,
  date,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_onboarding_from_slugs(
  numeric,
  public.weight_unit,
  text,
  public.activity_level,
  smallint,
  text[],
  text[],
  text[],
  text,
  text,
  public.goal_type,
  numeric,
  numeric,
  date,
  date,
  jsonb,
  jsonb
) to authenticated;

comment on function public.complete_onboarding_from_slugs(
  numeric,
  public.weight_unit,
  text,
  public.activity_level,
  smallint,
  text[],
  text[],
  text[],
  text,
  text,
  public.goal_type,
  numeric,
  numeric,
  date,
  date,
  jsonb,
  jsonb
) is
  'Completes validated onboarding once; exact lost-response replays return the existing goal without rewriting completed state.';

-- Only the validating slug wrapper is a supported client entry point. The
-- owner-executed wrapper can still call this implementation, but no API role
-- can bypass its catalog-eligibility and baseline-preservation checks.
revoke all on function public.complete_onboarding(
  public.profile_gender,
  smallint,
  numeric,
  public.weight_unit,
  text,
  public.activity_level,
  smallint,
  text[],
  text[],
  text[],
  text,
  text,
  public.goal_type,
  numeric,
  numeric,
  date,
  date,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

-- This final migration owns the complete database readiness contract. Keep
-- prior trigger checks while adding the weight, category-refresh, durable
-- upload, and verified-profile repair boundaries introduced in this release.
create or replace function public.application_health(
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
    '20260810040000_repair_verified_profiles';
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

  if to_regclass('public.foods') is null
    or to_regclass('public.food_products') is null
    or to_regclass('public.food_label_submissions') is null
    or to_regclass('public.daily_meal_checkins') is null
    or to_regclass('public.daily_meal_items') is null
    or to_regclass('public.plans') is null
    or to_regclass('private.legacy_age_only_accounts') is null
    or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'date_of_birth'
        and data_type = 'date'
    )
    or to_regprocedure(
      'public.complete_onboarding_from_slugs(numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)'
    ) is null
    or to_regprocedure(
      'public.upsert_daily_checkin(date,boolean,boolean,boolean,text)'
    ) is null
    or to_regprocedure(
      'public.reserve_plan_generation(uuid,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.reserve_food_label_upload(uuid,uuid,public.food_label_image_kind)'
    ) is null
    or to_regprocedure(
      'private.food_basis_is_plan_eligible(uuid,uuid,public.measurement_basis)'
    ) is null
    or to_regprocedure('private.profile_age_on_date(date,date)') is null
    or to_regprocedure('private.is_valid_time_zone(text)') is null
    or to_regprocedure('private.enforce_profile_date_of_birth()') is null
    or to_regprocedure(
      'private.protect_auth_date_of_birth_metadata()'
    ) is null
    or to_regprocedure(
      'private.require_height_for_completed_onboarding()'
    ) is null
    or to_regprocedure(
      'private.publish_confirmed_label_identity()'
    ) is null
    or to_regprocedure(
      'private.scrub_legacy_shared_label_provenance()'
    ) is null
    or to_regprocedure(
      'private.create_confirmed_label_food_with_legacy_gtin(jsonb,uuid)'
    ) is null
    or to_regprocedure(
      'public.create_confirmed_label_food(jsonb,uuid)'
    ) is null
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.profiles',
      'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.profiles',
      'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.profiles',
      'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.legal_acceptances',
      'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.legal_acceptances',
      'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.weight_entries',
      'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.weight_entries',
      'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.weight_entries',
      'DELETE'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.weight_entries',
      'SELECT'
    )
    or exists (
      select 1
      from (
        values
          (
            'public.repair_verified_profile()',
            'authenticated'
          ),
          (
            'public.complete_onboarding_from_slugs(numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)',
            'authenticated'
          ),
          (
            'public.save_weight_entry(date,numeric,public.weight_unit)',
            'authenticated'
          ),
          (
            'public.update_weight_entry(uuid,numeric,public.weight_unit)',
            'authenticated'
          ),
          (
            'public.delete_weight_entry(uuid)',
            'authenticated'
          ),
          (
            'public.cache_external_food(public.food_source_provider,text,jsonb,jsonb,jsonb,jsonb)',
            'service_role'
          ),
          (
            'public.application_health(text)',
            'service_role'
          )
      ) expected(signature, allowed_role)
      left join pg_catalog.pg_proc procedure_entry
        on procedure_entry.oid = to_regprocedure(expected.signature)
      where procedure_entry.oid is null
        or not procedure_entry.prosecdef
        or coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) not like '%search_path=""%'
        or procedure_entry.proowner <> trusted_owner
        or not pg_catalog.has_function_privilege(
          expected.allowed_role,
          procedure_entry.oid,
          'EXECUTE'
        )
        or (
          expected.allowed_role <> 'anon'
          and pg_catalog.has_function_privilege(
            'anon',
            procedure_entry.oid,
            'EXECUTE'
          )
        )
        or (
          expected.allowed_role <> 'authenticated'
          and pg_catalog.has_function_privilege(
            'authenticated',
            procedure_entry.oid,
            'EXECUTE'
          )
        )
        or (
          expected.allowed_role <> 'service_role'
          and pg_catalog.has_function_privilege(
            'service_role',
            procedure_entry.oid,
            'EXECUTE'
          )
        )
    )
    or exists (
      select 1
      from (
        values
          ('private.ensure_verified_user_profile(uuid)'),
          (
            'private.complete_onboarding_from_slugs_without_completion_guard(numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)'
          ),
          (
            'public.complete_onboarding(public.profile_gender,smallint,numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)'
          ),
          (
            'private.cache_external_food_without_category_replacement(public.food_source_provider,text,jsonb,jsonb,jsonb,jsonb)'
          )
      ) expected(signature)
      left join pg_catalog.pg_proc procedure_entry
        on procedure_entry.oid = to_regprocedure(expected.signature)
      where procedure_entry.oid is null
        or not procedure_entry.prosecdef
        or coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) not like '%search_path=""%'
        or procedure_entry.proowner <> trusted_owner
        or pg_catalog.has_function_privilege(
          'anon',
          procedure_entry.oid,
          'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'authenticated',
          procedure_entry.oid,
          'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'service_role',
          procedure_entry.oid,
          'EXECUTE'
        )
    )
    or exists (
      select 1
      from (
        values
          (
            'public',
            'profiles',
            'profiles_enforce_date_of_birth',
            'private.enforce_profile_date_of_birth()'
          ),
          (
            'public',
            'profiles',
            'require_height_before_onboarding_completion',
            'private.require_height_for_completed_onboarding()'
          ),
          (
            'public',
            'food_label_submissions',
            'publish_confirmed_label_identity',
            'private.publish_confirmed_label_identity()'
          ),
          (
            'auth',
            'users',
            'initialize_verified_user',
            'private.initialize_verified_user()'
          ),
          (
            'auth',
            'users',
            'protect_auth_date_of_birth_metadata',
            'private.protect_auth_date_of_birth_metadata()'
          )
      ) expected(
        table_schema,
        table_name,
        trigger_name,
        function_signature
      )
      where not exists (
        select 1
        from pg_catalog.pg_trigger trigger_entry
        join pg_catalog.pg_class table_entry
          on table_entry.oid = trigger_entry.tgrelid
        join pg_catalog.pg_namespace namespace_entry
          on namespace_entry.oid = table_entry.relnamespace
        where namespace_entry.nspname = expected.table_schema
          and table_entry.relname = expected.table_name
          and trigger_entry.tgname = expected.trigger_name
          and trigger_entry.tgfoid = to_regprocedure(
            expected.function_signature
          )
          and trigger_entry.tgenabled = 'O'
          and not trigger_entry.tgisinternal
      )
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
