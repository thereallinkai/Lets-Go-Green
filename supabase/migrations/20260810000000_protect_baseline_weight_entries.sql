begin;

-- Weight history is readable by its owner, but every supported mutation now
-- passes through a security-definer RPC. This prevents an authenticated client
-- from editing, deleting, or manufacturing the onboarding baseline through
-- direct PostgREST table access. The existing onboarding completion RPC is
-- itself security definer, so it can still intentionally establish or revise
-- the baseline while completing the atomic onboarding transaction.
revoke insert, update, delete on public.weight_entries from authenticated;
grant select on public.weight_entries to authenticated;

create function public.save_weight_entry(
  entry_date date,
  entry_weight_kg numeric,
  entry_source_display_unit public.weight_unit
)
returns public.weight_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  user_time_zone text;
  saved_entry public.weight_entries;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if entry_date is null
    or entry_weight_kg is null
    or entry_source_display_unit is null
    or entry_weight_kg not between 20 and 500
  then
    raise exception using
      errcode = '22023',
      message = 'A valid date, weight, and display unit are required.';
  end if;

  select profile.time_zone
  into user_time_zone
  from public.profiles profile
  where profile.user_id = current_user_id;

  if user_time_zone is null
    or not private.is_valid_time_zone(user_time_zone)
  then
    raise exception using
      errcode = '23514',
      message = 'A profile with a valid time zone is required.';
  end if;

  if entry_date > (now() at time zone user_time_zone)::date then
    raise exception using
      errcode = '23514',
      message = 'A weight entry cannot use a future local date.';
  end if;

  insert into public.weight_entries (
    user_id,
    local_date,
    weight_kg,
    source_display_unit,
    is_onboarding_baseline
  )
  values (
    current_user_id,
    entry_date,
    entry_weight_kg,
    entry_source_display_unit,
    false
  )
  on conflict (user_id, local_date) do update
  set
    weight_kg = excluded.weight_kg,
    source_display_unit = excluded.source_display_unit
  where not public.weight_entries.is_onboarding_baseline
  returning * into saved_entry;

  if saved_entry.id is null then
    raise exception using
      errcode = '23514',
      message = 'The onboarding baseline weight is protected.';
  end if;

  return saved_entry;
end;
$$;

create function public.update_weight_entry(
  target_entry_id uuid,
  entry_weight_kg numeric,
  entry_source_display_unit public.weight_unit
)
returns public.weight_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_entry public.weight_entries;
  saved_entry public.weight_entries;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if target_entry_id is null
    or entry_weight_kg is null
    or entry_source_display_unit is null
    or entry_weight_kg not between 20 and 500
  then
    raise exception using
      errcode = '22023',
      message = 'A valid weight entry, weight, and display unit are required.';
  end if;

  select entry.*
  into existing_entry
  from public.weight_entries entry
  where entry.id = target_entry_id
    and entry.user_id = current_user_id
  for update;

  if not found then
    return null;
  end if;

  if existing_entry.is_onboarding_baseline then
    raise exception using
      errcode = '23514',
      message = 'The onboarding baseline weight is protected.';
  end if;

  update public.weight_entries entry
  set
    weight_kg = entry_weight_kg,
    source_display_unit = entry_source_display_unit
  where entry.id = target_entry_id
    and entry.user_id = current_user_id
  returning entry.* into saved_entry;

  return saved_entry;
end;
$$;

create function public.delete_weight_entry(
  target_entry_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_entry public.weight_entries;
  deleted_entry_id uuid;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if target_entry_id is null then
    raise exception using
      errcode = '22023',
      message = 'A valid weight entry is required.';
  end if;

  select entry.*
  into existing_entry
  from public.weight_entries entry
  where entry.id = target_entry_id
    and entry.user_id = current_user_id
  for update;

  if not found then
    return null;
  end if;

  if existing_entry.is_onboarding_baseline then
    raise exception using
      errcode = '23514',
      message = 'The onboarding baseline weight is protected.';
  end if;

  delete from public.weight_entries entry
  where entry.id = target_entry_id
    and entry.user_id = current_user_id
  returning entry.id into deleted_entry_id;

  return deleted_entry_id;
end;
$$;

revoke all on function public.save_weight_entry(
  date,
  numeric,
  public.weight_unit
) from public, anon;
grant execute on function public.save_weight_entry(
  date,
  numeric,
  public.weight_unit
) to authenticated;

revoke all on function public.update_weight_entry(
  uuid,
  numeric,
  public.weight_unit
) from public, anon;
grant execute on function public.update_weight_entry(
  uuid,
  numeric,
  public.weight_unit
) to authenticated;

revoke all on function public.delete_weight_entry(uuid) from public, anon;
grant execute on function public.delete_weight_entry(uuid) to authenticated;

comment on function public.save_weight_entry(
  date,
  numeric,
  public.weight_unit
) is
  'Creates or updates an owned non-baseline daily weight while preserving the immutable onboarding baseline.';
comment on function public.update_weight_entry(
  uuid,
  numeric,
  public.weight_unit
) is
  'Updates an owned non-baseline weight entry and rejects onboarding-baseline changes.';
comment on function public.delete_weight_entry(uuid) is
  'Deletes an owned non-baseline weight entry and rejects onboarding-baseline deletion.';

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
    '20260810000000_protect_baseline_weight_entries';
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Health details are restricted to the trusted server boundary.';
  end if;

  if to_regclass('public.foods') is null
    or to_regclass('public.food_products') is null
    or to_regclass('public.food_label_submissions') is null
    or to_regclass('public.daily_meal_checkins') is null
    or to_regclass('public.daily_meal_items') is null
    or to_regclass('public.plans') is null
    or to_regclass('private.legacy_age_only_accounts') is null
    or to_regprocedure(
      'public.save_weight_entry(date,numeric,public.weight_unit)'
    ) is null
    or to_regprocedure(
      'public.update_weight_entry(uuid,numeric,public.weight_unit)'
    ) is null
    or to_regprocedure('public.delete_weight_entry(uuid)') is null
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
  then
    return jsonb_build_object(
      'databaseReachable',
      true,
      'migrationCompatible',
      false
    );
  end if;

  return jsonb_build_object(
    'databaseReachable',
    true,
    'migrationCompatible',
    expected_migration = current_migration
  );
end;
$$;

revoke all on function public.application_health(text) from public;
grant execute on function public.application_health(text) to service_role;

commit;
