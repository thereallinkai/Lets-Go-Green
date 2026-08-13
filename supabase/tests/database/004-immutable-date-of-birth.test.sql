begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);

select has_column(
  'public',
  'profiles',
  'date_of_birth',
  'profiles stores the canonical date of birth'
);

select has_table(
  'private',
  'legacy_age_only_accounts',
  'legacy DOB compatibility is restricted to a private snapshot'
);

select has_function(
  'private',
  'profile_age_on_date',
  array['date', 'date'],
  'the database has deterministic date-only age calculation'
);

select has_function(
  'private',
  'is_valid_time_zone',
  array['text'],
  'the database validates registration time zones'
);

select is(
  private.profile_age_on_date('2000-08-02', '2026-08-02'),
  26::smallint,
  'database age calculation changes on the birthday'
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
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'authenticated',
    'authenticated',
    'dob-user@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name', 'DOB User',
      'gender', 'prefer_not_to_say',
      'date_of_birth', to_char(
        (current_timestamp at time zone 'Pacific/Kiritimati')::date
          - interval '30 years',
        'YYYY-MM-DD'
      ),
      'registration_time_zone', 'Pacific/Kiritimati',
      'terms_version', '1.1',
      'privacy_version', '1.2'
    ),
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'authenticated',
    'authenticated',
    'missing-dob-user@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"age":30,"registration_time_zone":"UTC"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'authenticated',
    'authenticated',
    'direct-profile-user@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99999999-9999-4999-8999-999999999999',
    'authenticated',
    'authenticated',
    'legacy-snapshot-user@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"age":99,"terms_version":"1.1","privacy_version":"1.1"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '88888888-8888-4888-8888-888888888888',
    'authenticated',
    'authenticated',
    'valid-direct-profile-user@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

update auth.users
set email_confirmed_at = now()
where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

