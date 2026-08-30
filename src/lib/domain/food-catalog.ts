import { z } from "zod";

const FOOD_VERIFICATION_STATUSES = [
  "verified",
  "user_label",
  "source_reported",
  "pending_verification",
  "unavailable",
] as const;

export type FoodVerificationStatus =
  (typeof FOOD_VERIFICATION_STATUSES)[number];

const foodNutrientFactSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    amount: z.number().nonnegative(),
    unit: z.string().min(1),
    daily_value_percent: z.number().nonnegative().nullable().optional(),
    display_order: z.number().int().nonnegative().optional(),
  })
  .strict();

const foodNutritionFactsSchema = z
  .object({
    id: z.string().uuid().optional(),
    measurement_basis: z.enum([
      "raw",
      "dry",
      "cooked",
      "as_sold",
      "label_serving",
    ]),
    reference_quantity: z.number().positive(),
    reference_unit: z.enum(["g", "serving"]),
    serving_weight_grams: z.number().positive().nullable().optional(),
    serving_description: z.string().nullable().optional(),
    calories: z.number().nonnegative().nullable(),
    energy_kj: z.number().nonnegative().nullable().optional(),
    protein_g: z.number().nonnegative().nullable(),
    carbohydrate_g: z.number().nonnegative().nullable(),
    fat_g: z.number().nonnegative().nullable(),
    fiber_g: z.number().nonnegative().nullable().optional(),
    sodium_mg: z.number().nonnegative().nullable().optional(),
    saturated_fat_g: z.number().nonnegative().nullable().optional(),
    trans_fat_g: z.number().nonnegative().nullable().optional(),
    total_sugars_g: z.number().nonnegative().nullable().optional(),
    added_sugars_g: z.number().nonnegative().nullable().optional(),
    cholesterol_mg: z.number().nonnegative().nullable().optional(),
    potassium_mg: z.number().nonnegative().nullable().optional(),
    calcium_mg: z.number().nonnegative().nullable().optional(),
    iron_mg: z.number().nonnegative().nullable().optional(),
    vitamin_d_mcg: z.number().nonnegative().nullable().optional(),
    verification_status: z.enum(FOOD_VERIFICATION_STATUSES),
    nutrients: z.array(foodNutrientFactSchema).optional().default([]),
  })
  .strict();

export type FoodNutritionFacts = z.infer<typeof foodNutritionFactsSchema>;

const foodSourceSummarySchema = z
  .object({
    provider: z.enum([
      "usda_fdc",
      "open_food_facts",
      "user_label",
      "manual_review",
    ]),
    external_id: z.string().nullable().optional(),
    source_url: z.string().url().nullable().optional(),
    source_version: z.string().nullable().optional(),
    license_code: z.string().nullable().optional(),
    attribution_text: z.string().nullable().optional(),
    source_reference: z.string().nullable().optional(),
    retrieved_at: z.string().nullable().optional(),
  })
  .strict();

export type FoodSourceSummary = z.infer<typeof foodSourceSummarySchema>;

export const foodCatalogItemSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    english_name: z.string(),
    icon_ref: z.string().nullable().optional(),
    verification_status: z.enum(FOOD_VERIFICATION_STATUSES),
    ownership_type: z.enum(["catalog", "private"]),
    food_kind: z.enum(["generic", "branded_product"]),
    catalog_status: z.enum([
      "active",
      "pending_review",
      "rejected",
      "retired",
    ]),
    brand_name: z.string().nullable().optional(),
    product_name: z.string().nullable().optional(),
    variant_name: z.string().nullable().optional(),
    gtin: z.string().nullable().optional(),
    package_description: z.string().nullable().optional(),
    categories: z.array(z.string()).default([]),
    nutrition: foodNutritionFactsSchema.nullable(),
    source: foodSourceSummarySchema.nullable(),
    plan_eligible: z.boolean(),
  })
  .strict();

export type FoodCatalogItem = z.infer<typeof foodCatalogItemSchema>;
