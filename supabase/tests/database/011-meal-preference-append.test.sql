begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(41);

select has_function(
  'public',
  'append_meal_preference',
  array['meal_type', 'uuid'],
  'the atomic meal-preference append RPC exists'
);

select has_function(
  'public',
  'remove_meal_preference',
  array['meal_type', 'uuid'],
  'the atomic meal-preference remove RPC exists'
);

select has_function(
  'public',
  'create_food_label_draft',
  array['uuid', 'jsonb'],
  'the atomic food-label draft RPC exists'
);

select has_function(
  'private',
  'food_label_payload_is_valid',
  array['jsonb', 'boolean'],
  'the exact private food-label payload validator exists'
);

select has_function(
  'private',
  'food_label_allergens_are_consistent',
  array['jsonb'],
  'the shared negative-aware allergen validator exists'
);

select has_function(
  'public',
  'discard_food_label_draft',
  array['uuid', 'uuid'],
  'the trusted label-draft discard RPC exists'
);

select has_table(
  'private',
  'food_label_draft_creation_events',
  'trusted label-draft creation timestamps survive discard'
);

select has_table(
  'private',
  'food_label_discard_cleanup',
  'discard storage cleanup survives submission metadata deletion'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'private.food_label_payload_is_valid(jsonb,boolean)',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'private.food_label_payload_is_valid(jsonb,boolean)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'private.food_label_payload_is_valid(jsonb,boolean)',
      'EXECUTE'
    ),
  'no API role can invoke the private exact payload validator directly'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.discard_food_label_draft(uuid,uuid)',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.discard_food_label_draft(uuid,uuid)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.discard_food_label_draft(uuid,uuid)',
      'EXECUTE'
    ),
  'discard is service-role-only and cannot be called by a browser session'
);

select ok(
  not pg_catalog.has_table_privilege(
    'service_role',
    'private.food_label_draft_creation_events',
    'SELECT,INSERT,UPDATE,DELETE'
  )
    and not pg_catalog.has_table_privilege(
      'service_role',
      'private.food_label_discard_cleanup',
      'SELECT,INSERT,UPDATE,DELETE'
    ),
  'private creation and discard ledgers are reachable only through owner-controlled definer functions'
);

select ok(
  (
    select procedure_entry.prosecdef
      and procedure_entry.proowner = (
        select table_entry.relowner
        from pg_catalog.pg_class table_entry
        join pg_catalog.pg_namespace table_namespace
          on table_namespace.oid = table_entry.relnamespace
        where table_namespace.nspname = 'public'
          and table_entry.relname = 'meal_preferences'
      )
      and coalesce(
        pg_catalog.array_to_string(procedure_entry.proconfig, ','),
        ''
      ) like '%search_path=""%'
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = pg_catalog.to_regprocedure(
      'public.append_meal_preference(public.meal_type,uuid)'
    )
  ),
  'the append RPC is owner-controlled, definer-secured, and search-path hardened'
);

select ok(
  (
    select procedure_entry.prosecdef
      and procedure_entry.proowner = (
        select table_entry.relowner
        from pg_catalog.pg_class table_entry
        join pg_catalog.pg_namespace table_namespace
          on table_namespace.oid = table_entry.relnamespace
        where table_namespace.nspname = 'public'
          and table_entry.relname = 'meal_preferences'
      )
      and coalesce(
        pg_catalog.array_to_string(procedure_entry.proconfig, ','),
        ''
      ) like '%search_path=""%'
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = pg_catalog.to_regprocedure(
      'public.remove_meal_preference(public.meal_type,uuid)'
    )
  ),
  'the remove RPC is owner-controlled, definer-secured, and search-path hardened'
);

