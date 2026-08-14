begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

select has_trigger(
  'public',
  'food_label_submissions',
  'publish_confirmed_label_identity',
  'confirmed no-barcode labels have a privacy-safe sharing trigger'
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
    '66666666-6666-4666-8666-666666666661',
    'authenticated',
    'authenticated',
    'label-identity-one@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '66666666-6666-4666-8666-666666666662',
    'authenticated',
    'authenticated',
    'label-identity-two@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
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
values
  (
    '66000000-0000-4000-8000-000000000001',
    'private-label-identity-one',
    'Example Nutrition Plant Protein - Cocoa',
    'User-confirmed package label',
    'private',
    '66666666-6666-4666-8666-666666666661',
    'user_label',
    'branded_product',
    'active'
  ),
  (
    '66000000-0000-4000-8000-000000000002',
    'private-label-identity-two',
    'Example Nutrition Plant Protein - Cocoa',
    'User-confirmed package label',
    'private',
    '66666666-6666-4666-8666-666666666662',
    'user_label',
    'branded_product',
    'active'
  );

insert into public.food_products (
  food_id,
  brand_name,
  product_name,
  variant_name,
  package_description
)
values
  (
    '66000000-0000-4000-8000-000000000001',
    'Example Nutrition',
    'Plant Protein',
    'Cocoa',
    '20 servings'
  ),
  (
    '66000000-0000-4000-8000-000000000002',
    ' example  NUTRITION ',
    'PLANT PROTEIN',
    ' cocoa ',
    '20  servings'
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
values
  (
    '66000000-0000-4000-8000-000000000011',
    '66000000-0000-4000-8000-000000000001',
    'user_label',
    'private-label-identity-one',
    'account-confirmed-v1',
    'Package label transcribed and confirmed by the account owner.',
    repeat('1', 64)
  ),
  (
    '66000000-0000-4000-8000-000000000012',
    '66000000-0000-4000-8000-000000000002',
    'user_label',
    'private-label-identity-two',
    'account-confirmed-v1',
    'Package label transcribed and confirmed by the account owner.',
    repeat('2', 64)
  );

insert into public.food_safety_metadata (
  food_id,
  ingredients_text,
  allergen_statement,
  allergen_data_status,
  restriction_data_status,
  source_id
)
values
  (
    '66000000-0000-4000-8000-000000000001',
    'Pea protein, cocoa.',
    'May contain milk.',
    'user_confirmed',
    'user_confirmed',
    '66000000-0000-4000-8000-000000000011'
  ),
  (
    '66000000-0000-4000-8000-000000000002',
    'Pea protein, cocoa.',
    'May contain milk.',
    'user_confirmed',
    'user_confirmed',
    '66000000-0000-4000-8000-000000000012'
  );

insert into public.food_nutrition (
  id,
  food_id,
  measurement_basis,
  reference_quantity,
  reference_unit,
  calories,
  energy_kj,
  protein_g,
  carbohydrate_g,
  fat_g,
  fiber_g,
  sodium_mg,
  source_name,
  source_reference,
  verification_status,
  source_version,
  source_id
)
values
  (
    '66000000-0000-4000-8000-000000000021',
    '66000000-0000-4000-8000-000000000001',
    'as_sold',
    100,
    'g',
    400,
    1674,
    66.667,
    13.333,
    6.667,
    3.333,
    500,
    'User-confirmed package label',
    'Private account-confirmed evidence.',
    'user_label',
    'account-confirmed-v1',
    '66000000-0000-4000-8000-000000000011'
  ),
  (
    '66000000-0000-4000-8000-000000000022',
    '66000000-0000-4000-8000-000000000002',
    'as_sold',
    100,
    'g',
    400,
    1674,
    66.667,
    13.333,
    6.667,
    3.333,
    500,
    'User-confirmed package label',
    'Private account-confirmed evidence.',
    'user_label',
    'account-confirmed-v1',
    '66000000-0000-4000-8000-000000000012'
  );

insert into public.food_nutrient_amounts (
  nutrition_id,
  nutrient_code,
  display_name,
  amount,
  unit,
  daily_value_percent,
  display_order
)
values
  (
    '66000000-0000-4000-8000-000000000021',
    'vitamin-b12',
    'Vitamin B12',
    2.4,
    'mcg',
    100,
    1
  ),
  (
    '66000000-0000-4000-8000-000000000022',
    'vitamin-b12',
    'Vitamin B12',
    2.4,
    'mcg',
    100,
    1
  );

insert into public.food_label_submissions (
  id,
  user_id,
  status,
  brand_name,
  product_name,
  variant_name,
  package_description,
  label_data
)
values
  (
    '66000000-0000-4000-8000-000000000031',
    '66666666-6666-4666-8666-666666666661',
    'draft',
    'Example Nutrition',
    'Plant Protein',
    'Cocoa',
    '20 servings',
    '{
      "servingWeightGrams": 30,
      "calories": 120,
      "proteinGrams": 20,
      "carbohydrateGrams": 4,
      "fatGrams": 2,
      "confirmedAccurate": true,
      "shareNormalizedProduct": true
    }'::jsonb
  ),
  (
    '66000000-0000-4000-8000-000000000032',
    '66666666-6666-4666-8666-666666666662',
    'draft',
    ' example  NUTRITION ',
    'PLANT PROTEIN',
    ' cocoa ',
    '20  servings',
    '{
      "servingWeightGrams": 30.0,
      "calories": 120.00,
      "proteinGrams": 20.0,
      "carbohydrateGrams": 4.00,
      "fatGrams": 2.0,
      "confirmedAccurate": true,
      "shareNormalizedProduct": true
    }'::jsonb
  );

