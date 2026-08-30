import {
  assessGoalDirectionConsistency,
  assessGoalTimeline,
  type GoalAssessment,
  type GoalDirectionConsistency,
  type GoalType,
} from "./goals";
import {
  evaluateSafetyContext,
  type ConcerningSymptom,
  type SafetyAssessment,
} from "./safety";

export const NUTRITION_ESTIMATOR_VERSION = "wellness-estimator-v1.0.0";

type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "very_active";
type SexForEstimate = "female" | "male" | "unspecified";

interface EstimateRange {
  minimum: number;
  maximum: number;
  unit: "kcal/day" | "g/day";
  precisionLabel: "estimate range";
}

export interface NutritionEstimateInput {
  weightKg?: number | null;
  heightCm?: number | null;
  ageYears?: number | null;
  sexForEstimate?: SexForEstimate | null;
  activityLevel?: ActivityLevel | null;
  goalType: GoalType;
  pregnantOrNursing?: boolean | null;
  eatingDisorderHistory?: boolean | null;
  relevantMedicalConcerns?: boolean | null;
  symptoms?: readonly ConcerningSymptom[];
}

export interface NutritionEstimate {
  calculatorVersion: typeof NUTRITION_ESTIMATOR_VERSION;
  status: "complete" | "partial" | "insufficient_data" | "safety_limited";
  calorieRange: EstimateRange | null;
  maintenanceCalorieRange: EstimateRange | null;
  proteinRange: EstimateRange | null;
  missingInputs: string[];
  assumptions: string[];
  method: {
    bmrEquation: "Mifflin-St Jeor" | null;
    activityMultiplierRange: readonly [number, number] | null;
    goalEnergyFactorRange: readonly [number, number] | null;
    proteinGramsPerKilogramRange: readonly [number, number] | null;
  };
}

export interface GoalAwareNutritionAssessmentInput {
  currentWeightKg?: number | null;
  startingWeightKg?: number | null;
  targetWeightKg?: number | null;
  planStartDate?: string | null;
  targetDate?: string | null;
  goalType: GoalType;
  heightCm?: number | null;
  ageYears?: number | null;
  gender?: string | null;
  profileActivityLevel?: string | null;
  relevantMedicalConcerns?: boolean | null;
}

export interface GoalAwareNutritionAssessment {
  goalTimeline: GoalAssessment | null;
  safety: SafetyAssessment;
  estimate: NutritionEstimate;
}

const ACTIVITY_MULTIPLIERS: Readonly<
  Record<ActivityLevel, readonly [number, number]>
> = {
  sedentary: [1.15, 1.25],
  light: [1.3, 1.4],
  moderate: [1.45, 1.6],
  very_active: [1.65, 1.8],
};

const GOAL_ENERGY_FACTORS: Readonly<
  Record<GoalType, readonly [number, number]>
> = {
  fat_loss: [0.8, 0.9],
  muscle_gain: [1.05, 1.12],
  maintenance: [0.95, 1.05],
  body_recomposition: [0.9, 1],
};

const PROTEIN_FACTORS: Readonly<
  Record<GoalType, readonly [number, number]>
> = {
  fat_loss: [1.6, 2.2],
  muscle_gain: [1.6, 2.2],
  maintenance: [1.2, 1.6],
  body_recomposition: [1.6, 2.2],
};

function validPositive(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0;
}

function normalizeActivityLevel(
  value: string | null | undefined,
): ActivityLevel | null {
  switch (value) {
    case "sedentary":
      return "sedentary";
    case "lightly_active":
      return "light";
    case "moderately_active":
      return "moderate";
    case "very_active":
    case "extremely_active":
      return "very_active";
    default:
      return null;
  }
}

function normalizeSexForEstimate(
  gender: string | null | undefined,
): SexForEstimate {
  return gender === "male" || gender === "female" ? gender : "unspecified";
}

function roundedRange(
  minimum: number,
  maximum: number,
  increment: number,
  unit: EstimateRange["unit"],
): EstimateRange {
  return {
    minimum: Math.floor(minimum / increment) * increment,
    maximum: Math.ceil(maximum / increment) * increment,
    unit,
    precisionLabel: "estimate range",
  };
}

