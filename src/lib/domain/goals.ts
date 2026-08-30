import { daysBetweenLocalDates } from "./dates";

export type GoalType =
  | "fat_loss"
  | "muscle_gain"
  | "maintenance"
  | "body_recomposition";

export const GOAL_TYPE_LABELS: Readonly<Record<GoalType, string>> = {
  fat_loss: "Fat loss",
  muscle_gain: "Muscle gain",
  maintenance: "Maintenance",
  body_recomposition: "Body recomposition",
};

/**
 * Converts persisted goal names and the onboarding-facing recomposition name
 * to the canonical domain value without relying on a type assertion.
 */
export function normalizeGoalType(value: string): GoalType | null {
  switch (value) {
    case "fat_loss":
    case "muscle_gain":
    case "maintenance":
    case "body_recomposition":
      return value;
    case "recomposition":
      return "body_recomposition";
    default:
      return null;
  }
}

export type GoalDirection = "loss" | "gain" | "maintenance";

const CONSISTENT_GOAL_DIRECTIONS: Readonly<
  Record<GoalType, readonly GoalDirection[]>
> = {
  fat_loss: ["loss"],
  muscle_gain: ["gain"],
  maintenance: ["maintenance"],
  body_recomposition: ["loss", "gain", "maintenance"],
};

export interface GoalDirectionConsistency {
  direction: GoalDirection;
  consistent: boolean;
}

export interface GoalProgress {
  direction: GoalDirection;
  percentage: number;
  rawPercentage: number;
  changeFromStartKg: number;
  distanceFromTargetKg: number;
  reachedTarget: boolean;
  equalStartAndTarget: boolean;
}

export interface GoalAssessment {
  direction: GoalDirection;
  conflictsWithGoalType: boolean;
  desiredChangeKg: number;
  availableDays: number;
  impliedWeeklyChangeKg: number | null;
  unusuallyAggressive: boolean;
}

function assertWeight(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

export function getGoalDirection(
  startingWeightKg: number,
  targetWeightKg: number,
): GoalDirection {
  assertWeight(startingWeightKg, "Starting weight");
  assertWeight(targetWeightKg, "Target weight");
  if (targetWeightKg < startingWeightKg) return "loss";
  if (targetWeightKg > startingWeightKg) return "gain";
  return "maintenance";
}

export function goalTypeConflictsWithDirection(
  goalType: GoalType,
  direction: GoalDirection,
): boolean {
  return !CONSISTENT_GOAL_DIRECTIONS[goalType].includes(direction);
}

export function assessGoalDirectionConsistency(input: {
  startingWeightKg: number;
  targetWeightKg: number;
  goalType: GoalType;
}): GoalDirectionConsistency {
  const direction = getGoalDirection(
    input.startingWeightKg,
    input.targetWeightKg,
  );
  return {
    direction,
    consistent: !goalTypeConflictsWithDirection(input.goalType, direction),
  };
}

export function calculateGoalProgress(
  startingWeightKg: number,
  currentWeightKg: number,
  targetWeightKg: number,
): GoalProgress {
  assertWeight(startingWeightKg, "Starting weight");
  assertWeight(currentWeightKg, "Current weight");
  assertWeight(targetWeightKg, "Target weight");

  const direction = getGoalDirection(startingWeightKg, targetWeightKg);
  const equalStartAndTarget = direction === "maintenance";
  const desiredChange = targetWeightKg - startingWeightKg;
  const actualChange = currentWeightKg - startingWeightKg;
  const rawPercentage = equalStartAndTarget
    ? currentWeightKg === targetWeightKg
      ? 100
      : 0
    : (actualChange / desiredChange) * 100;
  const percentage = Math.min(100, Math.max(0, rawPercentage));
  const reachedTarget =
    direction === "loss"
      ? currentWeightKg <= targetWeightKg
      : direction === "gain"
        ? currentWeightKg >= targetWeightKg
        : currentWeightKg === targetWeightKg;

  return {
    direction,
    percentage,
    rawPercentage,
    changeFromStartKg: actualChange,
    distanceFromTargetKg: Math.abs(targetWeightKg - currentWeightKg),
    reachedTarget,
    equalStartAndTarget,
  };
}

export function goalProgressPercentage(
  startingWeightKg: number,
  currentWeightKg: number,
  targetWeightKg: number,
): number {
  return calculateGoalProgress(startingWeightKg, currentWeightKg, targetWeightKg)
    .percentage;
}

export function assessGoalTimeline(input: {
  startingWeightKg: number;
  targetWeightKg: number;
  goalType: GoalType;
  startDate: string;
  targetDate: string;
}): GoalAssessment {
  const {
    startingWeightKg,
    targetWeightKg,
    goalType,
    startDate,
    targetDate,
  } = input;
  const consistency = assessGoalDirectionConsistency({
    startingWeightKg,
    targetWeightKg,
    goalType,
  });
  const direction = consistency.direction;
  const availableDays = Math.max(0, daysBetweenLocalDates(startDate, targetDate));
  const desiredChangeKg = targetWeightKg - startingWeightKg;
  const impliedWeeklyChangeKg =
    availableDays > 0 ? (desiredChangeKg / availableDays) * 7 : null;
  const weeklyFraction =
    impliedWeeklyChangeKg === null
      ? 0
      : Math.abs(impliedWeeklyChangeKg) / startingWeightKg;
  const unusuallyAggressive =
    direction === "loss"
      ? weeklyFraction > 0.01
      : direction === "gain"
        ? weeklyFraction > 0.005
        : false;

  return {
    direction,
    conflictsWithGoalType: !consistency.consistent,
    desiredChangeKg,
    availableDays,
    impliedWeeklyChangeKg,
    unusuallyAggressive,
  };
}