select ok(
  (
    select procedure_entry.prosecdef
      and procedure_entry.proowner = (
        select table_entry.relowner
        from pg_catalog.pg_class table_entry
        join pg_catalog.pg_namespace table_namespace
          on table_namespace.oid = table_entry.relnamespace
        where table_namespace.nspname = 'public'
          and table_entry.relname = 'food_label_submissions'
      )
      and coalesce(
        pg_catalog.array_to_string(procedure_entry.proconfig, ','),
        ''
      ) like '%search_path=""%'
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = pg_catalog.to_regprocedure(
      'public.create_food_label_draft(uuid,jsonb)'
    )
  ),
  'the label-draft RPC is owner-controlled, definer-secured, and search-path hardened'
);

select ok(
  (
    select pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(procedure_entry.oid),
      'pg_advisory_xact_lock'
    ) > 0
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure_entry.oid),
        'preference_count >= 50'
      ) > 0
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure_entry.oid),
        'DUPLICATE_MEAL_PREFERENCE'
      ) > 0
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure_entry.oid),
        'ONBOARDING_NOT_COMPLETED'
      ) > 0
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure_entry.oid),
        'for update'
      ) > 0
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure_entry.oid),
        'plan_eligible_food_ids'
      ) > 0
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = pg_catalog.to_regprocedure(
      'public.append_meal_preference(public.meal_type,uuid)'
    )
  ),
  'the append contract locks onboarding and serializes each meal before enforcing duplicate, capacity, and eligibility rules'
);

select ok(
  (
    select pg_catalog.strpos(
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
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = pg_catalog.to_regprocedure(
      'public.remove_meal_preference(public.meal_type,uuid)'
    )
  ),
  'remove shares the meal lock and returns an idempotent already-absent result'
);

select ok(
  (
    select pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(procedure_entry.oid),
      'pg_advisory_xact_lock'
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
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = pg_catalog.to_regprocedure(
      'public.create_food_label_draft(uuid,jsonb)'
    )
  ),
  'label draft creation locks before trusted-time quotas and exact replay checks'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.append_meal_preference(public.meal_type,uuid)',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.append_meal_preference(public.meal_type,uuid)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.append_meal_preference(public.meal_type,uuid)',
      'EXECUTE'
    ),
  'only authenticated sessions can execute the append RPC'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.remove_meal_preference(public.meal_type,uuid)',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.remove_meal_preference(public.meal_type,uuid)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.remove_meal_preference(public.meal_type,uuid)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_food_label_draft(uuid,jsonb)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.create_food_label_draft(uuid,jsonb)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.create_food_label_draft(uuid,jsonb)',
      'EXECUTE'
    ),
  'only authenticated sessions can execute remove or create a label draft'
);

select ok(
  pg_catalog.has_table_privilege(
    'authenticated',
    'public.meal_preferences',
    'SELECT'
  )
    and not pg_catalog.has_table_privilege(
      'authenticated',
      'public.meal_preferences',
      'DELETE'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated',
      'public.meal_preferences',
      'INSERT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated',
      'public.meal_preferences',
      'UPDATE'
    ),
  'authenticated clients can read preferences but cannot bypass either mutation RPC'
);

select ok(
  pg_catalog.has_table_privilege(
    'authenticated',
    'public.food_label_submissions',
    'SELECT'
  )
    and not pg_catalog.has_table_privilege(
      'authenticated',
      'public.food_label_submissions',
      'INSERT'
    )
    and not exists (
      select 1
      from pg_catalog.pg_policy policy_entry
      where policy_entry.polrelid =
        'public.food_label_submissions'::pg_catalog.regclass
        and policy_entry.polcmd = 'a'
    ),
  'authenticated clients cannot bypass atomic label-draft creation'
);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select is(
  (
    public.application_health(
      '20260814000000_append_meal_preferences'
    ) ->> 'migrationCompatible'
  )::boolean,
  true,
  'health accepts the current meal-preference migration contract'
);

select is(
  (
    public.application_health(
      '20260813000000_reserve_external_food_import_capacity'
    ) ->> 'migrationCompatible'
  )::boolean,
  false,
  'health rejects the previous migration identifier'
);

