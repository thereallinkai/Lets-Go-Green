import "server-only";
import {
  normalizeMealSlotCheckins,
  type MealCheckinStatus,
  type MealSlot,
} from "@/src/lib/domain";
import type { createSupabaseServerClient } from "@/src/lib/supabase/server";

type CheckinClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type StoredMealCheckin = {
  local_date: string;
  meal_type: MealSlot;
  skip_reason: string | null;
  status: MealCheckinStatus;
};

type StoredDayMealCheckin = Omit<StoredMealCheckin, "local_date"> & {
  id: string;
  items: Array<{
    food: {
      english_name: string;
      id: string;
      verification_status: string;
    } | null;
    id: string;
    sort_order: number;
  }>;
};

export async function loadCheckinRange(
  supabase: CheckinClient,
  userId: string,
  from: string,
  to: string,
) {
  const [daysResult, mealsResult] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("local_date,notes")
      .eq("user_id", userId)
      .gte("local_date", from)
      .lte("local_date", to)
      .order("local_date"),
    supabase
      .from("daily_meal_checkins")
      .select("local_date,meal_type,status,skip_reason")
      .eq("user_id", userId)
      .gte("local_date", from)
      .lte("local_date", to)
      .order("local_date"),
  ]);
  const error = daysResult.error ?? mealsResult.error;
  if (error) return { data: [], error };

  const mealsByDate = new Map<string, StoredMealCheckin[]>();
  for (const meal of (mealsResult.data ?? []) as StoredMealCheckin[]) {
    const rows = mealsByDate.get(meal.local_date) ?? [];
    rows.push(meal);
    mealsByDate.set(meal.local_date, rows);
  }

  return {
    data: (daysResult.data ?? []).map((day) => ({
      localDate: day.local_date,
      notes: day.notes,
      slots: normalizeMealSlotCheckins(
        (mealsByDate.get(day.local_date) ?? []).map((meal) => ({
          mealType: meal.meal_type,
          status: meal.status,
          skipReason: meal.skip_reason,
        })),
      ),
    })),
    error: null,
  };
}

export async function loadDayMealCheckins(
  supabase: CheckinClient,
  userId: string,
  localDate: string,
) {
  const mealsResult = await supabase
    .from("daily_meal_checkins")
    .select(
      "id,meal_type,status,skip_reason,items:daily_meal_items(id,sort_order,food:foods(id,english_name,verification_status))",
    )
    .eq("user_id", userId)
    .eq("local_date", localDate);
  if (mealsResult.error) return { data: [], error: mealsResult.error };

  const mealRows = (mealsResult.data ?? []) as StoredDayMealCheckin[];
  const mealByType = new Map(mealRows.map((meal) => [meal.meal_type, meal]));

  return {
    data: normalizeMealSlotCheckins(
      mealRows.map((meal) => ({
        mealType: meal.meal_type,
        status: meal.status,
        skipReason: meal.skip_reason,
      })),
    ).map((slot) => ({
      ...slot,
      items: [...(mealByType.get(slot.mealType)?.items ?? [])]
        .sort((left, right) => left.sort_order - right.sort_order)
        .flatMap((item) =>
          item.food
            ? [
                {
                  id: item.id,
                  foodId: item.food.id,
                  name: item.food.english_name,
                  verificationStatus: item.food.verification_status,
                },
              ]
            : [],
        ),
    })),
    error: null,
  };
}