update public.food_label_submissions
set
  status = 'submitted',
  private_food_id = '66000000-0000-4000-8000-000000000001',
  submitted_at = now()
where id = '66000000-0000-4000-8000-000000000031';

select isnt(
  (
    select published_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000031'
  ),
  null::uuid,
  'the first confirmed label receives a shared catalog identity'
);

select is(
  (
    select catalog_status
    from public.foods
    where id = (
      select published_food_id
      from public.food_label_submissions
      where id = '66000000-0000-4000-8000-000000000031'
    )
  ),
  'pending_review'::public.food_catalog_status,
  'the shared copy remains pending review rather than silently verified'
);

select ok(
  exists (
    select 1
    from public.food_sources source
    where source.food_id = (
      select published_food_id
      from public.food_label_submissions
      where id = '66000000-0000-4000-8000-000000000031'
    )
      and source.external_id like 'shared-product:%'
      and source.attribution_text =
        'Normalized from an account-confirmed package label. The raw image and account identity remain private.'
      and source.external_id not like '%66666666%'
  ),
  'the shared source excludes account identity and raw-photo references'
);

select is(
  (
    select nutrition.energy_kj
    from public.food_nutrition nutrition
    where nutrition.food_id = (
      select published_food_id
      from public.food_label_submissions
      where id = '66000000-0000-4000-8000-000000000031'
    )
      and nutrition.measurement_basis = 'as_sold'
  ),
  1674.000::numeric,
  'the shared copy preserves the complete normalized nutrition panel'
);

select ok(
  exists (
    select 1
    from public.food_nutrient_amounts amount
    join public.food_nutrition nutrition on nutrition.id = amount.nutrition_id
    where nutrition.food_id = (
      select published_food_id
      from public.food_label_submissions
      where id = '66000000-0000-4000-8000-000000000031'
    )
      and amount.nutrient_code = 'vitamin-b12'
      and amount.amount = 2.4
  ),
  'the shared copy preserves dynamically sourced nutrients'
);

update public.food_label_submissions
set
  status = 'submitted',
  private_food_id = '66000000-0000-4000-8000-000000000002',
  submitted_at = now()
where id = '66000000-0000-4000-8000-000000000032';

select is(
  (
    select published_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000032'
  ),
  (
    select published_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000031'
  ),
  'case, whitespace, and numeric formatting differences reuse one exact product identity'
);

select is(
  (
    select count(*)::integer
    from public.food_sources
    where provider = 'user_label'
      and external_id like 'shared-product:%'
  ),
  1,
  'reusing a confirmed identity does not duplicate the shared catalog record'
);

select is(
  (
    select count(*)::integer
    from public.foods
    where ownership_type = 'private'
      and id in (
        '66000000-0000-4000-8000-000000000001',
        '66000000-0000-4000-8000-000000000002'
      )
  ),
  2,
  'each account keeps its own private evidence-backed food record'
);

insert into public.food_label_submissions (
  id,
  user_id,
  status,
  brand_name,
  product_name,
  variant_name,
  package_description,
  label_data
)
values (
  '66000000-0000-4000-8000-000000000033',
  '66666666-6666-4666-8666-666666666662',
  'draft',
  'Example Nutrition',
  'Plant Protein',
  'Cocoa',
  '20 servings',
  '{
    "servingWeightGrams": 30,
    "calories": 120,
    "proteinGrams": 20,
    "carbohydrateGrams": 4,
    "fatGrams": 2,
    "confirmedAccurate": true,
    "shareNormalizedProduct": false
  }'::jsonb
);