reset role;

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
    'a1000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'meal-owner@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a2000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'private-food-owner@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a3000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'meal-limit@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a4000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'onboarding-after-revoke@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a5000000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'label-recent-limit@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.profiles (
  user_id,
  full_name,
  gender,
  age,
  date_of_birth,
  height_cm,
  time_zone,
  onboarding_status,
  onboarding_completed_at
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'Meal Owner',
    'prefer_not_to_say',
    30,
    (current_date - interval '30 years')::date,
    175,
    'UTC',
    'completed',
    now()
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    'Private Food Owner',
    'prefer_not_to_say',
    31,
    (current_date - interval '31 years')::date,
    175,
    'UTC',
    'completed',
    now()
  ),
  (
    'a3000000-0000-4000-8000-000000000003',
    'Meal Limit',
    'prefer_not_to_say',
    32,
    (current_date - interval '32 years')::date,
    175,
    'UTC',
    'completed',
    now()
  ),
  (
    'a4000000-0000-4000-8000-000000000004',
    'Onboarding User',
    'prefer_not_to_say',
    33,
    (current_date - interval '33 years')::date,
    175,
    'UTC',
    'in_progress',
    null
  );

insert into public.legal_acceptances (
  user_id,
  document_type,
  document_version
)
values
  (
    'a4000000-0000-4000-8000-000000000004',
    'terms',
    'test-v1'
  ),
  (
    'a4000000-0000-4000-8000-000000000004',
    'privacy',
    'test-v1'
  );

insert into public.foods (
  id,
  slug,
  english_name,
  source,
  ownership_type,
  owner_user_id,
  verification_status,
  food_kind,
  catalog_status
)
values (
  'e1000000-0000-4000-8000-000000000001',
  'private-owner-label-fixture',
  'Private owner label fixture',
  'Account-confirmed package label',
  'private',
  'a2000000-0000-4000-8000-000000000002',
  'user_label',
  'branded_product',
  'active'
);

insert into public.food_sources (
  id,
  food_id,
  provider,
  external_id,
  source_version,
  attribution_text,
  payload_sha256
)
values (
  'e1100000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'user_label',
  'private-owner-label-fixture',
  'database-test-v1',
  'Account-confirmed package label fixture.',
  repeat('e', 64)
);

insert into public.food_nutrition (
  food_id,
  measurement_basis,
  reference_quantity,
  reference_unit,
  serving_weight_grams,
  calories,
  protein_g,
  carbohydrate_g,
  fat_g,
  source_name,
  source_reference,
  verification_status,
  source_id
)
values (
  'e1000000-0000-4000-8000-000000000001',
  'label_serving',
  1,
  'serving',
  30,
  120,
  24,
  3,
  2,
  'Account-confirmed package label',
  'Private fixture nutrition label',
  'user_label',
  'e1100000-0000-4000-8000-000000000001'
);

insert into public.food_safety_metadata (
  food_id,
  allergen_data_status,
  restriction_data_status
)
values (
  'e1000000-0000-4000-8000-000000000001',
  'user_confirmed',
  'user_confirmed'
);

insert into public.foods (
  id,
  slug,
  english_name,
  source,
  ownership_type,
  owner_user_id,
  verification_status,
  food_kind,
  catalog_status
)
select
  pg_catalog.format(
    'f1000000-0000-4000-8000-%s',
    pg_catalog.lpad(food_number::text, 12, '0')
  )::uuid,
  'meal-limit-fixture-' || food_number,
  'Meal limit fixture ' || food_number,
  'Database test fixture',
  'catalog',
  null,
  'verified',
  'generic',
  'active'
from pg_catalog.generate_series(1, 51) food_number;

insert into public.food_nutrition (
  food_id,
  measurement_basis,
  reference_quantity,
  reference_unit,
  calories,
  protein_g,
  carbohydrate_g,
  fat_g,
  source_name,
  source_reference,
  verification_status,
  source_version
)
select
  pg_catalog.format(
    'f1000000-0000-4000-8000-%s',
    pg_catalog.lpad(food_number::text, 12, '0')
  )::uuid,
  'raw',
  100,
  'g',
  100,
  10,
  10,
  2,
  'Database test fixture',
  'meal-preference-limit-fixture',
  'verified',
  'test-v1'
