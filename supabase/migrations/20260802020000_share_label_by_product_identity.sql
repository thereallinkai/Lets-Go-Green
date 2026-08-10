begin;

-- Editable drafts created before beta.3 have no explicit sharing decision.
-- Upgrade them to a real JSON false value so an old client can still confirm
-- its private food without silently opting in. Non-boolean crafted values are
-- deliberately left untouched and rejected by the public wrapper below.
update public.food_label_submissions submission
set label_data = jsonb_set(
  submission.label_data,
  '{shareNormalizedProduct}',
  'false'::jsonb,
  true
)
where submission.status in ('draft', 'needs_changes')
  and not submission.label_data ? 'shareNormalizedProduct';

-- The previous public wrapper delegated to an implementation that treated any
-- submitted GTIN as permission to create a shared catalog record. Retire that
-- entry point behind the private schema, then expose one wrapper that removes
-- legacy GTIN input from both the owned draft and confirmation payload. All
-- new sharing therefore passes through the explicit-consent identity trigger
-- below, including requests crafted outside the supported UI.
alter function public.create_confirmed_label_food(jsonb, uuid)
  rename to create_confirmed_label_food_with_legacy_gtin;
alter function public.create_confirmed_label_food_with_legacy_gtin(jsonb, uuid)
  set schema private;

revoke all on function
  private.create_confirmed_label_food_with_legacy_gtin(jsonb, uuid)
from public, anon, authenticated, service_role;

