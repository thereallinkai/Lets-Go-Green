import type { AiPlan } from "./ai-plan";
import {
  aggregateNutrition,
  combineNutritionAggregations,
  type NutritionAggregation,
  type NutritionRecord,
} from "./nutrition";

type NutritionRange = {
  minimum: number;
  maximum: number;
};

type PlanNutritionRanges = {
  energyKcal: NutritionRange | null;
  proteinGrams: NutritionRange | null;
};

type PlanNutritionIssue = {
  dayIndex: number;
  code:
    | "nutrition_record"
    | "energy_out_of_range"
    | "protein_out_of_range";
  message: string;
};

type PlanNutritionValidation = {
  valid: boolean;
  days: Array<{
    dayIndex: number;
    nutrition: NutritionAggregation;
  }>;
  issues: PlanNutritionIssue[];
};

function inRange(value: number, range: NutritionRange) {
  return value >= range.minimum && value <= range.maximum;
}

/**
 * Recalculates plan nutrition from trusted application records. Missing nutrient
 * values stay pending and are never converted into zero. Known energy and
 * protein totals must fall inside the deterministic ranges supplied to the
 * provider.
 */
export function validatePlanNutritionRanges(
  plan: AiPlan,
  records: readonly NutritionRecord[],
  ranges: PlanNutritionRanges,
): PlanNutritionValidation {
  const days: PlanNutritionValidation["days"] = [];
  const issues: PlanNutritionIssue[] = [];

  for (const day of plan.days) {
    try {
      const meals = day.meals.map((meal) =>
        aggregateNutrition(meal.items, records),
      );
      const nutrition = combineNutritionAggregations(meals);
      days.push({ dayIndex: day.dayIndex, nutrition });

      const calories = nutrition.totals.calories;
      if (ranges.energyKcal && calories === null) {
        issues.push({
          dayIndex: day.dayIndex,
          code: "nutrition_record",
          message: `Day ${day.dayIndex} energy could not be recalculated from complete trusted nutrition records.`,
        });
      }
      if (
        calories !== null &&
        ranges.energyKcal &&
        !inRange(calories, ranges.energyKcal)
      ) {
        issues.push({
          dayIndex: day.dayIndex,
          code: "energy_out_of_range",
          message: `Day ${day.dayIndex} energy is outside the deterministic range.`,
        });
      }

      const protein = nutrition.totals.proteinGrams;
      if (ranges.proteinGrams && protein === null) {
        issues.push({
          dayIndex: day.dayIndex,
          code: "nutrition_record",
          message: `Day ${day.dayIndex} protein could not be recalculated from complete trusted nutrition records.`,
        });
      }
      if (
        protein !== null &&
        ranges.proteinGrams &&
        !inRange(protein, ranges.proteinGrams)
      ) {
        issues.push({
          dayIndex: day.dayIndex,
          code: "protein_out_of_range",
          message: `Day ${day.dayIndex} protein is outside the deterministic range.`,
        });
      }
    } catch {
      issues.push({
        dayIndex: day.dayIndex,
        code: "nutrition_record",
        message: `Day ${day.dayIndex} could not be recalculated from trusted nutrition records.`,
      });
    }
  }

  return {
    valid: issues.length === 0 && days.length === plan.days.length,
    days,
    issues,
  };
}