from pg_catalog.generate_series(1, 51) food_number;

insert into public.food_safety_metadata (
  food_id,
  allergen_data_status,
  restriction_data_status
)
select
  pg_catalog.format(
    'f1000000-0000-4000-8000-%s',
    pg_catalog.lpad(food_number::text, 12, '0')
  )::uuid,
  'reviewed',
  'reviewed'
from pg_catalog.generate_series(1, 51) food_number;

select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.meal_preferences (
  user_id,
  meal_type,
  food_id,
  sort_order
)
select
  'a3000000-0000-4000-8000-000000000003',
  'breakfast',
  pg_catalog.format(
    'f1000000-0000-4000-8000-%s',
    pg_catalog.lpad(food_number::text, 12, '0')
  )::uuid,
  food_number - 1
from pg_catalog.generate_series(1, 50) food_number;

insert into public.meal_preferences (
  user_id,
  meal_type,
  food_id,
  sort_order
)
values (
  'a2000000-0000-4000-8000-000000000002',
  'breakfast',
  '10000000-0000-4000-8000-000000000002',
  0
);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$select public.append_meal_preference('breakfast', '10000000-0000-4000-8000-000000000001')$$,
  '42501',
  'permission denied for function append_meal_preference',
  'anonymous clients cannot execute meal-preference append'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select throws_ok(
  $$select public.append_meal_preference('breakfast', '10000000-0000-4000-8000-000000000001')$$,
  '42501',
  'permission denied for function append_meal_preference',
  'service-role clients cannot execute the user-owned append RPC'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$select public.append_meal_preference('breakfast', '10000000-0000-4000-8000-000000000001')$$,
  '42501',
  'MEAL_PREFERENCE_AUTH_REQUIRED',
  'an authenticated role without an account cannot append a preference'
);

select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$select public.append_meal_preference('morning_snack', '10000000-0000-4000-8000-000000000001')$$,
  '22023',
  'MEAL_PREFERENCE_INVALID_MEAL',
  'the preference editor cannot append an optional snack slot'
);

select is(
  (
    select sort_order
    from public.append_meal_preference(
      'breakfast',
      '10000000-0000-4000-8000-000000000002'
    )
  ),
  0,
  'the first preference receives order zero'
);

select ok(
  exists (
    select 1
    from public.meal_preferences preference
    where preference.user_id =
      'a1000000-0000-4000-8000-000000000001'
      and preference.meal_type = 'breakfast'
      and preference.food_id =
        '10000000-0000-4000-8000-000000000002'
  ),
  'the append RPC writes only to the authenticated owner'
);

select throws_ok(
  $$select public.append_meal_preference('breakfast', '10000000-0000-4000-8000-000000000002')$$,
  '23505',
  'DUPLICATE_MEAL_PREFERENCE',
  'a duplicate meal and food pair is rejected without another row'
);

select throws_ok(
  $$select public.append_meal_preference('breakfast', '10000000-0000-4000-8000-000000000008')$$,
  '23514',
  'FOOD_NOT_PLAN_ELIGIBLE',
  'an unverified catalog food cannot become a meal preference'
);

select throws_ok(
  $$select public.append_meal_preference('breakfast', 'e1000000-0000-4000-8000-000000000001')$$,
  '23514',
  'FOOD_NOT_PLAN_ELIGIBLE',
  'another account private label food cannot become a preference'
);

select is(
  (
    select sort_order
    from public.append_meal_preference(
      'breakfast',
      '10000000-0000-4000-8000-000000000003'
    )
  ),
  1,
  'a serialized second append receives the next collision-free order'
);

select is(
  (
    select count(*)::integer
    from public.meal_preferences preference
    where preference.user_id =
      'a1000000-0000-4000-8000-000000000001'
      and preference.meal_type = 'breakfast'
  ),
  2,
  'successful appends create exactly one row each'
);

