-- Keep external food discovery responsive without allowing repeated searches
-- to consume the capacity needed to import a reviewed result. Search and
-- import requests use independent, provider-scoped sliding windows.

alter table public.external_food_lookup_requests
  add column request_kind text not null default 'search';

alter table public.external_food_lookup_requests
  alter column request_kind drop default,
  add constraint external_food_lookup_requests_kind_check
    check (request_kind in ('search', 'import'));

create index external_food_lookup_requests_bucket_time_idx
  on public.external_food_lookup_requests (
    user_id,
    provider,
    request_kind,
    requested_at
  );

revoke all on function public.record_external_food_lookup(
  uuid,
  public.food_source_provider
) from public, anon, authenticated, service_role;

drop function public.record_external_food_lookup(
  uuid,
  public.food_source_provider
);

create function public.record_external_food_lookup(
  target_user_id uuid,
  lookup_provider public.food_source_provider,
  lookup_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_duration constant interval := interval '5 minutes';
  request_limit integer;
  request_count integer;
  oldest_request timestamptz;
  retry_after_seconds integer;
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
    or lookup_provider is null
    or lookup_provider not in ('usda_fdc', 'open_food_facts')
  then
    raise exception using
      errcode = '42501',
      message = 'External lookup accounting is restricted to the trusted server.';
  end if;

  if lookup_kind is null or lookup_kind not in ('search', 'import') then
    raise exception using
      errcode = '22023',
      message = 'External lookup kind must be search or import.';
  end if;

  -- Search is intentionally bounded to six submitted provider searches per
  -- five minutes. One adapter may use multiple upstream endpoints to balance
  -- result types, but each explicit app search consumes one bucket slot.
  -- Imports have a separate four-call bucket, so even a saturated search
  -- bucket cannot prevent the user from importing a result they already saw.
  request_limit := case lookup_kind
    when 'search' then 6
    else 4
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'food-lookup:' || target_user_id::text || ':' ||
        lookup_provider::text || ':' || lookup_kind,
      0
    )
  );

  -- These rows are transient limiter state, not audit provenance. Prune all
  -- expired state for this user on every accepted or rejected reservation so
  -- active accounts cannot grow the table without bound.
  delete from public.external_food_lookup_requests request
  where request.user_id = target_user_id
    and request.requested_at < now() - window_duration;

  select count(*)::integer, min(request.requested_at)
  into request_count, oldest_request
  from public.external_food_lookup_requests request
  where request.user_id = target_user_id
    and request.provider = lookup_provider
    and request.request_kind = lookup_kind
    and request.requested_at >= now() - window_duration;

  if request_count >= request_limit then
    retry_after_seconds := greatest(
      1,
      pg_catalog.ceil(
        extract(
          epoch from (oldest_request + window_duration - now())
        )
      )::integer
    );

    -- Rejected attempts are deliberately not recorded. Retrying early cannot
    -- move the oldest accepted request or extend the cooldown.
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'retryAfterSeconds', retry_after_seconds
    );
  end if;

  insert into public.external_food_lookup_requests (
    user_id,
    provider,
    request_kind
  )
  values (target_user_id, lookup_provider, lookup_kind);

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'retryAfterSeconds', 0
  );
end;
$$;

revoke all on function public.record_external_food_lookup(
  uuid,
  public.food_source_provider,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.record_external_food_lookup(
  uuid,
  public.food_source_provider,
  text
) to service_role;

comment on column public.external_food_lookup_requests.request_kind is
  'Independent search or import rate-limit bucket; rejected requests are not stored.';
comment on function public.record_external_food_lookup(
  uuid,
  public.food_source_provider,
  text
) is
  'Atomically reserves a provider request and returns allowed plus an exact retry delay.';

-- Preserve the complete beta.4 readiness contract as a private implementation
-- detail, then layer the beta.5 lookup contract on top. This avoids copying and
-- drifting hundreds of existing health checks while keeping one public health
-- endpoint and one exact current migration identifier.
alter function public.application_health(text)
  rename to application_health_beta4;
alter function public.application_health_beta4(text)
  set schema private;
revoke all on function private.application_health_beta4(text)
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
    '20260813000000_reserve_external_food_import_capacity';
  previous_health jsonb;
  lookup_rpc oid := to_regprocedure(
    'public.record_external_food_lookup(uuid,public.food_source_provider,text)'
  );
  previous_health_rpc oid := to_regprocedure(
    'private.application_health_beta4(text)'
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

  previous_health := private.application_health_beta4(
    '20260810050000_make_label_uploads_crash_recoverable'
  );

  if coalesce(
      (previous_health ->> 'databaseReachable')::boolean,
      false
    ) is not true
    or coalesce(
      (previous_health ->> 'migrationCompatible')::boolean,
      false
    ) is not true
    or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'external_food_lookup_requests'
        and column_name = 'request_kind'
        and data_type = 'text'
        and is_nullable = 'NO'
    )
    or lookup_rpc is null
    or previous_health_rpc is null
    or to_regprocedure(
      'public.record_external_food_lookup(uuid,public.food_source_provider)'
    ) is not null
    or not exists (
      select 1
      from pg_catalog.pg_constraint constraint_entry
      where constraint_entry.conrelid =
        'public.external_food_lookup_requests'::regclass
        and constraint_entry.conname =
          'external_food_lookup_requests_kind_check'
        and constraint_entry.contype = 'c'
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = previous_health_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and procedure_entry.prorettype = 'jsonb'::regtype
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
      from pg_catalog.pg_index index_entry
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_entry.indexrelid
      where index_entry.indrelid =
        'public.external_food_lookup_requests'::regclass
        and index_relation.relname =
          'external_food_lookup_requests_bucket_time_idx'
        and index_entry.indisvalid
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_entry
      where procedure_entry.oid = lookup_rpc
        and procedure_entry.prosecdef
        and procedure_entry.proowner = trusted_owner
        and procedure_entry.prorettype = 'jsonb'::regtype
        and coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) like '%search_path=""%'
    )
    or not pg_catalog.has_function_privilege(
      'service_role',
      lookup_rpc,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      lookup_rpc,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      lookup_rpc,
      'EXECUTE'
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