create function public.create_confirmed_label_food(
  label_data jsonb,
  label_submission_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  sanitized_label_data jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if jsonb_typeof(label_data) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'Complete and confirm the package label before using this product.';
  end if;

  if label_data ? 'shareNormalizedProduct'
    and jsonb_typeof(label_data -> 'shareNormalizedProduct')
      is distinct from 'boolean'
  then
    raise exception using
      errcode = '22023',
      message = 'Choose whether to share this product using true or false.';
  end if;

  sanitized_label_data := jsonb_set(
    jsonb_set(
      label_data,
      '{shareNormalizedProduct}',
      coalesce(label_data -> 'shareNormalizedProduct', 'false'::jsonb),
      true
    ),
    '{gtin}',
    '""'::jsonb,
    true
  );

  -- Lock and sanitize only the caller-owned editable draft. The retired
  -- validator compares this stored transcription with the confirmation in the
  -- same transaction, so a failure rolls this update back atomically.
  update public.food_label_submissions submission
  set
    gtin = null,
    label_data = jsonb_set(
      jsonb_set(
        submission.label_data,
        '{shareNormalizedProduct}',
        coalesce(
          submission.label_data -> 'shareNormalizedProduct',
          'false'::jsonb
        ),
        true
      ),
      '{gtin}',
      '""'::jsonb,
      true
    )
  where submission.id = label_submission_id
    and submission.user_id = current_user_id
    and submission.status in ('draft', 'needs_changes');

  return private.create_confirmed_label_food_with_legacy_gtin(
    sanitized_label_data,
    label_submission_id
  );
end;
$$;

revoke all on function public.create_confirmed_label_food(jsonb, uuid)
from public, anon, service_role;
grant execute on function public.create_confirmed_label_food(jsonb, uuid)
to authenticated;

comment on function public.create_confirmed_label_food(jsonb, uuid) is
  'Atomically creates a private confirmed-label food, discards legacy GTIN input, and shares a normalized catalog identity only after explicit opt-in.';

-- Pre-beta.3 GTIN sharing was disclosed under Terms 1.1 and linked each
-- catalog copy back to its consenting submission without exposing that link to
-- clients. Keep only those linked, Terms-accepted rows pending for review.
-- Regardless of acceptance, replace the historical photo SHA stored in public
-- provenance with a deterministic SHA-256 of non-photo normalized catalog
-- facts. Unaccepted shared rows are rejected; owner-private foods and evidence
-- are never deleted or changed.
create function private.scrub_legacy_shared_label_provenance()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  scrubbed_count integer := 0;
  rejected_count integer := 0;
begin
  with legacy_facts as (
    select
      source.id as source_id,
      jsonb_build_object(
        'schema', 'legacy-shared-label-facts-v1',
        'englishName', lower(regexp_replace(
          btrim(food.english_name),
          '\s+',
          ' ',
          'g'
        )),
        'product', jsonb_build_object(
          'brandName', lower(regexp_replace(
            btrim(product.brand_name),
            '\s+',
            ' ',
            'g'
          )),
          'productName', lower(regexp_replace(
            btrim(product.product_name),
            '\s+',
            ' ',
            'g'
          )),
          'variantName', lower(regexp_replace(
            btrim(coalesce(product.variant_name, '')),
            '\s+',
            ' ',
            'g'
          )),
          'manufacturerName', lower(regexp_replace(
            btrim(coalesce(product.manufacturer_name, '')),
            '\s+',
            ' ',
            'g'
          )),
          'gtin', coalesce(product.gtin, ''),
          'packageDescription', lower(regexp_replace(
            btrim(coalesce(product.package_description, '')),
            '\s+',
            ' ',
            'g'
          )),
          'countryCodes', to_jsonb(array(
            select distinct lower(btrim(country_code))
            from unnest(product.country_codes) country_code
            order by 1
          ))
        ),
        'nutrition', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'basis', nutrition.measurement_basis::text,
                'referenceQuantity',
                  trim_scale(nutrition.reference_quantity)::text,
                'referenceUnit', nutrition.reference_unit::text,
                'servingWeightGrams',
                  trim_scale(nutrition.serving_weight_grams)::text,
                'servingDescription',
                  lower(regexp_replace(
                    btrim(coalesce(nutrition.serving_description, '')),
                    '\s+',
                    ' ',
                    'g'
                  )),
                'calories', trim_scale(nutrition.calories)::text,
                'energyKilojoules', trim_scale(nutrition.energy_kj)::text,
                'proteinGrams', trim_scale(nutrition.protein_g)::text,
                'carbohydrateGrams',
                  trim_scale(nutrition.carbohydrate_g)::text,
                'fatGrams', trim_scale(nutrition.fat_g)::text,
                'fiberGrams', trim_scale(nutrition.fiber_g)::text,
                'sodiumMilligrams', trim_scale(nutrition.sodium_mg)::text,
                'saturatedFatGrams',
                  trim_scale(nutrition.saturated_fat_g)::text,
                'transFatGrams', trim_scale(nutrition.trans_fat_g)::text,
                'totalSugarsGrams',
                  trim_scale(nutrition.total_sugars_g)::text,
                'addedSugarsGrams',
                  trim_scale(nutrition.added_sugars_g)::text,
                'cholesterolMilligrams',
                  trim_scale(nutrition.cholesterol_mg)::text,
                'potassiumMilligrams',
                  trim_scale(nutrition.potassium_mg)::text,
                'calciumMilligrams', trim_scale(nutrition.calcium_mg)::text,
                'ironMilligrams', trim_scale(nutrition.iron_mg)::text,
                'vitaminDMicrograms',
                  trim_scale(nutrition.vitamin_d_mcg)::text,
                'dynamicNutrients', (
                  select coalesce(
                    jsonb_agg(
                      jsonb_build_object(
                        'code', amount.nutrient_code,
                        'name', lower(regexp_replace(
                          btrim(amount.display_name),
                          '\s+',
                          ' ',
                          'g'
                        )),
                        'amount', trim_scale(amount.amount)::text,
                        'unit', lower(btrim(amount.unit)),
                        'dailyValuePercent',
                          trim_scale(amount.daily_value_percent)::text
                      )
                      order by amount.nutrient_code
                    ),
                    '[]'::jsonb
                  )
                  from public.food_nutrient_amounts amount
                  where amount.nutrition_id = nutrition.id
                )
              )
              order by nutrition.measurement_basis::text
            ),
            '[]'::jsonb
          )
          from public.food_nutrition nutrition
          where nutrition.food_id = food.id
        ),
        'safety', (
          select jsonb_build_object(
            'ingredientsText', lower(regexp_replace(
              btrim(coalesce(safety.ingredients_text, '')),
              '\s+',
              ' ',
              'g'
            )),
            'allergenStatement', lower(regexp_replace(
              btrim(coalesce(safety.allergen_statement, '')),
              '\s+',
              ' ',
              'g'
            )),
            'allergenStatus', safety.allergen_data_status::text,
            'restrictionStatus', safety.restriction_data_status::text
          )
          from public.food_safety_metadata safety
          where safety.food_id = food.id
        ),
        'categorySlugs', to_jsonb(array(
          select category.slug
          from public.food_category_links mapping
          join public.food_categories category
            on category.id = mapping.category_id
          where mapping.food_id = food.id
          order by category.slug
        )),
        'allergenSlugs', to_jsonb(array(
          select allergen.slug
          from public.food_allergens mapping
          join public.allergens allergen on allergen.id = mapping.allergen_id
          where mapping.food_id = food.id
          order by allergen.slug
        )),
        'restrictionSlugs', to_jsonb(array(
          select restriction.slug
          from public.food_dietary_restrictions mapping
          join public.dietary_restriction_types restriction
            on restriction.id = mapping.restriction_id
          where mapping.food_id = food.id
          order by restriction.slug
        ))
      ) as normalized_facts
    from public.food_sources source
    join public.foods food on food.id = source.food_id
    join public.food_products product on product.food_id = food.id
    where source.provider = 'user_label'
      and source.external_id like 'shared-label:%'
      and food.ownership_type = 'catalog'
      and food.catalog_status in ('pending_review', 'rejected')
  )
  update public.food_sources source
  set
    payload_sha256 = encode(
      extensions.digest(
        convert_to(legacy.normalized_facts::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    source_version = 'legacy-shared-label-scrub-v1',
    attribution_text =
      'Grandfathered normalized package facts; prior photo-derived hash removed during beta.3 privacy hardening.',
    updated_at = now()
  from legacy_facts legacy
  where source.id = legacy.source_id;

  get diagnostics scrubbed_count = row_count;

  update public.foods food
  set
    catalog_status = 'rejected',
    updated_at = now()
  where food.ownership_type = 'catalog'
    and food.catalog_status = 'pending_review'
    and exists (
      select 1
      from public.food_sources source
      where source.food_id = food.id
        and source.provider = 'user_label'
        and source.external_id like 'shared-label:%'
    )
    and not exists (
      select 1
      from public.food_label_submissions submission
      join public.legal_acceptances acceptance
        on acceptance.user_id = submission.user_id
       and acceptance.document_type = 'terms'
       and acceptance.document_version = '1.1'
      where submission.published_food_id = food.id
    );

  get diagnostics rejected_count = row_count;
  return scrubbed_count + rejected_count;
end;
$$;

revoke all on function private.scrub_legacy_shared_label_provenance()
from public, anon, authenticated, service_role;

comment on function private.scrub_legacy_shared_label_provenance() is
  'Scrubs photo-derived public hashes from legacy shared labels, retains Terms 1.1-linked rows pending review, rejects unlinked rows, and preserves all private records.';

select private.scrub_legacy_shared_label_provenance();

create or replace function private.publish_confirmed_label_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_material text;
  identity_payload jsonb;
  identity_hash text;
  shared_external_id text;
  shared_food_id uuid;
  shared_ownership_type text;
  shared_catalog_status text;
  shared_source_id uuid;
  shared_nutrition_id uuid;
  private_nutrition_id uuid;
  private_product_brand_name text;
  private_product_product_name text;
  private_product_variant_name text;
  private_product_manufacturer_name text;
  private_product_package_description text;
  private_product_country_codes text[];
  shared_display_name text;
  base_slug text;
begin
  if new.status <> 'submitted'
    or new.private_food_id is null
    or new.published_food_id is not null
    or new.gtin is not null
    or new.label_data -> 'confirmedAccurate' is distinct from 'true'::jsonb
    or new.label_data -> 'shareNormalizedProduct'
      is distinct from 'true'::jsonb
  then
    return new;
  end if;

  -- Sharing is secondary to the owner's private food. Refuse to publish an
  -- incomplete or mismatched private record instead of creating a partial
  -- catalog row or making private confirmation fail.
  select
    nutrition.id,
    product.brand_name,
    product.product_name,
    product.variant_name,
    product.manufacturer_name,
    product.package_description,
    product.country_codes
  into
    private_nutrition_id,
    private_product_brand_name,
    private_product_product_name,
    private_product_variant_name,
    private_product_manufacturer_name,
    private_product_package_description,
    private_product_country_codes
  from public.foods food
  join public.food_products product on product.food_id = food.id
  join public.food_nutrition nutrition
    on nutrition.food_id = food.id
   and nutrition.measurement_basis = 'as_sold'
  join public.food_safety_metadata safety on safety.food_id = food.id
  where food.id = new.private_food_id
    and food.ownership_type = 'private'
    and food.owner_user_id = new.user_id
    and food.verification_status = 'user_label'
    and food.catalog_status = 'active'
    and nutrition.verification_status = 'user_label'
    and safety.allergen_data_status in ('user_confirmed', 'reviewed')
    and safety.restriction_data_status in ('user_confirmed', 'reviewed')
    and num_nonnulls(
      nutrition.calories,
      nutrition.protein_g,
      nutrition.carbohydrate_g,
      nutrition.fat_g
    ) = 4
  limit 1
  for share of product;

  if private_nutrition_id is null then
    return new;
  end if;

  shared_display_name := left(
    btrim(private_product_brand_name)
      || ' '
      || btrim(private_product_product_name)
      || case
        when nullif(btrim(private_product_variant_name), '') is null then ''
        else ' — ' || btrim(private_product_variant_name)
      end,
    160
  );

  -- Hash the complete normalized product label, not only its core macros.
  -- This keeps products with different ingredients, allergens, optional
  -- nutrients, or dynamic nutrients from being silently merged. Text and
  -- selection arrays are normalized so harmless case/order/spacing changes
  -- still reuse the same catalog identity.
  identity_payload := jsonb_build_object(
    'schema', 'normalized-label-identity-v1',
    'brandName',
      lower(regexp_replace(
        btrim(private_product_brand_name),
        '\s+',
        ' ',
        'g'
      )),
    'productName',
      lower(regexp_replace(
        btrim(private_product_product_name),
        '\s+',
        ' ',
        'g'
      )),
    'variantName',
      lower(regexp_replace(
        btrim(coalesce(private_product_variant_name, '')),
        '\s+',
        ' ',
        'g'
      )),
    'packageDescription',
      lower(regexp_replace(
        btrim(coalesce(private_product_package_description, '')),
        '\s+',
        ' ',
        'g'
      )),
    'manufacturerName',
      lower(regexp_replace(
        btrim(coalesce(private_product_manufacturer_name, '')),
        '\s+',
        ' ',
        'g'
      )),
    'countryCodes', to_jsonb(array(
      select distinct lower(btrim(country_code))
      from unnest(private_product_country_codes) country_code
      order by 1
    )),
    'servingDescription',
      lower(regexp_replace(
        btrim(coalesce(new.label_data ->> 'servingDescription', '')),
        '\s+',
        ' ',
        'g'
      )),
    'servingWeightGrams',
      trim_scale((new.label_data ->> 'servingWeightGrams')::numeric)::text,
    'nutrition', jsonb_build_object(
      'calories',
        trim_scale((new.label_data ->> 'calories')::numeric)::text,
      'energyKilojoules',
        trim_scale(
          nullif(new.label_data ->> 'energyKilojoules', '')::numeric
        )::text,
      'proteinGrams',
        trim_scale((new.label_data ->> 'proteinGrams')::numeric)::text,
      'carbohydrateGrams',
        trim_scale(
          (new.label_data ->> 'carbohydrateGrams')::numeric
        )::text,
      'fatGrams',
        trim_scale((new.label_data ->> 'fatGrams')::numeric)::text,
      'fiberGrams',
        trim_scale(
          nullif(new.label_data ->> 'fiberGrams', '')::numeric
        )::text,
      'sodiumMilligrams',
        trim_scale(
          nullif(new.label_data ->> 'sodiumMilligrams', '')::numeric
        )::text,
      'saturatedFatGrams',
        trim_scale(
          nullif(new.label_data ->> 'saturatedFatGrams', '')::numeric
        )::text,
      'transFatGrams',
        trim_scale(
          nullif(new.label_data ->> 'transFatGrams', '')::numeric
        )::text,
      'totalSugarsGrams',
        trim_scale(
          nullif(new.label_data ->> 'totalSugarsGrams', '')::numeric
        )::text,
      'addedSugarsGrams',
        trim_scale(
          nullif(new.label_data ->> 'addedSugarsGrams', '')::numeric
        )::text,
      'cholesterolMilligrams',
        trim_scale(
          nullif(new.label_data ->> 'cholesterolMilligrams', '')::numeric
        )::text,
      'potassiumMilligrams',
        trim_scale(
          nullif(new.label_data ->> 'potassiumMilligrams', '')::numeric
        )::text,
      'calciumMilligrams',
        trim_scale(
          nullif(new.label_data ->> 'calciumMilligrams', '')::numeric
        )::text,
      'ironMilligrams',
        trim_scale(
          nullif(new.label_data ->> 'ironMilligrams', '')::numeric
        )::text,
      'vitaminDMicrograms',
        trim_scale(
          nullif(new.label_data ->> 'vitaminDMicrograms', '')::numeric
        )::text
    ),
    'asSoldNutrition', (
      select jsonb_build_object(
        'referenceQuantity',
          trim_scale(nutrition.reference_quantity)::text,
        'referenceUnit', nutrition.reference_unit::text,
        'calories', trim_scale(nutrition.calories)::text,
        'energyKilojoules', trim_scale(nutrition.energy_kj)::text,
        'proteinGrams', trim_scale(nutrition.protein_g)::text,
        'carbohydrateGrams',
          trim_scale(nutrition.carbohydrate_g)::text,
        'fatGrams', trim_scale(nutrition.fat_g)::text,
        'fiberGrams', trim_scale(nutrition.fiber_g)::text,
        'sodiumMilligrams', trim_scale(nutrition.sodium_mg)::text,
        'saturatedFatGrams',
          trim_scale(nutrition.saturated_fat_g)::text,
        'transFatGrams', trim_scale(nutrition.trans_fat_g)::text,
        'totalSugarsGrams', trim_scale(nutrition.total_sugars_g)::text,
        'addedSugarsGrams', trim_scale(nutrition.added_sugars_g)::text,
        'cholesterolMilligrams',
          trim_scale(nutrition.cholesterol_mg)::text,
        'potassiumMilligrams', trim_scale(nutrition.potassium_mg)::text,
        'calciumMilligrams', trim_scale(nutrition.calcium_mg)::text,
        'ironMilligrams', trim_scale(nutrition.iron_mg)::text,
        'vitaminDMicrograms', trim_scale(nutrition.vitamin_d_mcg)::text
      )
      from public.food_nutrition nutrition
      where nutrition.id = private_nutrition_id
    ),
    'ingredientsText', (
      select lower(regexp_replace(
        btrim(coalesce(safety.ingredients_text, '')),
        '\s+',
        ' ',
        'g'
      ))
      from public.food_safety_metadata safety
      where safety.food_id = new.private_food_id
    ),
    'allergenStatement', (
      select lower(regexp_replace(
        btrim(coalesce(safety.allergen_statement, '')),
        '\s+',
        ' ',
        'g'
      ))
      from public.food_safety_metadata safety
      where safety.food_id = new.private_food_id
    ),
    'categorySlugs', to_jsonb(array(
      select distinct lower(btrim(category.slug))
      from public.food_category_links mapping
      join public.food_categories category on category.id = mapping.category_id
      where mapping.food_id = new.private_food_id
      order by 1
    )),
    'allergenSlugs', to_jsonb(array(
      select distinct lower(btrim(allergen.slug))
      from public.food_allergens mapping
      join public.allergens allergen on allergen.id = mapping.allergen_id
      where mapping.food_id = new.private_food_id
      order by 1
    )),
    'restrictionSlugs', to_jsonb(array(
      select distinct lower(btrim(restriction.slug))
      from public.food_dietary_restrictions mapping
      join public.dietary_restriction_types restriction
        on restriction.id = mapping.restriction_id
      where mapping.food_id = new.private_food_id
      order by 1
    )),
    'dynamicNutrients', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'code', lower(btrim(amount.nutrient_code)),
            'name', lower(regexp_replace(
              btrim(amount.display_name),
              '\s+',
              ' ',
              'g'
            )),
            'amount', trim_scale(amount.amount)::text,
            'unit', lower(regexp_replace(
              btrim(amount.unit),
              '\s+',
              ' ',
              'g'
            )),
            'dailyValuePercent',
              trim_scale(amount.daily_value_percent)::text
          )
          order by amount.nutrient_code
        ),
        '[]'::jsonb
      )
      from public.food_nutrient_amounts amount
      where amount.nutrition_id = private_nutrition_id
    )
  );
  identity_material := identity_payload::text;
  identity_hash := encode(
    extensions.digest(convert_to(identity_material, 'UTF8'), 'sha256'),
    'hex'
  );
  shared_external_id := 'shared-product:' || identity_hash;

  perform pg_advisory_xact_lock(
    hashtextextended('catalog-product-identity:' || identity_hash, 0)
  );

  select
    source.food_id,
    food.ownership_type::text,
    food.catalog_status::text
  into shared_food_id, shared_ownership_type, shared_catalog_status
  from public.food_sources source
  join public.foods food on food.id = source.food_id
  where source.provider = 'user_label'
    and source.external_id = shared_external_id
  limit 1;

  -- The external-ID namespace is globally unique. If an unexpected private,
  -- rejected, or retired row already occupies this identity, leave the
  -- owner's private food intact and do not attach it to an unusable record.
  if shared_food_id is not null
    and (
      shared_ownership_type <> 'catalog'
      or shared_catalog_status not in ('active', 'pending_review')
    )
  then
    return new;
  end if;

  if shared_food_id is null then
    shared_food_id := extensions.gen_random_uuid();
    base_slug := trim(
      both '-' from regexp_replace(
        lower(
          btrim(private_product_brand_name)
          || '-'
          || btrim(private_product_product_name)
          || '-'
          || coalesce(
            nullif(btrim(private_product_variant_name), ''),
            'product'
          )
        ),
        '[^a-z0-9]+',
        '-',
        'g'
      )
    );

    insert into public.foods (
      id,
      slug,
      english_name,
      icon_ref,
      source,
      ownership_type,
      owner_user_id,
      verification_status,
      food_kind,
      catalog_status
    )
    values (
      shared_food_id,
      left(coalesce(nullif(base_slug, ''), 'label-product'), 27)
        || '-shared-'
        || identity_hash,
      shared_display_name,
      'package',
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
      variant_name,
      manufacturer_name,
      gtin,
      package_description,
      country_codes
    )
    values (
      shared_food_id,
      private_product_brand_name,
      private_product_product_name,
      private_product_variant_name,
      private_product_manufacturer_name,
      null,
      private_product_package_description,
      private_product_country_codes
    );

    insert into public.food_sources (
      food_id,
      provider,
      external_id,
      source_version,
      attribution_text,
      retrieved_at,
      payload_sha256
    )
    values (
      shared_food_id,
      'user_label',
      shared_external_id,
      'normalized-label-identity-v1',
      'Normalized from an account-confirmed package label. The raw image and account identity remain private.',
      now(),
      identity_hash
    )
    returning id into shared_source_id;

    insert into public.food_safety_metadata (
      food_id,
      ingredients_text,
      allergen_statement,
      allergen_data_status,
      restriction_data_status,
      source_id
    )
    select
      shared_food_id,
      safety.ingredients_text,
      safety.allergen_statement,
      'source_reported',
      'source_reported',
      shared_source_id
    from public.food_safety_metadata safety
    where safety.food_id = new.private_food_id;

    insert into public.food_nutrition (
      food_id,
      measurement_basis,
      reference_quantity,
      reference_unit,
      serving_weight_grams,
      serving_description,
      calories,
      energy_kj,
      protein_g,
      carbohydrate_g,
      fat_g,
      fiber_g,
      sodium_mg,
      saturated_fat_g,
      trans_fat_g,
      total_sugars_g,
      added_sugars_g,
      cholesterol_mg,
      potassium_mg,
      calcium_mg,
      iron_mg,
      vitamin_d_mcg,
      source_name,
      source_reference,
      verification_status,
      source_version,
      source_id
    )
    select
      shared_food_id,
      nutrition.measurement_basis,
      nutrition.reference_quantity,
      nutrition.reference_unit,
      nutrition.serving_weight_grams,
      nutrition.serving_description,
      nutrition.calories,
      nutrition.energy_kj,
      nutrition.protein_g,
      nutrition.carbohydrate_g,
      nutrition.fat_g,
      nutrition.fiber_g,
      nutrition.sodium_mg,
      nutrition.saturated_fat_g,
      nutrition.trans_fat_g,
      nutrition.total_sugars_g,
      nutrition.added_sugars_g,
      nutrition.cholesterol_mg,
      nutrition.potassium_mg,
      nutrition.calcium_mg,
      nutrition.iron_mg,
      nutrition.vitamin_d_mcg,
      'Normalized account-confirmed package label',
      'Normalized from an account-confirmed label; raw evidence remains private.',
      'source_reported',
      'normalized-label-identity-v1',
      shared_source_id
    from public.food_nutrition nutrition
    where nutrition.food_id = new.private_food_id
      and nutrition.measurement_basis = 'as_sold'
    returning id into shared_nutrition_id;

    insert into public.food_nutrient_amounts (
      nutrition_id,
      nutrient_code,
      display_name,
      amount,
      unit,
      daily_value_percent,
      display_order
    )
    select
      shared_nutrition_id,
      amount.nutrient_code,
      amount.display_name,
      amount.amount,
      amount.unit,
      amount.daily_value_percent,
      amount.display_order
    from public.food_nutrient_amounts amount
    where amount.nutrition_id = private_nutrition_id;

    insert into public.food_allergens (food_id, allergen_id)
    select shared_food_id, mapping.allergen_id
    from public.food_allergens mapping
    where mapping.food_id = new.private_food_id
    on conflict (food_id, allergen_id) do nothing;

    insert into public.food_category_links (food_id, category_id)
    select shared_food_id, mapping.category_id
    from public.food_category_links mapping
    where mapping.food_id = new.private_food_id
    on conflict (food_id, category_id) do nothing;

    insert into public.food_dietary_restrictions (food_id, restriction_id)
    select shared_food_id, mapping.restriction_id
    from public.food_dietary_restrictions mapping
    where mapping.food_id = new.private_food_id
    on conflict (food_id, restriction_id) do nothing;
  end if;

  update public.food_label_submissions
  set published_food_id = shared_food_id
  where id = new.id
    and published_food_id is null;

  return new;
