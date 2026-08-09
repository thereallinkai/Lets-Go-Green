begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

select has_trigger(
  'public',
  'profiles',
  'require_height_before_onboarding_completion',
  'profile completion is guarded by the required-height trigger'
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
values (
  '00000000-0000-0000-0000-000000000000',
  '55555555-5555-4555-8555-555555555555',
  'authenticated',
  'authenticated',
  'height-required-user@example.test',
  '',
  null,
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object(
    'full_name', 'Height Required User',
    'gender', 'prefer_not_to_say',
    'date_of_birth', to_char(current_date - interval '30 years', 'YYYY-MM-DD'),
    'registration_time_zone', 'UTC',
    'terms_version', '1.1',
    'privacy_version', '1.2'
  ),
  now(),
  now()
);

update auth.users
set email_confirmed_at = now()
where id = '55555555-5555-4555-8555-555555555555';

update public.profiles
set onboarding_status = 'in_progress', height_cm = null
where user_id = '55555555-5555-4555-8555-555555555555';

select throws_ok(
  $$
    update public.profiles
    set onboarding_status = 'completed'
    where user_id = '55555555-5555-4555-8555-555555555555'
  $$,
  '23514',
  'Choose a height before completing onboarding.',
  'a new profile cannot complete onboarding without height'
);

-- Simulate a profile that was already complete when the migration was
-- installed. The compatibility exception must not trap that account forever.
alter table public.profiles
  disable trigger require_height_before_onboarding_completion;
update public.profiles
set
  onboarding_status = 'completed',
  onboarding_completed_at = now(),
  height_cm = null
where user_id = '55555555-5555-4555-8555-555555555555';
alter table public.profiles
  enable trigger require_height_before_onboarding_completion;

select lives_ok(
  $$
    update public.profiles
    set onboarding_status = 'completed', height_cm = null
    where user_id = '55555555-5555-4555-8555-555555555555'
  $$,
  'a legacy completed profile with no stored height remains editable'
);

update public.profiles
set
  onboarding_status = 'in_progress',
  onboarding_completed_at = null,
  height_cm = null
where user_id = '55555555-5555-4555-8555-555555555555';

select lives_ok(
  $$
    update public.profiles
    set
      height_cm = 175,
      onboarding_status = 'completed',
      onboarding_completed_at = now()
    where user_id = '55555555-5555-4555-8555-555555555555'
  $$,
  'a selected height permits onboarding completion'
);

select throws_ok(
  $$
    update public.profiles
    set height_cm = null
    where user_id = '55555555-5555-4555-8555-555555555555'
  $$,
  '23514',
  'Choose a height before completing onboarding.',
  'a completed profile cannot clear its selected height'
);

update public.profiles
set
  onboarding_status = 'in_progress',
  onboarding_completed_at = null,
  height_cm = null
where user_id = '55555555-5555-4555-8555-555555555555';

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
values (
  '00000000-0000-0000-0000-000000000000',
  '55555555-5555-4555-8555-555555555556',
  'authenticated',
  'authenticated',
  'height-insert-user@example.test',
  '',
  null,
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

-- Remove the registration hook's draft row so this assertion exercises a
-- genuine direct INSERT path rather than relying on constraint order.
delete from public.profiles
where user_id = '55555555-5555-4555-8555-555555555556';

select throws_ok(
  $$
    insert into public.profiles (
      user_id,
      full_name,
      gender,
      date_of_birth,
      time_zone,
      onboarding_status,
      onboarding_completed_at
    )
    values (
      '55555555-5555-4555-8555-555555555556',
      'Height Insert User',
      'prefer_not_to_say',
      current_date - interval '25 years',
      'UTC',
      'completed',
      now()
    )
  $$,
  '23514',
  'Choose a height before completing onboarding.',
  'a directly inserted completed profile also requires height'
);

select set_config(
  'request.jwt.claim.sub',
  '55555555-5555-4555-8555-555555555555',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.complete_onboarding_from_slugs(
      180::numeric,
      'kg'::public.weight_unit,
      'UTC',
      'moderately_active'::public.activity_level,
      3::smallint,
      '{}'::text[],
      '{}'::text[],
      '{}'::text[],
      null,
      null,
      'maintenance'::public.goal_type,
      95::numeric,
      95::numeric,
      current_date,
      current_date + 90,
      '[
        {"mealType":"breakfast","foodSlug":"white-rice","sortOrder":0},
        {"mealType":"lunch","foodSlug":"chicken-breast","sortOrder":0},
        {"mealType":"dinner","foodSlug":"tofu","sortOrder":0}
      ]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'the authenticated completion RPC persists a selected height'
);

select ok(
  (
    select profile.height_cm = 180
      and profile.onboarding_status = 'completed'
      and profile.onboarding_completed_at is not null
    from public.profiles profile
    where profile.user_id = '55555555-5555-4555-8555-555555555555'
  ),
  'the completion RPC leaves a height-backed completed profile'
);

reset role;

select * from finish();

rollback;
