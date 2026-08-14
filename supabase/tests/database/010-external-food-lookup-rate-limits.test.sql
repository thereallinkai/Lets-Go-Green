begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

select has_column(
  'public',
  'external_food_lookup_requests',
  'request_kind',
  'external lookup requests identify search and import buckets'
);
select col_not_null(
  'public',
  'external_food_lookup_requests',
  'request_kind',
  'every accepted lookup belongs to a bucket'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_entry
    where constraint_entry.conrelid =
      'public.external_food_lookup_requests'::regclass
      and constraint_entry.conname =
        'external_food_lookup_requests_kind_check'
      and constraint_entry.contype = 'c'
  ),
  'the lookup kind has a database check constraint'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_index index_entry
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_entry.indexrelid
    where index_entry.indrelid =
      'public.external_food_lookup_requests'::regclass
      and index_relation.relname =
        'external_food_lookup_requests_bucket_time_idx'
      and index_entry.indisvalid
  ),
  'the sliding-window bucket lookup has a valid index'
);
select has_function(
  'public',
  'record_external_food_lookup',
  array['uuid', 'food_source_provider', 'text'],
  'the scoped external lookup accounting RPC exists'
);
select ok(
  to_regprocedure(
    'public.record_external_food_lookup(uuid,public.food_source_provider)'
  ) is null,
  'the obsolete unscoped lookup accounting RPC is absent'
);
select function_returns(
  'public',
  'record_external_food_lookup',
  array['uuid', 'food_source_provider', 'text'],
  'jsonb',
  'lookup accounting returns allowance metadata'
);
select ok(
  (
    select procedure_entry.prosecdef
      and procedure_entry.proowner = (
        select table_entry.relowner
        from pg_catalog.pg_class table_entry
        join pg_catalog.pg_namespace namespace_entry
          on namespace_entry.oid = table_entry.relnamespace
        where namespace_entry.nspname = 'public'
          and table_entry.relname = 'profiles'
      )
      and coalesce(
        pg_catalog.array_to_string(procedure_entry.proconfig, ','),
        ''
      ) like '%search_path=""%'
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = to_regprocedure(
      'public.record_external_food_lookup(uuid,public.food_source_provider,text)'
    )
  ),
  'lookup accounting is definer-owned and search-path hardened'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.record_external_food_lookup(uuid,public.food_source_provider,text)',
    'EXECUTE'
  ),
  'the trusted server can reserve provider requests'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.record_external_food_lookup(uuid,public.food_source_provider,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot reserve provider requests'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_external_food_lookup(uuid,public.food_source_provider,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the trusted route'
);
select ok(
  not exists (
    select 1
    from (
      values ('anon'), ('authenticated')
    ) expected(role_name)
    where pg_catalog.has_table_privilege(
      expected.role_name,
      'public.external_food_lookup_requests',
      'SELECT,INSERT,UPDATE,DELETE'
    )
  ),
  'browser roles cannot read or mutate lookup request rows'
);
select ok(
  (
    select position(
      'pg_advisory_xact_lock' in pg_catalog.pg_get_functiondef(
        procedure_entry.oid
      )
    ) > 0
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = to_regprocedure(
      'public.record_external_food_lookup(uuid,public.food_source_provider,text)'
    )
  ),
  'concurrent reservations are serialized inside each user-provider-kind bucket'
);

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
    '13000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'lookup-rate-one@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '13000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'lookup-rate-two@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select public.record_external_food_lookup(
      '13000000-0000-4000-8000-000000000001',
      'usda_fdc',
      'search'
    )
  $$,
  '42501',
  'permission denied for function record_external_food_lookup',
  'an authenticated client cannot execute trusted lookup accounting'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
set local role service_role;

create temporary table pg_temp.lookup_results (
  sequence_number integer not null,
  result jsonb not null
);

select throws_ok(
  $$
    select public.record_external_food_lookup(
      '13000000-0000-4000-8000-000000000001',
      'usda_fdc',
      'preview'
    )
  $$,
  '22023',
  'External lookup kind must be search or import.',
  'unknown lookup kinds are rejected before accounting'
);

insert into pg_temp.lookup_results (sequence_number, result)
select
  request_number,
  public.record_external_food_lookup(
    '13000000-0000-4000-8000-000000000001',
    'usda_fdc',
    'search'
  )
from pg_catalog.generate_series(1, 6) request_number;

select ok(
  (
    select count(*) = 6
      and bool_and((result ->> 'allowed')::boolean)
      and bool_and((result ->> 'retryAfterSeconds')::integer = 0)
    from pg_temp.lookup_results
  ),
  'the first six submitted searches in a provider bucket are accepted'
);

reset role;
select is(
  (
    select count(*)
    from public.external_food_lookup_requests
    where user_id = '13000000-0000-4000-8000-000000000001'
      and provider = 'usda_fdc'
      and request_kind = 'search'
  ),
  6::bigint,
  'six accepted searches create exactly six accounting rows'
);
set local role service_role;

truncate table pg_temp.lookup_results;
insert into pg_temp.lookup_results (sequence_number, result)
values (
  7,
  public.record_external_food_lookup(
    '13000000-0000-4000-8000-000000000001',
    'usda_fdc',
    'search'
  )
);

