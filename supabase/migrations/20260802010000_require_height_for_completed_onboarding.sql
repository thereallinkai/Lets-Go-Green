begin;

create or replace function private.require_height_for_completed_onboarding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.onboarding_status = 'completed' and new.height_cm is null then
    if tg_op = 'INSERT' then
      raise exception using
        errcode = '23514',
        message = 'Choose a height before completing onboarding.';
    elsif old.onboarding_status is distinct from 'completed'
      or old.height_cm is not null
    then
      raise exception using
        errcode = '23514',
        message = 'Choose a height before completing onboarding.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.require_height_for_completed_onboarding()
from public, anon, authenticated, service_role;

comment on function private.require_height_for_completed_onboarding() is
  'Requires a selected height when onboarding first becomes complete while preserving legacy completed profiles that predate the requirement.';

drop trigger if exists require_height_before_onboarding_completion
  on public.profiles;
create trigger require_height_before_onboarding_completion
before insert or update of onboarding_status, height_cm on public.profiles
for each row execute function private.require_height_for_completed_onboarding();

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
    '20260802010000_require_height_for_completed_onboarding';
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
    or not exists (
      select 1
      from pg_catalog.pg_trigger trigger_entry
      join pg_catalog.pg_class table_entry
        on table_entry.oid = trigger_entry.tgrelid
      join pg_catalog.pg_namespace namespace_entry
        on namespace_entry.oid = table_entry.relnamespace
      where namespace_entry.nspname = 'public'
        and table_entry.relname = 'profiles'
        and trigger_entry.tgname =
          'require_height_before_onboarding_completion'
        and trigger_entry.tgfoid = to_regprocedure(
          'private.require_height_for_completed_onboarding()'
        )
        and trigger_entry.tgenabled = 'O'
        and not trigger_entry.tgisinternal
    )
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
