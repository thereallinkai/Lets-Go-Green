begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(69);

create or replace function pg_temp.valid_plan_output(
  item_food_id uuid default '10000000-0000-4000-8000-000000000002',
  item_basis text default 'cooked'
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'schemaVersion', '1.0',
    'planApproach', 'standard',
    'goalAssessment', 'A general wellness plan for testing.',
    'days', jsonb_agg(
      jsonb_build_object(
        'dayIndex', day_number,
        'title', 'Day ' || day_number,
        'meals', (
          select jsonb_agg(
            jsonb_build_object(
              'mealType', meal_name,
              'items', jsonb_build_array(
                jsonb_build_object(
                  'foodId', item_food_id,
                  'quantity', 100,
                  'unit', 'g',
                  'measurementBasis', item_basis
                )
              )
            )
            order by meal_order
          )
          from (
            values
              ('breakfast', 1),
              ('lunch', 2),
              ('dinner', 3)
          ) as meal_types(meal_name, meal_order)
        )
      )
      order by day_number
    ),
    'assumptions', jsonb_build_array(),
    'majorReasons', jsonb_build_array('Uses known catalog foods.'),
    'hydrationGuidance', 'Drink according to thirst and individual needs.',
    'weeklyReviewRules', jsonb_build_array('Review complete trend periods.'),
    'safetyNotes', jsonb_build_array()
  )
  from generate_series(1, 7) as days(day_number);
$$;

create or replace function pg_temp.complete_test_onboarding(
  preference_payload jsonb
)
returns uuid
language sql
volatile
set search_path = ''
as $$
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
    'Test onboarding',
    'fat_loss',
    82::numeric,
    75::numeric,
    (now() at time zone 'UTC')::date,
    (now() at time zone 'UTC')::date + 84,
    preference_payload,
    jsonb_build_array(
      jsonb_build_object(
        'warningCode', 'missing_vegetable',
        'mealType', 'lunch',
        'contextVersion', 'onboarding-v1'
      )
    )
  );
$$;

create or replace function pg_temp.replay_test_onboarding(
  height_value numeric default 175,
  current_weight_value numeric default 82,
  goal_type_value public.goal_type default 'fat_loss',
  start_date_value date default (now() at time zone 'UTC')::date,
  preference_payload jsonb default null
)
returns uuid
language sql
volatile
set search_path = ''
as $$
  select public.complete_onboarding_from_slugs(
    height_value,
    'kg',
    'UTC',
    'moderately_active',
    3::smallint,
    array[]::text[],
    array[]::text[],
    array[]::text[],
    null,
    'Test onboarding',
    goal_type_value,
    current_weight_value,
    75::numeric,
    start_date_value,
    (now() at time zone 'UTC')::date + 84,
    coalesce(
      preference_payload,
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
      )
    ),
    jsonb_build_array(
      jsonb_build_object(
        'warningCode', 'missing_vegetable',
        'mealType', 'lunch',
        'contextVersion', 'onboarding-v1'
      )
    )
  );
$$;

create temporary table rpc_results (
  goal_id uuid not null,
  plan_id uuid
) on commit drop;
grant all on table rpc_results to authenticated;
grant all on table rpc_results to service_role;

create temporary table onboarding_replay_snapshot (
  profile_updated_at timestamptz not null,
  goal_updated_at timestamptz not null,
  baseline_updated_at timestamptz not null
) on commit drop;
grant all on table onboarding_replay_snapshot to authenticated;

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
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'authenticated',
    'authenticated',
    'rpc-user@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'authenticated',
    'authenticated',
    'reservation-user@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'authenticated',
    'authenticated',
    'stale-reservation-user@example.test',
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
  time_zone,
  onboarding_status
)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'RPC User',
  'prefer_not_to_say',
  30,
  (current_date - interval '30 years')::date,
  'UTC',
  'in_progress'
);

insert into public.legal_acceptances (
  user_id,
  document_type,
  document_version
)
values
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'terms',
    'test-v1'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'privacy',
    'test-v1'
  );

select set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select pg_temp.complete_test_onboarding(
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
      )
    )
  $$,
  'slug-resolving onboarding persists all validated sections atomically'
);