select is(
  (
    select result ->> 'allowed'
    from pg_temp.lookup_results
    where sequence_number = 7
  ),
  'false',
  'the seventh search is rejected at the exact threshold'
);
select is(
  (
    select (result ->> 'retryAfterSeconds')::integer
    from pg_temp.lookup_results
    where sequence_number = 7
  ),
  300,
  'a fresh saturated bucket reports the exact five-minute delay'
);

insert into pg_temp.lookup_results (sequence_number, result)
values (
  8,
  public.record_external_food_lookup(
    '13000000-0000-4000-8000-000000000001',
    'usda_fdc',
    'search'
  )
);
select is(
  (
    select result ->> 'retryAfterSeconds'
    from pg_temp.lookup_results
    where sequence_number = 8
  ),
  (
    select result ->> 'retryAfterSeconds'
    from pg_temp.lookup_results
    where sequence_number = 7
  ),
  'retrying a rejected search does not extend its cooldown'
);

reset role;
select is(
  (
    select count(*)
    from public.external_food_lookup_requests
    where user_id = '13000000-0000-4000-8000-000000000001'
      and provider = 'usda_fdc'
      and request_kind = 'search'
  ),
  6::bigint,
  'rejected searches are never recorded'
);
set local role service_role;

select is(
  (
    public.record_external_food_lookup(
      '13000000-0000-4000-8000-000000000001',
      'usda_fdc',
      'import'
    ) ->> 'allowed'
  ),
  'true',
  'a saturated search bucket cannot block an import'
);

reset role;
select is(
  (
    select count(*)
    from public.external_food_lookup_requests
    where user_id = '13000000-0000-4000-8000-000000000001'
      and provider = 'usda_fdc'
      and request_kind = 'import'
  ),
  1::bigint,
  'the accepted import uses its own accounting bucket'
);
set local role service_role;
select is(
  (
    public.record_external_food_lookup(
      '13000000-0000-4000-8000-000000000001',
      'open_food_facts',
      'search'
    ) ->> 'allowed'
  ),
  'true',
  'one provider cannot consume another provider bucket'
);
select is(
  (
    public.record_external_food_lookup(
      '13000000-0000-4000-8000-000000000002',
      'usda_fdc',
      'search'
    ) ->> 'allowed'
  ),
  'true',
  'one user cannot consume another user bucket'
);

reset role;
update public.external_food_lookup_requests
set requested_at = now() - interval '5 minutes 1 second'
where user_id = '13000000-0000-4000-8000-000000000001'
  and provider = 'usda_fdc'
  and request_kind = 'search';
set local role service_role;

select is(
  (
    public.record_external_food_lookup(
      '13000000-0000-4000-8000-000000000001',
      'usda_fdc',
      'search'
    ) ->> 'allowed'
  ),
  'true',
  'an expired search window immediately admits a new request'
);

reset role;
select is(
  (
    select count(*)
    from public.external_food_lookup_requests
    where user_id = '13000000-0000-4000-8000-000000000001'
      and provider = 'usda_fdc'
      and request_kind = 'search'
      and requested_at >= now() - interval '5 minutes'
  ),
  1::bigint,
  'expired accounting rows do not contribute to the active window'
);
select is(
  (
    select count(*)
    from public.external_food_lookup_requests
    where user_id = '13000000-0000-4000-8000-000000000001'
      and provider = 'usda_fdc'
      and request_kind = 'search'
  ),
  1::bigint,
  'expired limiter state is pruned when its bucket is used again'
);
set local role service_role;

truncate table pg_temp.lookup_results;
insert into pg_temp.lookup_results (sequence_number, result)
select
  request_number,
  public.record_external_food_lookup(
    '13000000-0000-4000-8000-000000000001',
    'usda_fdc',
    'import'
  )
from pg_catalog.generate_series(2, 4) request_number;

select ok(
  (
    select count(*) = 3
      and bool_and((result ->> 'allowed')::boolean)
    from pg_temp.lookup_results
  ),
  'the import bucket accepts four submitted imports per window'
);
select is(
  (
    public.record_external_food_lookup(
      '13000000-0000-4000-8000-000000000001',
      'usda_fdc',
      'import'
    ) ->> 'allowed'
  ),
  'false',
  'the fifth import is bounded independently of search'
);

reset role;
select is(
  (
    select count(*)
    from public.external_food_lookup_requests
    where user_id = '13000000-0000-4000-8000-000000000001'
      and provider = 'usda_fdc'
      and request_kind = 'import'
  ),
  4::bigint,
  'a rejected import does not add an accounting row'
);
set local role service_role;

select ok(
  (
    public.application_health(
      '20260813000000_reserve_external_food_import_capacity'
    ) ->> 'migrationCompatible'
  )::boolean,
  'application health accepts the complete beta.5 database contract'
);
select is(
  (
    public.application_health(
      '20260810050000_make_label_uploads_crash_recoverable'
    ) ->> 'migrationCompatible'
  )::boolean,
  false,
  'application health rejects the previous migration identifier'
);

reset role;
alter table public.external_food_lookup_requests
  drop constraint external_food_lookup_requests_kind_check;
set local role service_role;

select is(
  (
    public.application_health(
      '20260813000000_reserve_external_food_import_capacity'
    ) ->> 'migrationCompatible'
  )::boolean,
  false,
  'application health reports drift when the lookup kind constraint is missing'
);

select * from finish();

rollback;