update public.food_label_submissions
set
  status = 'submitted',
  private_food_id = '66000000-0000-4000-8000-000000000002',
  submitted_at = now()
where id = '66000000-0000-4000-8000-000000000033';

select is(
  (
    select published_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000033'
  ),
  null::uuid,
  'a no-barcode label is not shared without explicit account opt-in'
);

select is(
  (
    select private_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000033'
  ),
  '66000000-0000-4000-8000-000000000002'::uuid,
  'declining catalog sharing preserves the owner private food'
);

-- The submission columns are deliberately left looking like the first
-- product while the locked private food-product row is changed. Identity,
-- display name, slug, and copied product facts must all use the locked row.
update public.food_products
set
  brand_name = 'Stored Truth Brand',
  product_name = 'Different Formula',
  variant_name = 'Vanilla',
  package_description = '12 servings'
where food_id = '66000000-0000-4000-8000-000000000002';

insert into public.food_label_submissions (
  id,
  user_id,
  status,
  brand_name,
  product_name,
  variant_name,
  package_description,
  label_data
)
values (
  '66000000-0000-4000-8000-000000000035',
  '66666666-6666-4666-8666-666666666662',
  'draft',
  'Example Nutrition',
  'Plant Protein',
  'Cocoa',
  '20 servings',
  '{
    "servingWeightGrams": 30,
    "calories": 120,
    "proteinGrams": 20,
    "carbohydrateGrams": 4,
    "fatGrams": 2,
    "confirmedAccurate": true,
    "shareNormalizedProduct": true
  }'::jsonb
);

update public.food_label_submissions
set
  status = 'submitted',
  private_food_id = '66000000-0000-4000-8000-000000000002',
  submitted_at = now()
where id = '66000000-0000-4000-8000-000000000035';

select isnt(
  (
    select published_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000035'
  ),
  (
    select published_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000031'
  ),
  'crafted submission columns cannot collide with a different locked product'
);

select ok(
  exists (
    select 1
    from public.food_label_submissions submission
    join public.foods food on food.id = submission.published_food_id
    join public.food_products product
      on product.food_id = submission.published_food_id
    where submission.id = '66000000-0000-4000-8000-000000000035'
      and product.brand_name = 'Stored Truth Brand'
      and product.product_name = 'Different Formula'
      and product.variant_name = 'Vanilla'
      and product.package_description = '12 servings'
      and food.english_name =
        'Stored Truth Brand Different Formula — Vanilla'
      and food.slug like 'stored-truth-brand-differen-shared-%'
  ),
  'shared display, slug, and product facts come from the same locked row'
);

update public.food_nutrient_amounts
set amount = 3.0
where nutrition_id = '66000000-0000-4000-8000-000000000022'
  and nutrient_code = 'vitamin-b12';

insert into public.food_label_submissions (
  id,
  user_id,
  status,
  brand_name,
  product_name,
  variant_name,
  package_description,
  label_data
)
values (
  '66000000-0000-4000-8000-000000000034',
  '66666666-6666-4666-8666-666666666662',
  'draft',
  'Example Nutrition',
  'Plant Protein',
  'Cocoa',
  '20 servings',
  '{
    "servingWeightGrams": 30,
    "calories": 120,
    "proteinGrams": 20,
    "carbohydrateGrams": 4,
    "fatGrams": 2,
    "confirmedAccurate": true,
    "shareNormalizedProduct": true
  }'::jsonb
);

update public.food_label_submissions
set
  status = 'submitted',
  private_food_id = '66000000-0000-4000-8000-000000000002',
  submitted_at = now()
where id = '66000000-0000-4000-8000-000000000034';

select isnt(
  (
    select published_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000034'
  ),
  (
    select published_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000035'
  ),
  'a different dynamic nutrient panel receives a different catalog identity'
);

select is(
  (
    select count(*)::integer
    from public.food_sources
    where provider = 'user_label'
      and external_id like 'shared-product:%'
  ),
  3,
  'complete label fingerprints create only the three distinct shared records'
);

insert into public.food_categories (id, slug, english_label)
values (
  '00000000-0000-4000-8000-000000000002',
  'protein',
  'Protein'
)
on conflict (id) do nothing;

