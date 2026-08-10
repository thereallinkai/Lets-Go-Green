begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(38);

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
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'authenticated',
    'authenticated',
    'user-a@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'authenticated',
    'authenticated',
    'user-b@example.test',
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
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'User A',
    (current_date - interval '30 years')::date,
    175,
    'UTC',
    'completed',
    now()
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'User B',
    (current_date - interval '35 years')::date,
    165,
    'UTC',
    'completed',
    now()
  );

insert into public.goals (
  id,
  user_id,
  goal_type,
  target_weight_kg,
  plan_start_date,
  target_date,
  status
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'fat_loss',
    75,
    current_date,
    current_date + 84,
    'active'
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'maintenance',
    80,
    current_date,
    current_date + 84,
    'active'
  );

insert into public.weight_entries (
  user_id,
  local_date,
  weight_kg,
  source_display_unit,
  is_onboarding_baseline
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    current_date,
    82,
    'kg',
    true
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    current_date,
    80,
    'kg',
    true
  );

insert into public.foods (
  id,
  slug,
  english_name,
  source,
  ownership_type,
  owner_user_id,
  verification_status
)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    'user-a-label-food',
    'User A label food',
    'User-entered nutrition label',
    'private',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'user_label'
  ),
  (
    'b2000000-0000-4000-8000-000000000001',
    'user-b-label-food',
    'User B label food',
    'User-entered nutrition label',
    'private',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'user_label'
  );

insert into public.foods (
  id,
  slug,
  english_name,
  source,
  ownership_type,
  owner_user_id,
  verification_status,
  catalog_status
)
values
  (
    'd2000000-0000-4000-8000-000000000001',
    'rejected-catalog-test-food',
    'Rejected catalog test food',
    'RLS test fixture',
    'catalog',
    null,
    'verified',
    'rejected'
  ),
  (
    'd2000000-0000-4000-8000-000000000002',
    'retired-catalog-test-food',
    'Retired catalog test food',
    'RLS test fixture',
    'catalog',
    null,
    'verified',
    'retired'
  );

insert into public.food_label_submissions (
  id,
  user_id,
  status,
  brand_name,
  product_name,
  label_data
)
values (
  'b7000000-0000-4000-8000-000000000001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'draft',
  'User B Brand',
  'User B Product',
  '{
    "servingWeightGrams": 30,
    "calories": 120,
    "proteinGrams": 20,
    "carbohydrateGrams": 4,
    "fatGrams": 2,
    "confirmedAccurate": false
  }'::jsonb
);

insert into public.food_label_images (
  id,
  submission_id,
  user_id,
  object_path,
  image_kind,
  mime_type,
  byte_size,
  pixel_width,
  pixel_height,
  sha256
)
values (
  'b8000000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/test/nutrition.jpg',
  'nutrition',
  'image/jpeg',
  100,
  10,
  10,
  repeat('a', 64)
);

insert into public.food_allergens (food_id, allergen_id)
values (
  'b2000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);

insert into public.daily_checkins (
  user_id,
  local_date,
  breakfast_completed,
  notes
)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  current_date,
  true,
  'User B note'
);

insert into public.daily_meal_checkins (
  id,
  user_id,
  local_date,
  meal_type,
  status
)
values (
  'b5000000-0000-4000-8000-000000000001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  current_date,
  'breakfast',
  'completed'
);

insert into public.daily_meal_items (
  id,
  meal_checkin_id,
  user_id,
  food_id,
  sort_order
)
values (
  'b6000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '10000000-0000-4000-8000-000000000002',
  0
);

insert into public.plans (
  id,
  user_id,
  goal_id,
  version,
  provider,
  model,
  prompt_version,
  input_snapshot,
  validated_output_snapshot
)
values
  (
    'a3000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a1000000-0000-4000-8000-000000000001',
    1,
    'mock',
    'mock-v1',
    'lets-go-green-v2',
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'b3000000-0000-4000-8000-000000000001',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'b1000000-0000-4000-8000-000000000001',
    1,
    'mock',
    'mock-v1',
    'lets-go-green-v2',
    '{}'::jsonb,
    '{}'::jsonb
  );