insert into onboarding_replay_snapshot (
  profile_updated_at,
  goal_updated_at,
  baseline_updated_at
)
select
  profile.updated_at,
  goal.updated_at,
  baseline.updated_at
from public.profiles profile
join public.goals goal
  on goal.user_id = profile.user_id
  and goal.status = 'active'
join public.weight_entries baseline
  on baseline.user_id = profile.user_id
  and baseline.is_onboarding_baseline
where profile.user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select lives_ok(
  $$
    select pg_temp.complete_test_onboarding(
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
      )
    )
  $$,
  'replaying the same onboarding completion is idempotent'
);
select is(
  (
    select jsonb_build_array(
      profile.updated_at,
      goal.updated_at,
      baseline.updated_at
    )
    from public.profiles profile
    join public.goals goal
      on goal.user_id = profile.user_id
      and goal.status = 'active'
    join public.weight_entries baseline
      on baseline.user_id = profile.user_id
      and baseline.is_onboarding_baseline
    where profile.user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  (
    select jsonb_build_array(
      profile_updated_at,
      goal_updated_at,
      baseline_updated_at
    )
    from onboarding_replay_snapshot
  ),
  'an exact completion replay does not rewrite profile, goal, or baseline timestamps'
);
select throws_ok(
  $$ select pg_temp.replay_test_onboarding(current_weight_value => 83) $$,
  '23514',
  'Onboarding is already completed and cannot be changed through setup.',
  'a completed onboarding replay cannot replace the starting weight'
);
select throws_ok(
  $$ select pg_temp.replay_test_onboarding(height_value => 176) $$,
  '23514',
  'Onboarding is already completed and cannot be changed through setup.',
  'a completed onboarding replay cannot replace profile fields'
);
select throws_ok(
  $$
    select pg_temp.replay_test_onboarding(
      goal_type_value => 'muscle_gain'
    )
  $$,
  '23514',
  'Onboarding is already completed and cannot be changed through setup.',
  'a completed onboarding replay cannot replace the active goal'
);
select throws_ok(
  $$
    select pg_temp.replay_test_onboarding(
      start_date_value => (now() at time zone 'UTC')::date - 1
    )
  $$,
  '23514',
  'Onboarding is already completed and cannot be changed through setup.',
  'a completed onboarding replay cannot move the baseline date'
);
select throws_ok(
  $$
    select pg_temp.replay_test_onboarding(
      preference_payload => jsonb_build_array(
        jsonb_build_object(
          'mealType', 'breakfast',
          'foodSlug', 'rolled-oats',
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
      )
    )
  $$,
  '23514',
  'Onboarding is already completed and cannot be changed through setup.',
  'a completed onboarding replay cannot replace meal preferences'
);
select is(
  (
    select weight_kg
    from public.weight_entries
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and is_onboarding_baseline
  ),
  82::numeric,
  'rejected completion changes preserve the original baseline value'
);
select is(
  (
    select onboarding_status::text
    from public.profiles
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  'completed',
  'onboarding completion is set after persistence succeeds'
);
select is(
  (
    select count(*)
    from public.weight_entries
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and is_onboarding_baseline
  ),
  1::bigint,
  'onboarding creates exactly one baseline weight'
);
select is(
  (
    select count(*)
    from public.goals
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and status = 'active'
  ),
  1::bigint,
  'onboarding creates exactly one active goal'
);
select is(
  (
    select count(*)
    from public.meal_preferences
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  3::bigint,
  'onboarding stores normalized meal preferences'
);
select is(
  (
    select count(*)
    from public.onboarding_warnings
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  1::bigint,
  'onboarding stores acknowledged composition warnings'
);
select throws_ok(
  $$
    select pg_temp.complete_test_onboarding(
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
        )
      )
    )
  $$,
  '23514',
  'Breakfast, lunch, and dinner must each contain at least one selected food.',
  'slug-resolving onboarding requires every primary meal'
);
select throws_ok(
  $$
    select pg_temp.complete_test_onboarding(
      jsonb_build_array(
        jsonb_build_object(
          'mealType', 'breakfast',
          'foodSlug', 'white-rice',
          'sortOrder', 0
        ),
        jsonb_build_object(
          'mealType', 'breakfast',
          'foodSlug', 'white-rice',
          'sortOrder', 1
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
      )
    )
  $$,
  '23505',
  'A food was selected more than once for the same meal.',
  'slug-resolving onboarding rejects duplicate meal foods'
);
select throws_ok(
  $$
    select pg_temp.complete_test_onboarding(
      jsonb_build_array(
        jsonb_build_object(
          'mealType', 'breakfast',
          'foodSlug', 'white-rice',
          'sortOrder', 50
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
      )
    )
  $$,
  '22023',
  'Onboarding meal preferences have an unsupported structure.',
  'slug-resolving onboarding bounds each meal sort order'
);
select throws_ok(
  $$
    select pg_temp.complete_test_onboarding(
      (
        select jsonb_agg(
          jsonb_build_object(
            'mealType', 'breakfast',
            'foodSlug', 'white-rice',
            'sortOrder', item_number % 50
          )
        )
        from generate_series(0, 150) item(item_number)
      )
    )
  $$,
  '22023',
  'Onboarding supports no more than 50 foods per primary meal.',
  'slug-resolving onboarding bounds the total preference payload'
);
select throws_ok(
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
      'Test onboarding',
      'fat_loss',
      82::numeric,
      75::numeric,
      (now() at time zone 'UTC')::date,
      (now() at time zone 'UTC')::date + 84,
      '[]'::jsonb,
      (
        select jsonb_agg(
          jsonb_build_object(
            'warningCode', 'missing_vegetable',
            'mealType', 'lunch',
            'contextVersion', 'meal-composition-v1'
          )
        )
        from generate_series(1, 31)
      )
    )
  $$,
  '22023',
  'Onboarding contains too many acknowledged warnings.',
  'slug-resolving onboarding bounds acknowledged warnings'
);
select throws_ok(
  $$
    select public.create_confirmed_label_food(
      '{
        "confirmedAccurate": true,
        "allergensReviewed": false,
        "restrictionsReviewed": true
      }'::jsonb,
      null
    )
  $$,
  '23514',
  'Confirm the nutrition, allergen, and dietary-restriction review before using this label.',
  'label confirmation requires explicit allergen and restriction review'
);
select throws_ok(
  $$
    select public.create_confirmed_label_food(
      '{
        "confirmedAccurate": "true",
        "allergensReviewed": "true",
        "restrictionsReviewed": "true"
      }'::jsonb,
      null
    )
  $$,
  '23514',
  'Confirm the nutrition, allergen, and dietary-restriction review before using this label.',
  'label confirmation requires JSON booleans rather than truthy strings'
);
select throws_ok(
  $$
    select public.create_confirmed_label_food(
      '{
        "confirmedAccurate": true,
        "allergensReviewed": true,
        "restrictionsReviewed": true,
        "allergenStatement": "Contains milk and soy.",
        "allergenSlugs": ["soy"]
      }'::jsonb,
      null
    )
  $$,
  '23514',
  'Every allergen named in the package statement must be selected before confirmation.',
  'direct label confirmation cannot omit milk named by the package statement'
);
select throws_ok(
  $$
    insert into public.meal_preferences (
      user_id,
      meal_type,
      food_id,
      sort_order
    )
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'morning_snack',
      '10000000-0000-4000-8000-000000000002',
      0
    )
  $$,
  '23514',
  'new row for relation "meal_preferences" violates check constraint "meal_preferences_primary_meal_type_check"',
  'onboarding preferences reject optional snack meal types'
);