insert into public.food_label_submissions (
  id,
  user_id,
  status,
  brand_name,
  product_name,
  variant_name,
  gtin,
  package_description,
  label_data
)
values
  (
    '66000000-0000-4000-8000-000000000041',
    '66666666-6666-4666-8666-666666666662',
    'draft',
    'Legacy Barcode Brand',
    'Private Protein',
    'No sharing',
    '123456789012',
    '10 servings',
    '{
      "brandName": "Legacy Barcode Brand",
      "productName": "Private Protein",
      "variantName": "No sharing",
      "gtin": "123456789012",
      "packageDescription": "10 servings",
      "servingWeightGrams": 30,
      "servingDescription": "1 scoop",
      "calories": 120,
      "proteinGrams": 20,
      "carbohydrateGrams": 4,
      "fatGrams": 2,
      "ingredientsText": "Pea protein, cocoa.",
      "allergenStatement": "No declared allergens.",
      "categorySlugs": ["protein"],
      "allergenSlugs": [],
      "restrictionSlugs": [],
      "sourceNote": "",
      "allergensReviewed": true,
      "restrictionsReviewed": true,
      "confirmedAccurate": false,
      "shareNormalizedProduct": false
    }'::jsonb
  ),
  (
    '66000000-0000-4000-8000-000000000042',
    '66666666-6666-4666-8666-666666666662',
    'draft',
    'Legacy Barcode Brand',
    'Shared Protein',
    'Explicit sharing',
    '234567890123',
    '10 servings',
    '{
      "brandName": "Legacy Barcode Brand",
      "productName": "Shared Protein",
      "variantName": "Explicit sharing",
      "gtin": "234567890123",
      "packageDescription": "10 servings",
      "servingWeightGrams": 30,
      "servingDescription": "1 scoop",
      "calories": 120,
      "proteinGrams": 20,
      "carbohydrateGrams": 4,
      "fatGrams": 2,
      "ingredientsText": "Pea protein, cocoa.",
      "allergenStatement": "No declared allergens.",
      "categorySlugs": ["protein"],
      "allergenSlugs": [],
      "restrictionSlugs": [],
      "sourceNote": "",
      "allergensReviewed": true,
      "restrictionsReviewed": true,
      "confirmedAccurate": false,
      "shareNormalizedProduct": true
    }'::jsonb
  ),
  (
    '66000000-0000-4000-8000-000000000043',
    '66666666-6666-4666-8666-666666666662',
    'draft',
    'Upgrade Brand',
    'Legacy Private Food',
    'Original draft',
    null,
    '8 servings',
    '{
      "brandName": "Upgrade Brand",
      "productName": "Legacy Private Food",
      "variantName": "Original draft",
      "gtin": "",
      "packageDescription": "8 servings",
      "servingWeightGrams": 25,
      "servingDescription": "1 scoop",
      "calories": 100,
      "proteinGrams": 18,
      "carbohydrateGrams": 3,
      "fatGrams": 2,
      "ingredientsText": "Pea protein.",
      "allergenStatement": "No declared allergens.",
      "categorySlugs": ["protein"],
      "allergenSlugs": [],
      "restrictionSlugs": [],
      "sourceNote": "",
      "allergensReviewed": true,
      "restrictionsReviewed": true,
      "confirmedAccurate": false
    }'::jsonb
  );