select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'User A sees only one profile'
);
select is(
  (
    select count(*)
    from public.profiles
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  0::bigint,
  'User A cannot read User B profile'
);
select is(
  (select count(*) from public.weight_entries),
  1::bigint,
  'User A sees only their own weight entries'
);
select is(
  (
    select count(*)
    from public.weight_entries
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  0::bigint,
  'User A cannot read User B weight entries'
);
select is(
  (select count(*) from public.foods where ownership_type = 'catalog'),
  29::bigint,
  'an authenticated user can read the public catalog'
);
select is(
  (select count(*) from public.allergens),
  9::bigint,
  'an authenticated user can read allergen taxonomy'
);
select is(
  (select count(*) from public.dietary_restriction_types),
  5::bigint,
  'an authenticated user can read dietary restriction taxonomy'
);
select is(
  (
    select count(*)
    from public.foods
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'User A can read their own private food'
);
select is(
  (
    select count(*)
    from public.foods
    where id = 'b2000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'User A cannot read User B private food'
);
select is(
  (
    select count(*)
    from public.foods
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'authenticated catalog reads hide rejected foods'
);
select is(
  (
    select count(*)
    from public.foods
    where id = 'd2000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'authenticated catalog reads retain retired foods for history'
);
select is(
  (
    select count(*)
    from public.food_label_submissions
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  0::bigint,
  'User A cannot read User B label submissions'
);
select is(
  (
    select count(*)
    from public.food_label_images
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  0::bigint,
  'User A cannot read User B private label-image metadata'
);
select is(
  (
    select count(*)
    from public.food_allergens
    where food_id = 'b2000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'User A cannot read User B private-food allergen mappings'
);
select is(
  (
    select count(*)
    from public.plans
    where id = 'b3000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'User A cannot read User B plan'
);
select is(
  (
    select count(*)
    from public.daily_checkins
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  0::bigint,
  'User A cannot read User B check-in'
);
select is(
  (
    select count(*)
    from public.daily_meal_checkins
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  0::bigint,
  'User A cannot read User B meal-slot check-in'
);
select is(
  (
    select count(*)
    from public.daily_meal_items
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  0::bigint,
  'User A cannot read User B recorded foods'
);
select throws_ok(
  $$
    update public.daily_meal_checkins
    set status = 'skipped'
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  '42501',
  'permission denied for table daily_meal_checkins',
  'authenticated clients cannot bypass the meal-slot RPC'
);
select throws_ok(
  $$
    update public.daily_checkins
    set notes = 'tampered'
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  '42501',
  'permission denied for table daily_checkins',
  'authenticated clients cannot update legacy check-in rows directly'
);
select throws_ok(
  $$
    insert into public.daily_checkins (user_id, local_date)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      current_date - 1
    )
  $$,
  '42501',
  'permission denied for table daily_checkins',
  'authenticated clients cannot insert legacy check-in rows directly'
);
select throws_ok(
  $$
    delete from public.daily_checkins
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  '42501',
  'permission denied for table daily_checkins',
  'authenticated clients cannot delete legacy check-in rows directly'
);
select throws_ok(
  $$
    update public.plans
    set status = 'archived'
    where id = 'b3000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table plans',
  'User A cannot alter User B plan'
);
select throws_ok(
  $$
    update public.foods
    set english_name = 'tampered'
    where id = 'b2000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table foods',
  'authenticated clients cannot alter food trust records directly'
);
select throws_ok(
  $$ select count(*) from public.external_food_lookup_requests $$,
  '42501',
  'permission denied for table external_food_lookup_requests',
  'authenticated clients cannot inspect external lookup accounting'
);
select throws_ok(
  $$
    delete from public.food_label_submissions
    where id = 'b7000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table food_label_submissions',
  'authenticated clients cannot orphan label objects through direct deletion'
);
select throws_ok(
  $$ select public.accept_plan('b3000000-0000-4000-8000-000000000001') $$,
  '42501',
  'The requested plan is not available to this user.',
  'User A cannot accept or replace User B plan'
);
select lives_ok(
  $$
    select public.upsert_daily_checkin(
      (now() at time zone 'UTC')::date,
      true,
      false,
      true,
      'User A note'
    )
  $$,
  'User A can atomically save their desired check-in state'
);
select is(
  (
    select count(*)
    from public.daily_checkins
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  1::bigint,
  'the check-in RPC creates exactly one user-date row'
);
select ok(
  (
    select breakfast_completed and not lunch_completed and dinner_completed
    from public.daily_checkins
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'the check-in RPC stores desired final booleans without toggling'
);

reset role;
select is(
  (
    select notes
    from public.daily_checkins
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  'User B note',
  'User B check-in remained unchanged'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role anon;

select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501',
  'permission denied for table profiles',
  'an unauthenticated request is denied read access to profiles'
);
select throws_ok(
  $$ select count(*) from public.foods $$,
  '42501',
  'permission denied for table foods',
  'an unauthenticated request is denied read access to catalog and private foods'
);
select throws_ok(
  $$ select count(*) from public.allergens $$,
  '42501',
  'permission denied for table allergens',
  'an unauthenticated request is denied read access to allergen taxonomy'
);
select throws_ok(
  $$ select count(*) from public.dietary_restriction_types $$,
  '42501',
  'permission denied for table dietary_restriction_types',
  'an unauthenticated request is denied read access to restriction taxonomy'
);
select throws_ok(
  $$ select count(*) from public.weight_entries $$,
  '42501',
  'permission denied for table weight_entries',
  'an unauthenticated request is denied read access to weights'
);
select throws_ok(
  $$ select count(*) from public.plans $$,
  '42501',
  'permission denied for table plans',
  'an unauthenticated request is denied read access to plans'
);
select throws_ok(
  $$ select count(*) from public.daily_meal_checkins $$,
  '42501',
  'permission denied for table daily_meal_checkins',
  'an unauthenticated request is denied meal-slot access'
);

select * from finish();
rollback;
