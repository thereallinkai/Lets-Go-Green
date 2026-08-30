import "server-only";
import { isPrimaryMealType } from "@/src/lib/domain/meal-slots";
import type { createSupabaseServerClient } from "@/src/lib/supabase/server";

type MealPreferenceClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export async function loadMealPreferenceSummaries(
  supabase: MealPreferenceClient,
  userId: string,
) {
  const result = await supabase
    .from("meal_preferences")
    .select("id,meal_type,food_id,sort_order,food:foods(english_name)")
    .eq("user_id", userId)
    .order("meal_type")
    .order("sort_order")
    .order("id");

  if (result.error) return { data: [], error: result.error };

  return {
    data: (result.data ?? []).flatMap((preference) =>
      isPrimaryMealType(preference.meal_type)
        ? [
            {
              mealType: preference.meal_type,
              foodId: preference.food_id,
              foodName: preference.food?.english_name ?? "Unavailable food",
              sortOrder: preference.sort_order,
            },
          ]
        : [],
    ),
    error: null,
  };
}
