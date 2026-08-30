import {
  isPrimaryMealType,
  type MealSlotCheckin,
} from "./meal-slots";

export type MealCheckinSummary = {
  completed: number;
  skipped: number;
  notMarked: number;
  marked: number;
  eligible: number;
  percentageMarked: number;
};

export function summarizeMealCheckins(
  checkins: readonly MealSlotCheckin[],
  options: { includeOptionalSnacks?: boolean } = {},
): MealCheckinSummary {
  const eligible = options.includeOptionalSnacks
    ? checkins
    : checkins.filter((checkin) => isPrimaryMealType(checkin.mealType));
  const completed = eligible.filter(
    (checkin) => checkin.status === "completed",
  ).length;
  const skipped = eligible.filter(
    (checkin) => checkin.status === "skipped",
  ).length;
  const notMarked = eligible.filter(
    (checkin) => checkin.status === "not_marked",
  ).length;
  const marked = completed + skipped;

  return {
    completed,
    skipped,
    notMarked,
    marked,
    eligible: eligible.length,
    percentageMarked:
      eligible.length === 0 ? 0 : (marked / eligible.length) * 100,
  };
}