select lives_ok(
  $$
    select public.set_daily_checkin_note(
      (now() at time zone 'UTC')::date,
      'Keep this day note'
    )
  $$,
  'a day note can be saved independently'
);
select lives_ok(
  $$
    select public.set_daily_meal_checkin(
      (now() at time zone 'UTC')::date,
      'lunch',
      'skipped',
      'Schedule changed'
    )
  $$,
  'a meal can be skipped with an optional reason'
);
select is(
  (
    select notes
    from public.daily_checkins
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and local_date = (now() at time zone 'UTC')::date
  ),
  'Keep this day note',
  'a per-slot status change preserves the day note'
);
select ok(
  (
    select status = 'skipped' and skip_reason = 'Schedule changed'
    from public.daily_meal_checkins
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and local_date = (now() at time zone 'UTC')::date
      and meal_type = 'lunch'
  ),
  'the explicit skipped state and reason are stored'
);
select lives_ok(
  $$
    select public.add_daily_meal_item(
      (now() at time zone 'UTC')::date,
      'morning_snack',
      '10000000-0000-4000-8000-000000000002'
    )
  $$,
  'an accessible catalog food can be recorded in a snack slot'
);
select is(
  (
    select count(*)
    from public.daily_meal_items
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  1::bigint,
  'recording a snack creates one private food-presence row'
);
select throws_ok(
  $$
    select public.set_daily_meal_checkin(
      (now() at time zone 'UTC')::date,
      'morning_snack',
      'skipped',
      'Changed my mind'
    )
  $$,
  '23514',
  'A meal slot with recorded food items cannot be skipped.',
  'a meal slot with recorded foods cannot transition to skipped'
);
select is(
  (
    select status::text
    from public.daily_meal_checkins
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and local_date = (now() at time zone 'UTC')::date
      and meal_type = 'morning_snack'
  ),
  'completed',
  'a rejected skip transition preserves the completed slot state'
);

reset role;
select throws_ok(
  $$
    insert into public.daily_meal_items (
      meal_checkin_id,
      user_id,
      food_id,
      sort_order
    )
    select
      id,
      user_id,
      '10000000-0000-4000-8000-000000000002',
      0
    from public.daily_meal_checkins
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and local_date = (now() at time zone 'UTC')::date
      and meal_type = 'lunch'
  $$,
  '23514',
  'A skipped meal slot cannot contain recorded food items.',
  'a trusted direct write cannot add an item to a skipped slot'
);
select is(
  (
    select count(*)
    from public.daily_meal_items
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  1::bigint,
  'the rejected skipped-slot insert leaves recorded foods unchanged'
);

select set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.delete_daily_meal_item(
      (
        select id
        from public.daily_meal_items
        where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        limit 1
      )
    )
  $$,
  'the owner can delete a recorded snack food'
);
select is(
  (
    select count(*)
    from public.daily_meal_items
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  0::bigint,
  'deleting the snack food removes its presence row'
);
select ok(
  (
    select status = 'not_marked' and skip_reason is null
    from public.daily_meal_checkins
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and local_date = (now() at time zone 'UTC')::date
      and meal_type = 'morning_snack'
  ),
  'deleting the final snack item atomically clears its completed slot state'
);

insert into rpc_results (goal_id)
select id
from public.goals
where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  and status = 'active';

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

insert into public.ai_generation_requests (
  id,
  user_id,
  idempotency_key,
  provider,
  model,
  prompt_version,
  status
)
values (
  'c4000000-0000-4000-8000-000000000001',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'rpc-request-one',
  'mock',
  'mock-v1',
  'lets-go-green-v2',
  'processing'
);

set local role service_role;

select lives_ok(
  $$
    update rpc_results
    set plan_id = public.save_plan_version(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select goal_id from rpc_results),
      'mock',
      'mock-v1',
      'lets-go-green-v2',
      '{}'::jsonb,
      pg_temp.valid_plan_output(),
      'c4000000-0000-4000-8000-000000000001'
    )
  $$,
  'save_plan_version atomically stores a normalized plan'
);

reset role;

select is(
  (
    select count(*)
    from public.plans
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  1::bigint,
  'one plan version is created'
);
select is(
  (
    select count(*)
    from public.plan_days
    where plan_id = (select plan_id from rpc_results)
  ),
  7::bigint,
  'the plan version contains seven normalized days'
);
select is(
  (
    select count(*)
    from public.plan_meals meals
    join public.plan_days days on days.id = meals.plan_day_id
    where days.plan_id = (select plan_id from rpc_results)
  ),
  21::bigint,
  'the plan version contains three meals per day'
);
select throws_ok(
  $$
    insert into public.plan_meals (
      plan_day_id,
      meal_type,
      sort_order
    )
    select
      id,
      'morning_snack',
      3
    from public.plan_days
    where plan_id = (select plan_id from rpc_results)
      and day_index = 1
  $$,
  '23514',
  'new row for relation "plan_meals" violates check constraint "plan_meals_primary_meal_type_check"',
  'normalized plan meals reject optional snack meal types'
);
select is(
  (
    select count(*)
    from public.plan_items items
    join public.plan_meals meals on meals.id = items.plan_meal_id
    join public.plan_days days on days.id = meals.plan_day_id
    where days.plan_id = (select plan_id from rpc_results)
  ),
  21::bigint,
  'the plan version contains normalized meal items'
);
select ok(
  (
    select status = 'succeeded' and plan_id = (select plan_id from rpc_results)
    from public.ai_generation_requests
    where id = 'c4000000-0000-4000-8000-000000000001'
  ),
  'saving a plan completes and links its generation request'
);

set local role service_role;

select is(
  public.save_plan_version(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    (select goal_id from rpc_results),
    'mock',
    'mock-v1',
    'lets-go-green-v2',
    '{}'::jsonb,
    pg_temp.valid_plan_output(),
    'c4000000-0000-4000-8000-000000000001'
  ),
  (select plan_id from rpc_results),
  'retrying a succeeded generation request returns the same plan'
);

reset role;

select is(
  (
    select count(*)
    from public.plans
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  1::bigint,
  'an idempotent retry does not create another plan version'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$ select public.accept_plan((select plan_id from rpc_results)) $$,
  'a complete generated plan can be accepted atomically'
);
select is(
  (
    select status::text
    from public.plans
    where id = (select plan_id from rpc_results)
  ),
  'accepted',
  'the accepted plan is the current plan'
);
select throws_ok(
  $$
    update public.plan_items
    set quantity = 50
    where plan_meal_id in (
      select meals.id
      from public.plan_meals meals
      join public.plan_days days on days.id = meals.plan_day_id
      where days.plan_id = (select plan_id from rpc_results)
    )
  $$,
  '42501',
  'permission denied for table plan_items',
  'accepted normalized plan items cannot be silently mutated'
);
select throws_ok(
  $$
    update public.plans
    set model = 'tampered-model'
    where id = (select plan_id from rpc_results)
  $$,
  '42501',
  'permission denied for table plans',
  'accepted plan audit content is immutable'
);

update public.profiles
set allergies = array['wheat']
where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

insert into public.ai_generation_requests (
  id,
  user_id,
  idempotency_key,
  provider,
  model,
  prompt_version,
  status
)
values (
  'c4000000-0000-4000-8000-000000000003',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'rpc-request-allergen',
  'mock',
  'mock-v1',
  'lets-go-green-v2',
  'processing'
);

set local role service_role;

select throws_ok(
  $$
    select public.save_plan_version(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select goal_id from rpc_results),
      'mock',
      'mock-v1',
      'lets-go-green-v2',
      '{}'::jsonb,
      pg_temp.valid_plan_output(
        '10000000-0000-4000-8000-000000000006',
        'as_sold'
      ),
      'c4000000-0000-4000-8000-000000000003'
    )
  $$,
  '23514',
  'A plan item conflicts with an allergy or dietary restriction.',
  'plan persistence rechecks allergen mappings against the profile'
);

reset role;

select is(
  (
    select count(*)
    from public.plans
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  1::bigint,
  'an allergen conflict leaves no partial plan version'
);
select is(
  (
    select status::text
    from public.ai_generation_requests
    where id = 'c4000000-0000-4000-8000-000000000003'
  ),
  'processing',
  'an allergen rejection does not falsely complete the generation request'
);

insert into public.ai_generation_requests (
  id,
  user_id,
  idempotency_key,
  provider,
  model,
  prompt_version,
  status
)
values (
  'c4000000-0000-4000-8000-000000000002',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'rpc-request-two',
  'mock',
  'mock-v1',
  'lets-go-green-v2',
  'processing'
);

set local role service_role;

select throws_ok(
  $$
    select public.save_plan_version(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select goal_id from rpc_results),
      'mock',
      'mock-v1',
      'lets-go-green-v2',
      '{}'::jsonb,
      pg_temp.valid_plan_output() #- '{days,0,meals}'::text[],
      'c4000000-0000-4000-8000-000000000002'
    )
  $$,
  '22023',
  'Every plan day must contain breakfast, lunch, and dinner.',
  'a plan day without a meals array is rejected'
);

select throws_ok(
  $$
    select public.save_plan_version(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select goal_id from rpc_results),
      'mock',
      'mock-v1',
      'lets-go-green-v2',
      '{}'::jsonb,
      pg_temp.valid_plan_output() #- '{days,0,meals,0,items}'::text[],
      'c4000000-0000-4000-8000-000000000002'
    )
  $$,
  '22023',
  'Every primary meal must contain at least one item.',
  'a plan meal without an items array is rejected'
);

select throws_ok(
  $$
    select public.save_plan_version(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select goal_id from rpc_results),
      'mock',
      'mock-v1',
      'lets-go-green-v2',
      '{}'::jsonb,
      '{}'::jsonb,
      'c4000000-0000-4000-8000-000000000002'
    )
  $$,
  '22023',
  'The validated plan payload must contain exactly seven days.',
  'a plan payload without schemaVersion and days is rejected'
);