select is(
  (
    select date_of_birth
    from public.profiles
    where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  (
    (current_timestamp at time zone 'Pacific/Kiritimati')::date
      - interval '30 years'
  )::date,
  'verification stores the DOB from registration metadata'
);

select is(
  (
    select age
    from public.profiles
    where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  30::smallint,
  'verification derives age on the registration time zone calendar date'
);

select is(
  (
    select time_zone
    from public.profiles
    where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  'Pacific/Kiritimati',
  'verification stores the validated registration time zone'
);

select ok(
  exists (
    select 1
    from public.legal_acceptances
    where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      and document_type = 'privacy'
      and document_version = '1.2'
  ),
  'verification records the DOB-aware privacy notice acceptance'
);

select set_config(
  'request.jwt.claim.sub',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    update public.profiles
    set date_of_birth = date_of_birth - 1
    where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  $$,
  '23514',
  'Date of birth cannot be changed after it is saved.',
  'an authenticated owner cannot change their stored DOB'
);

select lives_ok(
  $$
    update public.profiles
    set age = 99
    where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  $$,
  'an authenticated owner may update the profile without overriding derived age'
);

select is(
  (
    select age
    from public.profiles
    where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  30::smallint,
  'the profile trigger restores age from canonical DOB'
);

reset role;

select throws_ok(
  $$
    update auth.users
    set raw_user_meta_data = jsonb_set(
      raw_user_meta_data,
      '{date_of_birth}',
      to_jsonb(to_char(current_date - interval '31 years', 'YYYY-MM-DD'))
    )
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  $$,
  '23514',
  'Date of birth cannot be changed after account creation.',
  'the Auth registration DOB is write-once'
);

select throws_ok(
  $$
    update auth.users
    set raw_user_meta_data = jsonb_set(
      raw_user_meta_data,
      '{registration_time_zone}',
      '"UTC"'::jsonb
    )
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  $$,
  '23514',
  'Registration time zone cannot be changed after account creation.',
  'the Auth registration time zone is write-once'
);

select throws_ok(
  $$
    update auth.users
    set email_confirmed_at = now()
    where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  $$,
  '23514',
  'A valid date of birth and registration time zone are required.',
  'a new missing-DOB account cannot complete verification'
);

select is(
  (
    select count(*)
    from public.profiles
    where user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  ),
  0::bigint,
  'failed missing-DOB verification creates no profile'
);

select set_config(
  'request.jwt.claim.sub',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    insert into public.profiles (user_id, full_name)
    values (
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'Missing DOB profile'
    )
  $$,
  '42501',
  'permission denied for table profiles',
  'authenticated clients cannot create a profile without DOB through direct insert'
);

select throws_ok(
  $$
    insert into public.profiles (
      user_id,
      full_name,
      date_of_birth,
      time_zone
    ) values (
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'Underage profile',
      (current_date - interval '12 years')::date,
      'UTC'
    )
  $$,
  '42501',
  'permission denied for table profiles',
  'authenticated clients cannot choose an underage DOB through direct insert'
);

select throws_ok(
  $$
    insert into public.profiles (
      user_id,
      full_name,
      date_of_birth,
      time_zone
    ) values (
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'Invalid time zone profile',
      (current_date - interval '30 years')::date,
      'Mars/Olympus_Mons'
    )
  $$,
  '42501',
  'permission denied for table profiles',
  'authenticated clients cannot choose profile identity fields through direct insert'
);

reset role;

-- Simulates the immutable row captured for a pending pre-migration account.
insert into private.legacy_age_only_accounts (
  user_id,
  legacy_age,
  legacy_time_zone
)
values (
  '99999999-9999-4999-8999-999999999999',
  40,
  'UTC'
);

select throws_ok(
  $$
    update auth.users
    set email_confirmed_at = now()
    where id = '99999999-9999-4999-8999-999999999999'
  $$,
  'a snapshotted pending age-only account may still verify'
);

select is(
  (
    select age
    from public.profiles
    where user_id = '99999999-9999-4999-8999-999999999999'
  ),
  40::smallint,
  'legacy verification uses the immutable snapshot, not current metadata age'
);

select is(
  (
    select date_of_birth
    from public.profiles
    where user_id = '99999999-9999-4999-8999-999999999999'
  ),
  null::date,
  'the legacy compatibility profile remains explicitly DOB-null'
);

select is(
  (
    select time_zone
    from public.profiles
    where user_id = '99999999-9999-4999-8999-999999999999'
  ),
  'UTC',
  'legacy verification uses the snapshotted time zone'
);

select set_config(
  'request.jwt.claim.sub',
  '99999999-9999-4999-8999-999999999999',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    update public.profiles
    set age = 41
    where user_id = '99999999-9999-4999-8999-999999999999'
  $$,
  '23514',
  'Legacy profile age cannot be changed.',
  'a DOB-null legacy age cannot be changed'
);

select lives_ok(
  $$
    update public.profiles
    set date_of_birth = (current_date - interval '40 years')::date
    where user_id = '99999999-9999-4999-8999-999999999999'
  $$,
  'a legacy profile may set its DOB once'
);

select is(
  (
    select age
    from public.profiles
    where user_id = '99999999-9999-4999-8999-999999999999'
  ),
  40::smallint,
  'the one-time legacy DOB upgrade derives age'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  '88888888-8888-4888-8888-888888888888',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    insert into public.profiles (
      user_id,
      full_name,
      date_of_birth,
      time_zone
    ) values (
      '88888888-8888-4888-8888-888888888888',
      'Valid direct profile',
      (current_date - interval '30 years')::date,
      'UTC'
    )
  $$,
  '42501',
  'permission denied for table profiles',
  'even a valid-looking authenticated direct profile insert is denied'
);

select is(
  (
    select count(*)
    from public.profiles
    where user_id = '88888888-8888-4888-8888-888888888888'
  ),
  0::bigint,
  'the denied direct insert creates no profile'
);

reset role;

select * from finish();

rollback;