end;
$$;

revoke all on function private.publish_confirmed_label_identity()
from public, anon, authenticated, service_role;

comment on function private.publish_confirmed_label_identity() is
  'With explicit account opt-in, publishes a privacy-safe pending catalog copy for a confirmed no-barcode label using a complete normalized product-label fingerprint.';

drop trigger if exists publish_confirmed_label_identity
  on public.food_label_submissions;
create trigger publish_confirmed_label_identity
after update of status, private_food_id on public.food_label_submissions
for each row
when (
  new.status = 'submitted'
  and new.private_food_id is not null
  and new.published_food_id is null
  and new.gtin is null
  and new.label_data -> 'confirmedAccurate' = 'true'::jsonb
  and new.label_data -> 'shareNormalizedProduct' = 'true'::jsonb
)
execute function private.publish_confirmed_label_identity();

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
    '20260802020000_share_label_by_product_identity';
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
    or to_regprocedure(
      'private.publish_confirmed_label_identity()'
    ) is null
    or to_regprocedure(
      'private.scrub_legacy_shared_label_provenance()'
    ) is null
    or to_regprocedure(
      'private.create_confirmed_label_food_with_legacy_gtin(jsonb,uuid)'
    ) is null
    or to_regprocedure(
      'public.create_confirmed_label_food(jsonb,uuid)'
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
    or not exists (
      select 1
      from pg_catalog.pg_trigger trigger_entry
      join pg_catalog.pg_class table_entry
        on table_entry.oid = trigger_entry.tgrelid
      join pg_catalog.pg_namespace namespace_entry
        on namespace_entry.oid = table_entry.relnamespace
      where namespace_entry.nspname = 'public'
        and table_entry.relname = 'food_label_submissions'
        and trigger_entry.tgname = 'publish_confirmed_label_identity'
        and trigger_entry.tgfoid = to_regprocedure(
          'private.publish_confirmed_label_identity()'
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