function calculateNutritionEstimateWithSafety(
  input: NutritionEstimateInput,
  safety: SafetyAssessment,
): NutritionEstimate {
  const missingInputs: string[] = [];
  const assumptions: string[] = [
    "This deterministic estimate is general wellness information, not medical advice.",
    "Actual needs vary, so values are shown as ranges rather than precise prescriptions.",
  ];
  const proteinFactors = PROTEIN_FACTORS[input.goalType];
  const proteinRange = validPositive(input.weightKg)
    ? roundedRange(
        input.weightKg * proteinFactors[0],
        input.weightKg * proteinFactors[1],
        5,
        "g/day",
      )
    : null;
  if (!validPositive(input.weightKg)) missingInputs.push("weightKg");

  const calorieRequirements = [
    ["heightCm", input.heightCm],
    ["ageYears", input.ageYears],
    ["activityLevel", input.activityLevel],
  ] as const;
  for (const [name, value] of calorieRequirements) {
    if (
      value === null ||
      value === undefined ||
      (typeof value === "number" && (!Number.isFinite(value) || value <= 0))
    ) {
      missingInputs.push(name);
    }
  }

  const canCalculateCalories =
    validPositive(input.weightKg) &&
    validPositive(input.heightCm) &&
    validPositive(input.ageYears) &&
    input.activityLevel !== null &&
    input.activityLevel !== undefined;

  let maintenanceCalorieRange: EstimateRange | null = null;
  let calorieRange: EstimateRange | null = null;
  let activityRange: readonly [number, number] | null = null;
  let goalRange: readonly [number, number] | null = null;
  if (canCalculateCalories) {
    activityRange = ACTIVITY_MULTIPLIERS[input.activityLevel!];
    const base =
      10 * input.weightKg! + 6.25 * input.heightCm! - 5 * input.ageYears!;
    const sex = input.sexForEstimate ?? "unspecified";
    const bmrMinimum = base + (sex === "male" ? 5 : -161);
    const bmrMaximum = base + (sex === "female" ? -161 : 5);
    if (sex === "unspecified") {
      assumptions.push(
        "Because no equation sex was provided, the calorie range spans both Mifflin-St Jeor constants.",
      );
    }
    maintenanceCalorieRange = roundedRange(
      bmrMinimum * activityRange[0],
      bmrMaximum * activityRange[1],
      25,
      "kcal/day",
    );
    if (!safety.requiresNonRestrictivePlan) {
      goalRange = GOAL_ENERGY_FACTORS[input.goalType];
      calorieRange = roundedRange(
        bmrMinimum * activityRange[0] * goalRange[0],
        bmrMaximum * activityRange[1] * goalRange[1],
        25,
        "kcal/day",
      );
    } else {
      assumptions.push(
        "A goal-adjusted calorie range was withheld because the safety screen requires non-restrictive guidance.",
      );
    }
  }

  const status = safety.requiresNonRestrictivePlan
    ? "safety_limited"
    : calorieRange && proteinRange
      ? "complete"
      : calorieRange || proteinRange
        ? "partial"
        : "insufficient_data";
  return {
    calculatorVersion: NUTRITION_ESTIMATOR_VERSION,
    status,
    calorieRange,
    maintenanceCalorieRange,
    proteinRange,
    missingInputs: [...new Set(missingInputs)],
    assumptions,
    method: {
      bmrEquation: canCalculateCalories ? "Mifflin-St Jeor" : null,
      activityMultiplierRange: activityRange,
      goalEnergyFactorRange: goalRange,
      proteinGramsPerKilogramRange: validPositive(input.weightKg)
        ? proteinFactors
        : null,
    },
  };
}

export function calculateNutritionEstimate(
  input: NutritionEstimateInput,
): NutritionEstimate {
  return calculateNutritionEstimateWithSafety(
    input,
    evaluateSafetyContext({
      ageYears: input.ageYears,
      pregnantOrNursing: input.pregnantOrNursing,
      eatingDisorderHistory: input.eatingDisorderHistory,
      relevantMedicalConcerns: input.relevantMedicalConcerns,
      symptoms: input.symptoms,
    }),
  );
}

export function assessGoalAwareNutrition(
  input: GoalAwareNutritionAssessmentInput,
): GoalAwareNutritionAssessment {
  const { startingWeightKg, targetWeightKg, planStartDate, targetDate } = input;
  let goalDirection: GoalDirectionConsistency | null = null;
  let goalTimeline: GoalAssessment | null = null;
  if (validPositive(startingWeightKg) && validPositive(targetWeightKg)) {
    goalDirection = assessGoalDirectionConsistency({
      startingWeightKg,
      targetWeightKg,
      goalType: input.goalType,
    });
    if (
      typeof planStartDate === "string" &&
      planStartDate.length > 0 &&
      typeof targetDate === "string" &&
      targetDate.length > 0
    ) {
      goalTimeline = assessGoalTimeline({
        startingWeightKg,
        targetWeightKg,
        goalType: input.goalType,
        startDate: planStartDate,
        targetDate,
      });
    }
  }
  const safety = evaluateSafetyContext({
    ageYears: input.ageYears,
    relevantMedicalConcerns: input.relevantMedicalConcerns,
    goalDirectionConflict: goalDirection
      ? !goalDirection.consistent
      : false,
    aggressiveGoalRate: goalTimeline?.unusuallyAggressive,
  });
  const estimate = calculateNutritionEstimateWithSafety(
    {
      weightKg: input.currentWeightKg,
      heightCm: input.heightCm,
      ageYears: input.ageYears,
      sexForEstimate: normalizeSexForEstimate(input.gender),
      activityLevel: normalizeActivityLevel(input.profileActivityLevel),
      goalType: input.goalType,
      relevantMedicalConcerns: input.relevantMedicalConcerns,
    },
    safety,
  );

  return { goalTimeline, safety, estimate };
}
