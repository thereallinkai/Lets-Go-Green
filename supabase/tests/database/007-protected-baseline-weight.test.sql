begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

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
    'a7000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'weight-a@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b7000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'weight-b@example.test',
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
  date_of_birth,
  height_cm,
  time_zone,
  onboarding_status,
  onboarding_completed_at
)
values
  (
    'a7000000-0000-4000-8000-000000000001',
    'Weight User A',
    (current_date - interval '30 years')::date,
    175,
    'UTC',
    'completed',
    now()
  ),
  (
    'b7000000-0000-4000-8000-000000000001',
    'Weight User B',
    (current_date - interval '32 years')::date,
    168,
    'UTC',
    'completed',
    now()
  );

insert into public.weight_entries (
  id,
  user_id,
  local_date,
  weight_kg,
  source_display_unit,
  is_onboarding_baseline
)
values
  (
    'a7100000-0000-4000-8000-000000000001',
    'a7000000-0000-4000-8000-000000000001',
    current_date - 3,
    82,
    'kg',
    true
  ),
  (
    'a7100000-0000-4000-8000-000000000002',
    'a7000000-0000-4000-8000-000000000001',
    current_date - 1,
    80,
    'kg',
    false
  ),
  (
    'b7100000-0000-4000-8000-000000000001',
    'b7000000-0000-4000-8000-000000000001',
    current_date - 1,
    76,
    'kg',
    false
  );

select set_config(
  'request.jwt.claim.sub',
  'a7000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a7000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    insert into public.weight_entries (
      user_id,
      local_date,
      weight_kg,
      source_display_unit,
      is_onboarding_baseline
    )
    values (
      'a7000000-0000-4000-8000-000000000001',
      current_date,
      79,
      'kg',
      true
    )
  $$,
  '42501',
  'permission denied for table weight_entries',
  'authenticated clients cannot manufacture a baseline with direct insert'
);

select throws_ok(
  $$
    update public.weight_entries
    set weight_kg = 70
    where id = 'a7100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table weight_entries',
  'authenticated clients cannot directly edit baseline weight'
);

select throws_ok(
  $$
    update public.weight_entries
    set is_onboarding_baseline = true
    where id = 'a7100000-0000-4000-8000-000000000002'
  $$,
  '42501',
  'permission denied for table weight_entries',
  'authenticated clients cannot toggle the protected baseline flag'
);

select throws_ok(
  $$
    delete from public.weight_entries
    where id = 'a7100000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table weight_entries',
  'authenticated clients cannot directly delete baseline weight'
);

select throws_ok(
  $$
    select public.save_weight_entry(current_date - 3, 81, 'kg')
  $$,
  '23514',
  'The onboarding baseline weight is protected.',
  'daily weight upsert cannot overwrite the baseline date'
);

select throws_ok(
  $$
    select public.update_weight_entry(
      'a7100000-0000-4000-8000-000000000001',
      81,
      'kg'
    )
  $$,
  '23514',
  'The onboarding baseline weight is protected.',
  'guarded update rejects the onboarding baseline'
);

select throws_ok(
  $$
    select public.delete_weight_entry(
      'a7100000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'The onboarding baseline weight is protected.',
  'guarded deletion rejects the onboarding baseline'
);

select lives_ok(
  $$ select public.save_weight_entry(current_date, 79, 'kg') $$,
  'an authenticated owner can add an ordinary daily weight'
);

select is(
  (
    select weight_kg
    from public.weight_entries
    where user_id = 'a7000000-0000-4000-8000-000000000001'
      and local_date = current_date
  ),
  79::numeric,
  'the guarded daily save stores the requested owned weight'
);

select is(
  (
    public.update_weight_entry(
      'a7100000-0000-4000-8000-000000000002',
      78.5,
      'kg'
    )
  ).weight_kg,
  78.5::numeric,
  'the guarded update still edits an ordinary owned weight'
);

select is(
  public.delete_weight_entry(
    'a7100000-0000-4000-8000-000000000002'
  ),
  'a7100000-0000-4000-8000-000000000002'::uuid,
  'the guarded deletion still removes an ordinary owned weight'
);

select is(
  (
    public.update_weight_entry(
      'b7100000-0000-4000-8000-000000000001',
      70,
      'kg'
    )
  ).id,
  null::uuid,
  'guarded update does not reveal or alter another user weight'
);

select is(
  public.delete_weight_entry(
    'b7100000-0000-4000-8000-000000000001'
  ),
  null::uuid,
  'guarded deletion does not reveal or alter another user weight'
);

select ok(
  (
    select is_onboarding_baseline and weight_kg = 82
    from public.weight_entries
    where id = 'a7100000-0000-4000-8000-000000000001'
  ),
  'the onboarding baseline remains unchanged after every rejected path'
);

select * from finish();
rollback;
