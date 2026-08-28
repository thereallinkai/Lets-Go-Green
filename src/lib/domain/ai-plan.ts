import { z } from "zod";

import {
  evaluateFoodEligibility,
  type FoodEligibilityProfile,
} from "./food-filter";
import { PRIMARY_MEAL_TYPES } from "./meal-slots";
import {
  MEASUREMENT_BASES,
  type MeasurementBasis,
  type NutritionUnit,
  type NutritionVerificationStatus,
} from "./nutrition";

export const AI_PLAN_SCHEMA_VERSION = "1.0" as const;

const mealTypeSchema = z.enum(PRIMARY_MEAL_TYPES);
const measurementBasisSchema = z.enum(MEASUREMENT_BASES);

export const aiPlanItemSchema = z
  .object({
    foodId: z.string().trim().min(1).max(128),
    quantity: z.number().positive().max(10_000),
    unit: z.enum(["g", "serving"]),
    measurementBasis: measurementBasisSchema,
    preparationNote: z.string().trim().max(500).optional(),
    substitutionGroup: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const aiPlanMealSchema = z
  .object({
    mealType: mealTypeSchema,
    items: z.array(aiPlanItemSchema).min(1).max(20),
  })
  .strict()
  .superRefine((meal, context) => {
    const seen = new Set<string>();
    meal.items.forEach((item, index) => {
      const key = `${item.foodId}:${item.measurementBasis}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "foodId"],
          message:
            "A food and measurement basis may appear only once in the same meal.",
        });
      }
      seen.add(key);
    });
  });

export const aiPlanDaySchema = z
  .object({
    dayIndex: z.number().int().min(1).max(7),
    title: z.string().trim().min(1).max(100).optional(),
    meals: z.array(aiPlanMealSchema).length(3),
  })
  .strict()
  .superRefine((day, context) => {
    for (const mealType of PRIMARY_MEAL_TYPES) {
      if (day.meals.filter((meal) => meal.mealType === mealType).length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["meals"],
          message: `Day ${day.dayIndex} must contain exactly one ${mealType} meal.`,
        });
      }
    }
  });

export const aiPlanSchema = z
  .object({
    schemaVersion: z.literal(AI_PLAN_SCHEMA_VERSION),
    planApproach: z.enum(["standard", "non_restrictive"]),
    goalAssessment: z.string().trim().min(1).max(2_000),
    days: z.array(aiPlanDaySchema).length(7),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(20),
    majorReasons: z.array(z.string().trim().min(1).max(500)).max(20),
    hydrationGuidance: z.string().trim().min(1).max(1_000),
    weeklyReviewRules: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    safetyNotes: z.array(z.string().trim().min(1).max(500)).max(20),
  })
  .strict()
  .superRefine((plan, context) => {
    const dayIndexes = plan.days.map((day) => day.dayIndex);
    for (let dayIndex = 1; dayIndex <= 7; dayIndex += 1) {
      if (dayIndexes.filter((value) => value === dayIndex).length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["days"],
          message: `Plan must contain exactly one day with index ${dayIndex}.`,
        });
      }
    }
  });

export type AiPlan = z.infer<typeof aiPlanSchema>;
export type AiPlanItem = z.infer<typeof aiPlanItemSchema>;

export interface AllowedPlanFood {
  id: string;
  allowedMeasurementBases: readonly MeasurementBasis[];
  allowedUnits?: readonly NutritionUnit[];
  minimumQuantity?: Partial<Record<NutritionUnit, number>>;
  maximumQuantity?: Partial<Record<NutritionUnit, number>>;
  allergens?: readonly string[];
  dietaryRestrictionViolations?: readonly string[];
  verificationStatus: NutritionVerificationStatus;
}

export interface AiPlanValidationIssue {
  code:
    | "schema"
    | "unknown_food"
    | "verification"
    | "measurement_basis"
    | "unit"
    | "portion"
    | "allergen"
    | "dietary_restriction"
    | "unsafe_approach"
    | "unsafe_language";
  path: string;
  message: string;
}

export type AiPlanValidationResult =
  | { success: true; plan: AiPlan; issues: [] }
  | { success: false; plan: null; issues: AiPlanValidationIssue[] };

const GUARANTEE_PATTERN =
  /\b(?:guarantee|guaranteed|guarantees)\b.{0,80}\b(?:weight|fat|pounds?|kilograms?|lbs?|kgs?)\b/i;
const DIAGNOSIS_PATTERN =
  /\b(?:you have|you suffer from|you are diagnosed with)\b.{0,80}\b(?:disorder|disease|condition|syndrome)\b/i;

function proseFields(plan: AiPlan): string[] {
  return [
    plan.goalAssessment,
    plan.hydrationGuidance,
    ...plan.assumptions,
    ...plan.majorReasons,
    ...plan.weeklyReviewRules,
    ...plan.safetyNotes,
  ];
}

export function validateAiPlanDomain(
  input: unknown,
  context: {
    allowedFoods: readonly AllowedPlanFood[];
    profile: FoodEligibilityProfile;
    requiresNonRestrictivePlan?: boolean;
  },
): AiPlanValidationResult {
  const parsed = aiPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      plan: null,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema" as const,
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const plan = parsed.data;
  const issues: AiPlanValidationIssue[] = [];
  if (context.requiresNonRestrictivePlan && plan.planApproach !== "non_restrictive") {
    issues.push({
      code: "unsafe_approach",
      path: "planApproach",
      message: "This profile requires a non-restrictive plan approach.",
    });
  }
  proseFields(plan).forEach((text, index) => {
    if (GUARANTEE_PATTERN.test(text) || DIAGNOSIS_PATTERN.test(text)) {
      issues.push({
        code: "unsafe_language",
        path: `prose.${index}`,
        message: "Plan language must not diagnose a condition or guarantee weight change.",
      });
    }
  });

  const foodsById = new Map(context.allowedFoods.map((food) => [food.id, food]));
  plan.days.forEach((day, dayOffset) => {
    day.meals.forEach((meal, mealOffset) => {
      meal.items.forEach((item, itemOffset) => {
        const path = `days.${dayOffset}.meals.${mealOffset}.items.${itemOffset}`;
        const food = foodsById.get(item.foodId);
        if (!food) {
          issues.push({
            code: "unknown_food",
            path: `${path}.foodId`,
            message: `Food ${item.foodId} is not in the allowed catalog.`,
          });
          return;
        }
        if (!["verified", "user_label"].includes(food.verificationStatus)) {
          issues.push({
            code: "verification",
            path: `${path}.foodId`,
            message: `${item.foodId} does not have plan-eligible nutrition verification.`,
          });
        }
        if (!food.allowedMeasurementBases.includes(item.measurementBasis)) {
          issues.push({
            code: "measurement_basis",
            path: `${path}.measurementBasis`,
            message: `${item.measurementBasis} is not an allowed measurement basis for ${item.foodId}.`,
          });
        }
        if (food.allowedUnits && !food.allowedUnits.includes(item.unit)) {
          issues.push({
            code: "unit",
            path: `${path}.unit`,
            message: `${item.unit} is not an allowed unit for ${item.foodId}.`,
          });
        }
        const minimum = food.minimumQuantity?.[item.unit] ?? 0;
        const maximum =
          food.maximumQuantity?.[item.unit] ??
          (item.unit === "g" ? 2_000 : 20);
        if (item.quantity < minimum || item.quantity > maximum) {
          issues.push({
            code: "portion",
            path: `${path}.quantity`,
            message: `Quantity for ${item.foodId} is outside the allowed bounds.`,
          });
        }
        const exclusion = evaluateFoodEligibility(food, context.profile);
        if (exclusion?.allergyMatches.length) {
          issues.push({
            code: "allergen",
            path: `${path}.foodId`,
            message: `${item.foodId} conflicts with a recorded allergy.`,
          });
        }
        if (exclusion?.restrictionMatches.length) {
          issues.push({
            code: "dietary_restriction",
            path: `${path}.foodId`,
            message: `${item.foodId} conflicts with a dietary restriction.`,
          });
        }
      });
    });
  });

  return issues.length > 0
    ? { success: false, plan: null, issues }
    : { success: true, plan, issues: [] };
}
