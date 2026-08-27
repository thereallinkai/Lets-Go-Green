import { z } from "zod";

const optionalGrams = z.number().min(0).max(10_000).nullable().optional();
const optionalEnergy = z.number().min(0).max(100_000).nullable().optional();
const optionalMilligrams = z
  .number()
  .min(0)
  .max(1_000_000)
  .nullable()
  .optional();

const foodLabelObjectSchema = z
  .object({
    brandName: z.string().trim().min(1).max(160),
    productName: z.string().trim().min(1).max(240),
    variantName: z.string().trim().max(160).default(""),
    gtin: z.string().regex(/^(?:|\d{8,14})$/).default(""),
    packageDescription: z.string().trim().max(240).default(""),
    servingWeightGrams: z.number().positive().max(10_000),
    servingDescription: z.string().trim().max(160).default("1 serving"),
    calories: z.number().min(0).max(10_000),
    energyKilojoules: optionalEnergy,
    proteinGrams: z.number().min(0).max(10_000),
    carbohydrateGrams: z.number().min(0).max(10_000),
    fatGrams: z.number().min(0).max(10_000),
    fiberGrams: optionalGrams,
    sodiumMilligrams: optionalMilligrams,
    saturatedFatGrams: optionalGrams,
    transFatGrams: optionalGrams,
    totalSugarsGrams: optionalGrams,
    addedSugarsGrams: optionalGrams,
    cholesterolMilligrams: optionalMilligrams,
    potassiumMilligrams: optionalMilligrams,
    calciumMilligrams: optionalMilligrams,
    ironMilligrams: optionalMilligrams,
    vitaminDMicrograms: optionalMilligrams,
    ingredientsText: z.string().trim().min(1).max(10_000),
    allergenStatement: z.string().trim().min(1).max(4_000),
    categorySlugs: z.array(z.string().min(1).max(60)).min(1).max(7),
    allergenSlugs: z.array(z.string().min(1).max(80)).max(50).default([]),
    restrictionSlugs: z.array(z.string().min(1).max(80)).max(50).default([]),
    sourceNote: z.string().trim().max(1_000).default(""),
    shareNormalizedProduct: z.boolean().default(false),
    allergensReviewed: z.boolean(),
    restrictionsReviewed: z.boolean(),
    confirmedAccurate: z.boolean(),
  })
  .strict();

const allergenAliases: Record<string, RegExp> = {
  milk: /\b(?:milk|dairy|whey|casein|caseinate|lactalbumin)\b/i,
  egg: /\b(?:eggs?|albumen|ovalbumin)\b/i,
  fish: /\b(?:fish|anchov(?:y|ies)|cod|salmon|tuna)\b/i,
  shellfish: /\b(?:shellfish|shrimp|prawn|crab|lobster|crayfish)\b/i,
  "tree-nuts":
    /\b(?:tree[- ]?nuts?|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil[- ]?nuts?)\b/i,
  peanuts: /\bpeanuts?\b/i,
  wheat: /\b(?:wheat|spelt|semolina|durum)\b/i,
  soy: /\b(?:soy|soya)\b/i,
  sesame: /\bsesame\b/i,
};

const allergenNegativeAlias =
  "(?:milk|dairy|whey|casein|caseinate|lactalbumin|eggs?|albumen|ovalbumin|fish|anchov(?:y|ies)|cod|salmon|tuna|shellfish|shrimp|prawn|crab|lobster|crayfish|tree[- ]?nuts?|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil[- ]?nuts?|peanuts?|wheat|spelt|semolina|durum|soy|soya|sesame)";

export function removeNegatedAllergenMentions(statement: string) {
  return statement
    .replace(
      new RegExp(`\\b${allergenNegativeAlias}[- ]free\\b`, "gi"),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:no|without|free\\s+from)\\s+(?:declared\\s+)?${allergenNegativeAlias}(?:\\s*(?:,|and|or)\\s*${allergenNegativeAlias})*`,
        "gi",
      ),
      "",
    );
}

function validateAllergenSelections(
  value: z.infer<typeof foodLabelObjectSchema>,
  context: z.RefinementCtx,
) {
  const statement = removeNegatedAllergenMentions(value.allergenStatement);
  const selected = new Set(value.allergenSlugs);
  for (const [slug, pattern] of Object.entries(allergenAliases)) {
    if (pattern.test(statement) && !selected.has(slug)) {
      context.addIssue({
        code: "custom",
        path: ["allergenSlugs"],
        message: `The package allergen statement mentions ${slug}; select it before confirming.`,
      });
    }
  }
}

export const foodLabelDataSchema =
  foodLabelObjectSchema.superRefine(validateAllergenSelections);

export const confirmedFoodLabelDataSchema = foodLabelObjectSchema
  .extend({
    allergensReviewed: z.literal(true),
    restrictionsReviewed: z.literal(true),
    confirmedAccurate: z.literal(true),
  })
  .superRefine(validateAllergenSelections);

export type FoodLabelData = z.infer<typeof foodLabelDataSchema>;