insert into storage.objects (id, bucket_id, name)
values
  (
    '66000000-0000-4000-8000-000000000051',
    'food-labels',
    '66666666-6666-4666-8666-666666666662/66000000-0000-4000-8000-000000000041/nutrition.png'
  ),
  (
    '66000000-0000-4000-8000-000000000052',
    'food-labels',
    '66666666-6666-4666-8666-666666666662/66000000-0000-4000-8000-000000000042/nutrition.png'
  ),
  (
    '66000000-0000-4000-8000-000000000053',
    'food-labels',
    '66666666-6666-4666-8666-666666666662/66000000-0000-4000-8000-000000000043/nutrition.png'
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
values
  (
    '66000000-0000-4000-8000-000000000051',
    '66000000-0000-4000-8000-000000000041',
    '66666666-6666-4666-8666-666666666662',
    '66666666-6666-4666-8666-666666666662/66000000-0000-4000-8000-000000000041/nutrition.png',
    'nutrition',
    'image/png',
    1024,
    800,
    800,
    repeat('4', 64)
  ),
  (
    '66000000-0000-4000-8000-000000000052',
    '66000000-0000-4000-8000-000000000042',
    '66666666-6666-4666-8666-666666666662',
    '66666666-6666-4666-8666-666666666662/66000000-0000-4000-8000-000000000042/nutrition.png',
    'nutrition',
    'image/png',
    1024,
    800,
    800,
    repeat('5', 64)
  ),
  (
    '66000000-0000-4000-8000-000000000053',
    '66000000-0000-4000-8000-000000000043',
    '66666666-6666-4666-8666-666666666662',
    '66666666-6666-4666-8666-666666666662/66000000-0000-4000-8000-000000000043/nutrition.png',
    'nutrition',
    'image/png',
    1024,
    800,
    800,
    repeat('6', 64)
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '66666666-6666-4666-8666-666666666662',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"66666666-6666-4666-8666-666666666662","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    select public.create_confirmed_label_food(
      '{
        "brandName": "Legacy Barcode Brand",
        "productName": "Private Protein",
        "variantName": "No sharing",
        "gtin": "123456789012",
        "packageDescription": "10 servings",
        "servingWeightGrams": 30,
        "servingDescription": "1 scoop",
        "calories": 120,
        "proteinGrams": 20,
        "carbohydrateGrams": 4,
        "fatGrams": 2,
        "ingredientsText": "Pea protein, cocoa.",
        "allergenStatement": "No declared allergens.",
        "categorySlugs": ["protein"],
        "allergenSlugs": [],
        "restrictionSlugs": [],
        "sourceNote": "",
        "allergensReviewed": true,
        "restrictionsReviewed": true,
        "confirmedAccurate": true,
        "shareNormalizedProduct": false
      }'::jsonb,
      '66000000-0000-4000-8000-000000000041'
    )
  $$,
  'crafted legacy GTIN input still creates the owner private food'
);

select lives_ok(
  $$
    select public.create_confirmed_label_food(
      '{
        "brandName": "Legacy Barcode Brand",
        "productName": "Shared Protein",
        "variantName": "Explicit sharing",
        "gtin": "234567890123",
        "packageDescription": "10 servings",
        "servingWeightGrams": 30,
        "servingDescription": "1 scoop",
        "calories": 120,
        "proteinGrams": 20,
        "carbohydrateGrams": 4,
        "fatGrams": 2,
        "ingredientsText": "Pea protein, cocoa.",
        "allergenStatement": "No declared allergens.",
        "categorySlugs": ["protein"],
        "allergenSlugs": [],
        "restrictionSlugs": [],
        "sourceNote": "",
        "allergensReviewed": true,
        "restrictionsReviewed": true,
        "confirmedAccurate": true,
        "shareNormalizedProduct": true
      }'::jsonb,
      '66000000-0000-4000-8000-000000000042'
    )
  $$,
  'crafted legacy GTIN input can share only through explicit identity opt-in'
);

select lives_ok(
  $$
    select public.create_confirmed_label_food(
      '{
        "brandName": "Upgrade Brand",
        "productName": "Legacy Private Food",
        "variantName": "Original draft",
        "gtin": "",
        "packageDescription": "8 servings",
        "servingWeightGrams": 25,
        "servingDescription": "1 scoop",
        "calories": 100,
        "proteinGrams": 18,
        "carbohydrateGrams": 3,
        "fatGrams": 2,
        "ingredientsText": "Pea protein.",
        "allergenStatement": "No declared allergens.",
        "categorySlugs": ["protein"],
        "allergenSlugs": [],
        "restrictionSlugs": [],
        "sourceNote": "",
        "allergensReviewed": true,
        "restrictionsReviewed": true,
        "confirmedAccurate": true
      }'::jsonb,
      '66000000-0000-4000-8000-000000000043'
    )
  $$,
  'an authenticated pre-beta.3 draft upgrades to a private opt-out food'
);

select throws_ok(
  $$
    select public.create_confirmed_label_food(
      '{"shareNormalizedProduct":"true"}'::jsonb,
      '66000000-0000-4000-8000-000000000043'
    )
  $$,
  '22023',
  'Choose whether to share this product using true or false.',
  'a string true value is rejected rather than treated as consent'
);

select throws_ok(
  $$
    update public.food_label_submissions
    set review_note = 'unauthorized direct update'
    where id = '66000000-0000-4000-8000-000000000043'
  $$,
  '42501',
  'permission denied for table food_label_submissions',
  'authenticated accounts cannot bypass the RPC with a direct update'
);

reset role;

select ok(
  exists (
    select 1
    from public.food_label_submissions submission
    where submission.id = '66000000-0000-4000-8000-000000000041'
      and submission.private_food_id is not null
      and submission.published_food_id is null
  ),
  'GTIN input without opt-in cannot create or attach a shared catalog record'
);

