import { describe, expect, it } from "vitest";

import {
  NUTRITION_ESTIMATOR_VERSION,
  assessGoalAwareNutrition,
  calculateNutritionEstimate,
} from "../../src/lib/domain/estimates";
import {
  SAFETY_GUIDANCE_MESSAGE,
  evaluateSafetyContext,
} from "../../src/lib/domain/safety";

describe("safety flags", () => {
  it("returns no flag for an ordinary optional context", () => {
    expect(evaluateSafetyContext({ ageYears: 30 })).toEqual({
      flags: [],
      requiresNonRestrictivePlan: false,
      allowNonRestrictiveTracking: true,
      message: null,
    });
  });

  it("flags every specified safety boundary without diagnosing", () => {
    const result = evaluateSafetyContext({
      ageYears: 17,
      pregnantOrNursing: true,
      eatingDisorderHistory: true,
      relevantMedicalConcerns: true,
      symptoms: ["dizziness", "heart_palpitations"],
    });
    expect(result.flags.map((flag) => flag.code)).toEqual([
      "under_18",
      "pregnant_or_nursing",
      "eating_disorder_history",
      "medical_concern",
      "concerning_symptom",
      "concerning_symptom",
    ]);
    expect(result.requiresNonRestrictivePlan).toBe(true);
    expect(result.allowNonRestrictiveTracking).toBe(true);
    expect(result.message).toBe(SAFETY_GUIDANCE_MESSAGE);
    expect(result.message).not.toMatch(/you have|diagnos/i);
  });

  it("flags an unusually aggressive implied weekly rate", () => {
    expect(
      evaluateSafetyContext({
        aggressiveGoalRate: true,
      }).flags,
    ).toContainEqual({ code: "aggressive_goal_rate" });
  });
});