reset role;

select is(
  (
    select count(*)
    from public.plans
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  1::bigint,
  'a rejected plan never leaves a partial version'
);

select throws_ok(
  $$
    update public.food_nutrition
    set source_id = (
      select source_id
      from public.food_nutrition
      where id = '20000000-0000-4000-8000-000000000017'
    )
    where id = '20000000-0000-4000-8000-000000000016'
  $$,
  '23514',
  'Food provenance source must belong to the same food.',
  'nutrition cannot reference another food source'
);
select throws_ok(
  $$
    update public.food_safety_metadata
    set source_id = (
      select source_id
      from public.food_nutrition
      where id = '20000000-0000-4000-8000-000000000017'
    )
    where food_id = '10000000-0000-4000-8000-000000000016'
  $$,
  '23514',
  'Food provenance source must belong to the same food.',
  'safety metadata cannot reference another food source'
);

insert into public.food_nutrition (
  id,
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
  source_version,
  source_id
)
values (
  'c5000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'raw',
  100,
  'g',
  130,
  2.69,
  28.17,
  0.28,
  'Unreviewed alternate basis',
  'Regression fixture for an untrusted alternate measurement basis.',
  'source_reported',
  'test-v1',
  (
    select id
    from public.food_sources
    where food_id = '10000000-0000-4000-8000-000000000002'
    order by created_at
    limit 1
  )
);

insert into public.ai_generation_requests (
  id,
  user_id,
  idempotency_key,
  provider,
  model,
  prompt_version,
  status
)
values (
  'c4000000-0000-4000-8000-000000000004',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'rpc-request-untrusted-basis',
  'mock',
  'mock-v1',
  'lets-go-green-v2',
  'processing'
);

set local role service_role;

select throws_ok(
  $$
    select public.save_plan_version(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select goal_id from rpc_results),
      'mock',
      'mock-v1',
      'lets-go-green-v2',
      '{}'::jsonb,
      pg_temp.valid_plan_output(
        '10000000-0000-4000-8000-000000000002',
        'raw'
      ),
      'c4000000-0000-4000-8000-000000000004'
    )
  $$,
  '23514',
  'A plan item is not eligible for deterministic planning in the selected measurement basis.',
  'a trusted food cannot smuggle an untrusted alternate measurement basis into a plan'
);
select is(
  (
    select status::text
    from public.ai_generation_requests
    where id = 'c4000000-0000-4000-8000-000000000004'
  ),
  'processing',
  'basis rejection leaves the generation request incomplete and retryable'
);