select ok(
  not exists (
    select 1
    from public.food_sources source
    where source.external_id = 'shared-label:123456789012'
  ) and exists (
    select 1
    from public.food_label_submissions submission
    where submission.id = '66000000-0000-4000-8000-000000000041'
      and submission.gtin is null
  ),
  'the public RPC strips the retired GTIN sharing input atomically'
);

select isnt(
  (
    select published_food_id
    from public.food_label_submissions
    where id = '66000000-0000-4000-8000-000000000042'
  ),
  null::uuid,
  'explicit opt-in publishes the normalized product identity'
);

select ok(
  exists (
    select 1
    from public.food_label_submissions submission
    join public.food_sources source
      on source.food_id = submission.published_food_id
    join public.food_products product
      on product.food_id = submission.published_food_id
    where submission.id = '66000000-0000-4000-8000-000000000042'
      and source.external_id like 'shared-product:%'
      and source.external_id <> 'shared-label:234567890123'
      and product.gtin is null
  ),
  'opted-in crafted GTIN input uses only the privacy-safe identity path'
);

select ok(
  exists (
    select 1
    from public.food_label_submissions submission
    where submission.id = '66000000-0000-4000-8000-000000000043'
      and submission.private_food_id is not null
      and submission.published_food_id is null
      and submission.label_data -> 'shareNormalizedProduct' =
        'false'::jsonb
      and jsonb_typeof(
        submission.label_data -> 'shareNormalizedProduct'
      ) = 'boolean'
  ),
  'legacy missing consent is normalized to JSON false and remains private'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc procedure_entry
    join pg_catalog.pg_namespace namespace_entry
      on namespace_entry.oid = procedure_entry.pronamespace
    where namespace_entry.nspname = 'public'
      and procedure_entry.proname = 'create_confirmed_label_food'
      and pg_catalog.pg_get_function_identity_arguments(procedure_entry.oid) =
        'label_data jsonb, label_submission_id uuid'
      and procedure_entry.prosecdef
      and coalesce(array_to_string(procedure_entry.proconfig, ','), '')
        like '%search_path=""%'
      and procedure_entry.proowner = (
        select table_entry.relowner
        from pg_catalog.pg_class table_entry
        join pg_catalog.pg_namespace table_namespace
          on table_namespace.oid = table_entry.relnamespace
        where table_namespace.nspname = 'public'
          and table_entry.relname = 'foods'
      )
  ),
  'the public confirmation RPC is owner-controlled, security definer, and search-path hardened'
);

select ok(
  (
    select count(*) = 3
      and bool_and(procedure_entry.prosecdef)
      and bool_and(
        coalesce(array_to_string(procedure_entry.proconfig, ','), '')
          like '%search_path=""%'
      )
      and bool_and(
        procedure_entry.proowner = (
          select table_entry.relowner
          from pg_catalog.pg_class table_entry
          join pg_catalog.pg_namespace table_namespace
            on table_namespace.oid = table_entry.relnamespace
          where table_namespace.nspname = 'public'
            and table_entry.relname = 'foods'
        )
      )
    from pg_catalog.pg_proc procedure_entry
    join pg_catalog.pg_namespace namespace_entry
      on namespace_entry.oid = procedure_entry.pronamespace
    where namespace_entry.nspname = 'private'
      and procedure_entry.proname in (
        'create_confirmed_label_food_with_legacy_gtin',
        'publish_confirmed_label_identity',
        'scrub_legacy_shared_label_provenance'
      )
  ),
  'all private label functions retain trusted ownership and hardened security-definer configuration'
);

select ok(
  (
    select
      pg_catalog.has_function_privilege(
        'authenticated',
        procedure_entry.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'anon',
        procedure_entry.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role',
        procedure_entry.oid,
        'EXECUTE'
      )
    from pg_catalog.pg_proc procedure_entry
    join pg_catalog.pg_namespace namespace_entry
      on namespace_entry.oid = procedure_entry.pronamespace
    where namespace_entry.nspname = 'public'
      and procedure_entry.proname = 'create_confirmed_label_food'
  ),
  'only authenticated accounts can execute the public confirmation RPC'
);