describe("versioned deterministic nutrition estimates", () => {
  it("withholds goal-adjusted calories for an aggressive stored timeline", () => {
    const result = assessGoalAwareNutrition({
      currentWeightKg: 80,
      startingWeightKg: 80,
      targetWeightKg: 70,
      planStartDate: "2026-01-01",
      targetDate: "2026-02-01",
      goalType: "fat_loss",
      heightCm: 180,
      ageYears: 30,
      gender: "male",
      profileActivityLevel: "moderately_active",
    });

    expect(result.safety.flags).toContainEqual({
      code: "aggressive_goal_rate",
    });
    expect(result.safety.requiresNonRestrictivePlan).toBe(true);
    expect(result.estimate.status).toBe("safety_limited");
    expect(result.estimate.calorieRange).toBeNull();
    expect(result.estimate.maintenanceCalorieRange).not.toBeNull();
    expect(result.estimate.method.activityMultiplierRange).toEqual([1.45, 1.6]);
    expect(result.estimate.method.goalEnergyFactorRange).toBeNull();
    expect(result.goalTimeline?.unusuallyAggressive).toBe(true);
  });

  it.each([
    ["fat_loss", 90],
    ["muscle_gain", 70],
    ["maintenance", 70],
    ["maintenance", 90],
  ] as const)(
    "withholds goal-adjusted calories when %s conflicts with an 80 kg to %s kg target",
    (goalType, targetWeightKg) => {
      const result = assessGoalAwareNutrition({
        currentWeightKg: 80,
        startingWeightKg: 80,
        targetWeightKg,
        planStartDate: "2026-01-01",
        targetDate: "2026-12-31",
        goalType,
        heightCm: 180,
        ageYears: 30,
        gender: "male",
        profileActivityLevel: "moderately_active",
      });

      expect(result.goalTimeline?.conflictsWithGoalType).toBe(true);
      expect(result.safety.flags).toContainEqual({
        code: "goal_direction_conflict",
      });
      expect(result.estimate.status).toBe("safety_limited");
      expect(result.estimate.calorieRange).toBeNull();
      expect(result.estimate.maintenanceCalorieRange).not.toBeNull();
      expect(result.estimate.method.goalEnergyFactorRange).toBeNull();
    },
  );

  it("allows body recomposition estimates in either weight direction", () => {
    const result = assessGoalAwareNutrition({
      currentWeightKg: 80,
      startingWeightKg: 80,
      targetWeightKg: 82,
      planStartDate: "2026-01-01",
      targetDate: "2026-12-31",
      goalType: "body_recomposition",
      heightCm: 180,
      ageYears: 30,
      gender: "male",
      profileActivityLevel: "moderately_active",
    });

    expect(result.goalTimeline?.conflictsWithGoalType).toBe(false);
    expect(result.safety.flags).not.toContainEqual({
      code: "goal_direction_conflict",
    });
    expect(result.estimate.calorieRange).not.toBeNull();
  });

  it("returns transparent calorie and protein ranges", () => {
    const result = calculateNutritionEstimate({
      weightKg: 80,
      heightCm: 180,
      ageYears: 30,
      sexForEstimate: "male",
      activityLevel: "moderate",
      goalType: "fat_loss",
    });
    expect(result.calculatorVersion).toBe(NUTRITION_ESTIMATOR_VERSION);
    expect(result.status).toBe("complete");
    expect(result.calorieRange).toMatchObject({
      unit: "kcal/day",
      precisionLabel: "estimate range",
    });
    expect(result.calorieRange!.minimum).toBeLessThan(
      result.calorieRange!.maximum,
    );
    expect(result.proteinRange).toEqual({
      minimum: 125,
      maximum: 180,
      unit: "g/day",
      precisionLabel: "estimate range",
    });
    expect(result.method).toMatchObject({
      bmrEquation: "Mifflin-St Jeor",
      activityMultiplierRange: [1.45, 1.6],
      goalEnergyFactorRange: [0.8, 0.9],
      proteinGramsPerKilogramRange: [1.6, 2.2],
    });
  });

  it("widens the BMR assumption when equation sex is unspecified", () => {
    const result = calculateNutritionEstimate({
      weightKg: 70,
      heightCm: 170,
      ageYears: 30,
      activityLevel: "light",
      goalType: "maintenance",
      sexForEstimate: "unspecified",
    });
    expect(result.assumptions.some((item) => item.includes("spans both"))).toBe(
      true,
    );
    expect(result.maintenanceCalorieRange!.minimum).toBeLessThan(
      result.maintenanceCalorieRange!.maximum,
    );
  });

  it("returns a partial result instead of inventing calories from missing inputs", () => {
    const result = calculateNutritionEstimate({
      weightKg: 70,
      heightCm: null,
      ageYears: null,
      activityLevel: null,
      goalType: "maintenance",
    });
    expect(result.status).toBe("partial");
    expect(result.calorieRange).toBeNull();
    expect(result.maintenanceCalorieRange).toBeNull();
    expect(result.proteinRange).not.toBeNull();
    expect(result.missingInputs).toEqual([
      "heightCm",
      "ageYears",
      "activityLevel",
    ]);
  });

  it("withholds goal-adjusted calories for safety-sensitive profiles", () => {
    const result = calculateNutritionEstimate({
      weightKg: 70,
      heightCm: 170,
      ageYears: 17,
      sexForEstimate: "female",
      activityLevel: "moderate",
      goalType: "fat_loss",
    });
    expect(result.status).toBe("safety_limited");
    expect(result.calorieRange).toBeNull();
    expect(result.maintenanceCalorieRange).not.toBeNull();
    expect(result.assumptions.some((item) => item.includes("withheld"))).toBe(
      true,
    );
  });

  it("returns an insufficient state when even weight is unavailable", () => {
    const result = calculateNutritionEstimate({
      goalType: "body_recomposition",
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.proteinRange).toBeNull();
    expect(result.missingInputs).toContain("weightKg");
  });
});
