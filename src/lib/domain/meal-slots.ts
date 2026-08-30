export const PRIMARY_MEAL_TYPES = [
  "breakfast",
  "lunch",
  "dinner",
] as const;

export const SNACK_MEAL_TYPES = [
  "morning_snack",
  "afternoon_snack",
  "evening_snack",
] as const;

export const MEAL_SLOTS = [
  "breakfast",
  "morning_snack",
  "lunch",
  "afternoon_snack",
  "dinner",
  "evening_snack",
] as const;

export const MEAL_CHECKIN_STATUSES = [
  "not_marked",
  "completed",
  "skipped",
] as const;

export type PrimaryMealType = (typeof PRIMARY_MEAL_TYPES)[number];
export type MealSlot = (typeof MEAL_SLOTS)[number];
export type MealCheckinStatus = (typeof MEAL_CHECKIN_STATUSES)[number];

export type MealSlotCheckin = {
  mealType: MealSlot;
  status: MealCheckinStatus;
  skipReason: string | null;
};

export const MEAL_SLOT_LABELS: Readonly<Record<MealSlot, string>> = {
  breakfast: "Breakfast",
  morning_snack: "Morning snack",
  lunch: "Lunch",
  afternoon_snack: "Afternoon snack",
  dinner: "Dinner",
  evening_snack: "Evening snack",
};

export function isPrimaryMealType(
  mealType: MealSlot,
): mealType is PrimaryMealType {
  return (PRIMARY_MEAL_TYPES as readonly MealSlot[]).includes(mealType);
}

export function normalizeMealSlotCheckins(
  checkins: readonly Partial<MealSlotCheckin>[] | null | undefined,
): MealSlotCheckin[] {
  const byMealType = new Map(
    (checkins ?? []).flatMap((checkin) =>
      checkin.mealType && MEAL_SLOTS.includes(checkin.mealType)
        ? [[checkin.mealType, checkin] as const]
        : [],
    ),
  );

  return MEAL_SLOTS.map((mealType) => {
    const checkin = byMealType.get(mealType);
    const status =
      checkin?.status && MEAL_CHECKIN_STATUSES.includes(checkin.status)
        ? checkin.status
        : "not_marked";
    return {
      mealType,
      status,
      skipReason:
        status === "skipped" && typeof checkin?.skipReason === "string"
          ? checkin.skipReason
          : null,
    };
  });
}