select ok(
  (
    select count(*) = 3
      and bool_and(
        not pg_catalog.has_function_privilege(
          'anon',
          procedure_entry.oid,
          'EXECUTE'
        )
        and not pg_catalog.has_function_privilege(
          'authenticated',
          procedure_entry.oid,
          'EXECUTE'
        )
        and not pg_catalog.has_function_privilege(
          'service_role',
          procedure_entry.oid,
          'EXECUTE'
        )
      )
    from pg_catalog.pg_proc procedure_entry
    join pg_catalog.pg_namespace namespace_entry
      on namespace_entry.oid = procedure_entry.pronamespace
    where namespace_entry.nspname = 'private'
      and procedure_entry.proname in (
        'create_confirmed_label_food_with_legacy_gtin',
        'publish_confirmed_label_identity',
        'scrub_legacy_shared_label_provenance'
      )
  ),
  'no client or service API role can execute the private label functions'
);

select ok(
  (
    select
      procedure_entry.prosecdef
      and coalesce(array_to_string(procedure_entry.proconfig, ','), '')
        like '%search_path=""%'
      and procedure_entry.proowner = (
        select table_entry.relowner
        from pg_catalog.pg_class table_entry
        join pg_catalog.pg_namespace table_namespace
          on table_namespace.oid = table_entry.relnamespace
        where table_namespace.nspname = 'public'
          and table_entry.relname = 'profiles'
      )
      and not pg_catalog.has_function_privilege(
        'anon',
        procedure_entry.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated',
        procedure_entry.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role',
        procedure_entry.oid,
        'EXECUTE'
      )
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = to_regprocedure(
      'private.require_height_for_completed_onboarding()'
    )
  ),
  'the private height guard is trusted, hardened, and unavailable to API roles'
);

select ok(
  (
    select
      procedure_entry.prosecdef
      and coalesce(array_to_string(procedure_entry.proconfig, ','), '')
        like '%search_path=""%'
      and procedure_entry.proowner = (
        select table_entry.relowner
        from pg_catalog.pg_class table_entry
        join pg_catalog.pg_namespace table_namespace
          on table_namespace.oid = table_entry.relnamespace
        where table_namespace.nspname = 'public'
          and table_entry.relname = 'foods'
      )
      and not pg_catalog.has_function_privilege(
        'anon',
        procedure_entry.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated',
        procedure_entry.oid,
        'EXECUTE'
      )
      and pg_catalog.has_function_privilege(
        'service_role',
        procedure_entry.oid,
        'EXECUTE'
      )
    from pg_catalog.pg_proc procedure_entry
    where procedure_entry.oid = to_regprocedure(
      'public.application_health(text)'
    )
  ),
  'application health is trusted, hardened, and restricted to service role'
);