select throws_ok(
  $$
    insert into public.meal_preferences (
      user_id,
      meal_type,
      food_id,
      sort_order
    ) values (
      'a1000000-0000-4000-8000-000000000001',
      'lunch',
      '10000000-0000-4000-8000-000000000001',
      0
    )
  $$,
  '42501',
  'permission denied for table meal_preferences',
  'authenticated clients cannot bypass append with direct insert'
);

select throws_ok(
  $$
    update public.meal_preferences
    set sort_order = 99
    where user_id = 'a1000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table meal_preferences',
  'authenticated clients cannot bypass ordering with direct update'
);

select is(
  (
    select already_absent
    from public.remove_meal_preference(
      'breakfast',
      '10000000-0000-4000-8000-000000000002'
    )
  ),
  false,
  'the owner remove RPC deletes an existing saved preference'
);

select is(
  (
    select already_absent
    from public.remove_meal_preference(
      'breakfast',
      '10000000-0000-4000-8000-000000000002'
    )
  ),
  true,
  'repeating the owner remove RPC is an idempotent already-absent success'
);

reset role;

select ok(
  exists (
    select 1
    from public.meal_preferences preference
    where preference.user_id =
      'a2000000-0000-4000-8000-000000000002'
      and preference.food_id =
        '10000000-0000-4000-8000-000000000002'
  ),
  'owner-scoped removal cannot delete another account preference'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config(
  'request.jwt.claim.sub',
  'a3000000-0000-4000-8000-000000000003',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);

select throws_ok(
  $$select public.append_meal_preference('breakfast', 'f1000000-0000-4000-8000-000000000051')$$,
  '23514',
  'MEAL_PREFERENCE_LIMIT_REACHED',
  'a meal cannot exceed fifty selected foods'
);

select is(
  (
    select count(*)::integer
    from public.meal_preferences preference
    where preference.user_id =
      'a3000000-0000-4000-8000-000000000003'
      and preference.meal_type = 'breakfast'
  ),
  50,
  'a rejected capacity append leaves all prior preferences unchanged'
);

select set_config(
  'request.jwt.claim.sub',
  'a4000000-0000-4000-8000-000000000004',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a4000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);

select throws_ok(
  $$select public.append_meal_preference('breakfast', '10000000-0000-4000-8000-000000000001')$$,
  '55000',
  'ONBOARDING_NOT_COMPLETED',
  'an in-progress onboarding account cannot race the initial preference replacement'
);

select lives_ok(
  $$
    select public.complete_onboarding_from_slugs(
      175::numeric,
      'kg',
      'UTC',
      'moderately_active',
      3::smallint,
      array[]::text[],
      array[]::text[],
      array[]::text[],
      null,
      'Meal preference ACL regression test',
      'fat_loss',
      82::numeric,
      75::numeric,
      (now() at time zone 'UTC')::date,
      (now() at time zone 'UTC')::date + 84,
      jsonb_build_array(
        jsonb_build_object(
          'mealType', 'breakfast',
          'foodSlug', 'white-rice',
          'sortOrder', 0
        ),
        jsonb_build_object(
          'mealType', 'lunch',
          'foodSlug', 'chicken-breast',
          'sortOrder', 0
        ),
        jsonb_build_object(
          'mealType', 'dinner',
          'foodSlug', 'tofu',
          'sortOrder', 0
        )
      ),
      jsonb_build_array(
        jsonb_build_object(
          'warningCode', 'missing_vegetable',
          'mealType', 'lunch',
          'contextVersion', 'onboarding-v1'
        )
      )
    )
  $$,
  'the definer onboarding path can still replace meal preferences after direct INSERT revocation'
);

select is(
  (
    select count(*)::integer
    from public.meal_preferences preference
    where preference.user_id =
      'a4000000-0000-4000-8000-000000000004'
  ),
  3,
  'onboarding still stores the three requested primary-meal preferences'
);

select * from finish();
rollback;