reset role;

insert into public.ai_generation_requests (
  id,
  user_id,
  idempotency_key,
  provider,
  model,
  prompt_version,
  status,
  created_at,
  updated_at
)
values (
  'c4000000-0000-4000-8000-000000000005',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'stale-reservation',
  'mock',
  'mock-v1',
  'lets-go-green-v2',
  'processing',
  now() - interval '6 minutes',
  now() - interval '6 minutes'
);

set local role service_role;

select ok(
  (
    select
      result_state = 'replayed'
      and request_status = 'failed'
    from public.reserve_plan_generation(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'stale-reservation',
      'mock',
      'mock-v1',
      'lets-go-green-v2'
    )
  ),
  'a stale processing reservation is replayed as failed'
);
select ok(
  (
    select
      status = 'failed'
      and completed_at is not null
      and sanitized_error_code = 'stale_reservation_timeout'
    from public.ai_generation_requests
    where id = 'c4000000-0000-4000-8000-000000000005'
  ),
  'stale reservation closure stores only a sanitized timeout code'
);

select is(
  (
    select result_state
    from public.reserve_plan_generation(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'reservation-one',
      'mock',
      'mock-v1',
      'lets-go-green-v2'
    )
  ),
  'reserved',
  'the first plan-generation request is reserved atomically'
);
select is(
  (
    select result_state
    from public.reserve_plan_generation(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'reservation-one',
      'mock',
      'mock-v1',
      'lets-go-green-v2'
    )
  ),
  'replayed',
  'an idempotent reservation returns the existing request'
);
select is(
  (
    select result_state
    from public.reserve_plan_generation(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'reservation-two',
      'mock',
      'mock-v1',
      'lets-go-green-v2'
    )
  ),
  'reserved',
  'a second request inside the rate window is reserved'
);
select is(
  (
    select result_state
    from public.reserve_plan_generation(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'reservation-three',
      'mock',
      'mock-v1',
      'lets-go-green-v2'
    )
  ),
  'reserved',
  'a third request inside the rate window is reserved'
);
select is(
  (
    select result_state
    from public.reserve_plan_generation(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'reservation-four',
      'mock',
      'mock-v1',
      'lets-go-green-v2'
    )
  ),
  'rate_limited',
  'the fourth new request inside the rate window is rejected atomically'
);