insert into public.legal_acceptances (
  user_id,
  document_type,
  document_version
)
values (
  '66666666-6666-4666-8666-666666666661',
  'terms',
  '1.1'
)
on conflict (user_id, document_type, document_version) do nothing;

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
values
  (
    '67000000-0000-4000-8000-000000000001',
    'legacy-accepted-shared-label',
    'Legacy Accepted Product',
    'Legacy normalized package label',
    'catalog',
    null,
    'source_reported',
    'branded_product',
    'pending_review'
  ),
  (
    '67000000-0000-4000-8000-000000000002',
    'legacy-unaccepted-shared-label',
    'Legacy Unaccepted Product',
    'Legacy normalized package label',
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
  gtin,
  package_description
)
values
  (
    '67000000-0000-4000-8000-000000000001',
    'Legacy Brand',
    'Accepted Product',
    '345678901234',
    '10 servings'
  ),
  (
    '67000000-0000-4000-8000-000000000002',
    'Legacy Brand',
    'Unaccepted Product',
    '456789012345',
    '10 servings'
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
values
  (
    '67000000-0000-4000-8000-000000000011',
    '67000000-0000-4000-8000-000000000001',
    'user_label',
    'shared-label:345678901234',
    'normalized-label-submission-v1',
    'Legacy label provenance.',
    repeat('a', 64)
  ),
  (
    '67000000-0000-4000-8000-000000000012',
    '67000000-0000-4000-8000-000000000002',
    'user_label',
    'shared-label:456789012345',
    'normalized-label-submission-v1',
    'Legacy label provenance.',
    repeat('b', 64)
  );

insert into public.food_safety_metadata (
  food_id,
  ingredients_text,
  allergen_statement,
  allergen_data_status,
  restriction_data_status,
  source_id
)
values
  (
    '67000000-0000-4000-8000-000000000001',
    'Pea protein.',
    'No declared allergens.',
    'source_reported',
    'source_reported',
    '67000000-0000-4000-8000-000000000011'
  ),
  (
    '67000000-0000-4000-8000-000000000002',
    'Pea protein.',
    'No declared allergens.',
    'source_reported',
    'source_reported',
    '67000000-0000-4000-8000-000000000012'
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
values
  (
    '67000000-0000-4000-8000-000000000021',
    '67000000-0000-4000-8000-000000000001',
    'as_sold',
    100,
    'g',
    400,
    70,
    15,
    5,
    'Legacy normalized package label',
    'Legacy normalized facts.',
    'source_reported',
    'normalized-label-submission-v1',
    '67000000-0000-4000-8000-000000000011'
  ),
  (
    '67000000-0000-4000-8000-000000000022',
    '67000000-0000-4000-8000-000000000002',
    'as_sold',
    100,
    'g',
    400,
    70,
    15,
    5,
    'Legacy normalized package label',
    'Legacy normalized facts.',
    'source_reported',
    'normalized-label-submission-v1',
    '67000000-0000-4000-8000-000000000012'
  );

insert into public.food_label_submissions (
  id,
  user_id,
  status,
  brand_name,
  product_name,
  gtin,
  label_data,
  published_food_id,
  submitted_at
)
values (
  '67000000-0000-4000-8000-000000000031',
  '66666666-6666-4666-8666-666666666661',
  'submitted',
  'Legacy Brand',
  'Accepted Product',
  '345678901234',
  '{
    "servingWeightGrams": 25,
    "calories": 100,
    "proteinGrams": 17.5,
    "carbohydrateGrams": 3.75,
    "fatGrams": 1.25,
    "confirmedAccurate": true
  }'::jsonb,
  '67000000-0000-4000-8000-000000000001',
  now()
);

create temporary table pg_temp.private_food_count_before_scrub as
select count(*)::integer as value
from public.foods
where ownership_type = 'private';

select lives_ok(
  $$ select private.scrub_legacy_shared_label_provenance() $$,
  'legacy provenance scrub executes as a trusted migration operation'
);

select ok(
  exists (
    select 1
    from public.foods food
    join public.food_sources source on source.food_id = food.id
    where food.id = '67000000-0000-4000-8000-000000000001'
      and food.catalog_status = 'pending_review'
      and source.payload_sha256 <> repeat('a', 64)
      and source.payload_sha256 ~ '^[a-f0-9]{64}$'
      and source.source_version = 'legacy-shared-label-scrub-v1'
      and source.attribution_text =
        'Grandfathered normalized package facts; prior photo-derived hash removed during beta.3 privacy hardening.'
  ),
  'Terms 1.1-linked legacy sharing remains pending with its photo hash scrubbed'
);

select ok(
  exists (
    select 1
    from public.foods food
    join public.food_sources source on source.food_id = food.id
    where food.id = '67000000-0000-4000-8000-000000000002'
      and food.catalog_status = 'rejected'
      and source.payload_sha256 <> repeat('b', 64)
      and source.payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  'an unlinked legacy shared row is scrubbed and rejected rather than grandfathered'
);

select is(
  (
    select count(*)::integer
    from public.foods
    where ownership_type = 'private'
  ),
  (
    select value from pg_temp.private_food_count_before_scrub
  ),
  'legacy provenance hardening never deletes owner-private foods'
);

create temporary table pg_temp.legacy_scrubbed_hash as
select payload_sha256 as value
from public.food_sources
where id = '67000000-0000-4000-8000-000000000011';

select lives_ok(
  $$ select private.scrub_legacy_shared_label_provenance() $$,
  'legacy provenance scrubbing is safely repeatable'
);

select is(
  (
    select payload_sha256
    from public.food_sources
    where id = '67000000-0000-4000-8000-000000000011'
  ),
  (
    select value from pg_temp.legacy_scrubbed_hash
  ),
  'legacy normalized-fact hashes are deterministic across repeated scrubs'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
set local role service_role;

select ok(
  (
    public.application_health(
      '20260813000000_reserve_external_food_import_capacity'
    ) ->> 'migrationCompatible'
  )::boolean,
  'the prior full database contract remains enabled under beta.5'
);

select is(
  (
    public.application_health('unexpected-migration')
      ->> 'migrationCompatible'
  )::boolean,
  false,
  'application health rejects an unexpected migration version'
);

reset role;
alter table public.food_label_submissions
  disable trigger publish_confirmed_label_identity;
set local role service_role;

select is(
  (
    public.application_health(
      '20260813000000_reserve_external_food_import_capacity'
    ) ->> 'migrationCompatible'
  )::boolean,
  false,
  'application health reports drift when a required trigger is disabled'
);

reset role;
alter table public.food_label_submissions
  enable trigger publish_confirmed_label_identity;

select * from finish();

rollback;
