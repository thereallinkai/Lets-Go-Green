import { describe, expect, it } from "vitest";

import {
  assessGoalDirectionConsistency,
  assessGoalTimeline,
  calculateGoalProgress,
  getGoalDirection,
  goalProgressPercentage,
  goalTypeConflictsWithDirection,
  normalizeGoalType,
} from "../../src/lib/domain/goals";

describe("goal calculations", () => {
  it("calculates progress toward a loss goal in the correct direction", () => {
    expect(calculateGoalProgress(100, 90, 80)).toMatchObject({
      direction: "loss",
      percentage: 50,
      changeFromStartKg: -10,
      distanceFromTargetKg: 10,
      reachedTarget: false,
    });
  });

  it("calculates progress toward a gain goal in the correct direction", () => {
    expect(goalProgressPercentage(60, 65, 70)).toBe(50);
    expect(getGoalDirection(60, 70)).toBe("gain");
  });

  it("clamps movement away from the target to zero", () => {
    const result = calculateGoalProgress(100, 105, 80);
    expect(result.rawPercentage).toBe(-25);
    expect(result.percentage).toBe(0);
  });

  it("clamps progress beyond the target while retaining reached state", () => {
    expect(calculateGoalProgress(100, 75, 80)).toMatchObject({
      percentage: 100,
      reachedTarget: true,
    });
  });

  it("handles an equal starting and target weight without division by zero", () => {
    expect(calculateGoalProgress(70, 70, 70)).toMatchObject({
      direction: "maintenance",
      percentage: 100,
      rawPercentage: 100,
      equalStartAndTarget: true,
    });
    expect(calculateGoalProgress(70, 71, 70).percentage).toBe(0);
  });

  it("detects directions that conflict with the selected goal type", () => {
    expect(goalTypeConflictsWithDirection("fat_loss", "gain")).toBe(true);
    expect(goalTypeConflictsWithDirection("muscle_gain", "gain")).toBe(false);
    expect(goalTypeConflictsWithDirection("maintenance", "loss")).toBe(true);
    expect(goalTypeConflictsWithDirection("body_recomposition", "loss")).toBe(
      false,
    );
  });

  it.each([
    ["fat_loss", 80, 70, "loss", true],
    ["fat_loss", 80, 90, "gain", false],
    ["fat_loss", 80, 80, "maintenance", false],
    ["muscle_gain", 80, 90, "gain", true],
    ["muscle_gain", 80, 70, "loss", false],
    ["muscle_gain", 80, 80, "maintenance", false],
    ["maintenance", 80, 80, "maintenance", true],
    ["maintenance", 80, 70, "loss", false],
    ["maintenance", 80, 90, "gain", false],
    ["body_recomposition", 80, 70, "loss", true],
    ["body_recomposition", 80, 80, "maintenance", true],
    ["body_recomposition", 80, 90, "gain", true],
  ] as const)(
    "assesses %s from %s kg to %s kg as %s with consistency %s",
    (goalType, startingWeightKg, targetWeightKg, direction, consistent) => {
      expect(
        assessGoalDirectionConsistency({
          startingWeightKg,
          targetWeightKg,
          goalType,
        }),
      ).toEqual({ direction, consistent });
    },
  );

  it("normalizes the onboarding recomposition name without accepting unknown goals", () => {
    expect(normalizeGoalType("recomposition")).toBe("body_recomposition");
    expect(normalizeGoalType("body_recomposition")).toBe(
      "body_recomposition",
    );
    expect(normalizeGoalType("rapid_weight_loss")).toBeNull();
    expect(normalizeGoalType("toString")).toBeNull();
  });

  it("calculates an estimated weekly rate from local calendar dates", () => {
    const result = assessGoalTimeline({
      startingWeightKg: 80,
      targetWeightKg: 76,
      goalType: "fat_loss",
      startDate: "2026-01-01",
      targetDate: "2026-02-26",
    });
    expect(result.availableDays).toBe(56);
    expect(result.impliedWeeklyChangeKg).toBeCloseTo(-0.5);
    expect(result.unusuallyAggressive).toBe(false);
    expect(result.conflictsWithGoalType).toBe(false);
  });

  it("flags unusually aggressive rates without changing the goal", () => {
    const result = assessGoalTimeline({
      startingWeightKg: 80,
      targetWeightKg: 70,
      goalType: "fat_loss",
      startDate: "2026-01-01",
      targetDate: "2026-02-01",
    });
    expect(result.unusuallyAggressive).toBe(true);
    expect(result.desiredChangeKg).toBe(-10);
  });
});