reset role;

insert into public.food_label_submissions (
  id,
  user_id,
  status,
  brand_name,
  product_name,
  label_data
)
values (
  'c7000000-0000-4000-8000-000000000001',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'draft',
  'Reservation Brand',
  'Reservation Product',
  '{
    "servingWeightGrams": 30,
    "calories": 120,
    "proteinGrams": 20,
    "carbohydrateGrams": 4,
    "fatGrams": 2,
    "confirmedAccurate": false,
    "allergensReviewed": true,
    "restrictionsReviewed": true
  }'::jsonb
);

set local role service_role;

select is(
  (
    select allowed
    from public.preflight_food_label_upload(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'c7000000-0000-4000-8000-000000000001',
      'nutrition'
    )
  ),
  true,
  'the trusted server can preflight an editable label-image upload'
);

reset role;

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
  'c9000000-0000-4000-8000-000000000001',
  'cross-source-gtin-fixture',
  'Cross-source GTIN fixture',
  'Normalized account-confirmed package label; review pending',
  'catalog',
  null,
  'source_reported',
  'branded_product',
  'pending_review'
);

insert into public.food_products (
  food_id,
  brand_name,
  product_name,
  gtin
)
values (
  'c9000000-0000-4000-8000-000000000001',
  'Fixture Brand',
  'Fixture Product',
  '12345678'
);

insert into public.food_sources (
  food_id,
  provider,
  external_id,
  attribution_text,
  payload_sha256
)
values (
  'c9000000-0000-4000-8000-000000000001',
  'user_label',
  'shared-label:12345678',
  'Normalized account-confirmed package label.',
  repeat('b', 64)
);

set local role service_role;

select throws_ok(
  $$
    select public.cache_external_food(
      'open_food_facts',
      '12345678',
      '{
        "slug": "fixture-product-open-food-facts-12345678",
        "english_name": "Fixture Brand — Fixture Product",
        "food_kind": "branded_product",
        "brand_name": "Fixture Brand",
        "product_name": "Fixture Product",
        "gtin": "12345678"
      }'::jsonb,
      '{
        "measurement_basis": "as_sold",
        "reference_quantity": 100,
        "reference_unit": "g",
        "calories": 100,
        "protein_g": 10,
        "carbohydrate_g": 10,
        "fat_g": 2
      }'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb
    )
  $$,
  '23505',
  'A catalog product with this GTIN already has another source; explicit review is required before merging.',
  'external caching fails closed instead of discarding a cross-source GTIN payload'
);

reset role;

select * from finish();
rollback;
