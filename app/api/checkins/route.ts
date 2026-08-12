import { z } from "zod";
import {
  daysBetweenLocalDates,
  normalizeMealSlotCheckins,
  parseLocalDate,
  type MealCheckinStatus,
  type MealSlot,
} from "@/src/lib/domain";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const querySchema = z.object({
  from: z.string(),
  to: z.string(),
});

type StoredMealCheckin = {
  local_date: string;
  meal_type: MealSlot;
  skip_reason: string | null;
  status: MealCheckinStatus;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  if (!parsed.success) {
    return apiError(
      "INVALID_DATE_RANGE",
      "Provide a valid local-date range.",
      422,
    );
  }
  try {
    parseLocalDate(parsed.data.from);
    parseLocalDate(parsed.data.to);
    const span = daysBetweenLocalDates(parsed.data.from, parsed.data.to);
    if (span < 0 || span > 62) throw new RangeError();
  } catch {
    return apiError(
      "INVALID_DATE_RANGE",
      "The date range must be valid and no longer than 63 days.",
      422,
    );
  }

  if (isDevelopmentDemo()) return apiSuccess([]);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "CHECKIN_AUTH_UNAVAILABLE",
        "Your session could not be checked before loading check-ins.",
        503,
        {
          details: "No check-in data was changed. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try loading again" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to view check-ins.", 401);
    }
    const [daysResult, mealsResult] = await Promise.all([
      supabase
        .from("daily_checkins")
        .select("local_date,notes")
        .eq("user_id", auth.user.id)
        .gte("local_date", parsed.data.from)
        .lte("local_date", parsed.data.to)
        .order("local_date"),
      supabase
        .from("daily_meal_checkins")
        .select("local_date,meal_type,status,skip_reason")
        .eq("user_id", auth.user.id)
        .gte("local_date", parsed.data.from)
        .lte("local_date", parsed.data.to)
        .order("local_date"),
    ]);
    if (daysResult.error || mealsResult.error) {
      return apiError(
        "CHECKINS_LOAD_FAILED",
        "The calendar check-ins could not be loaded.",
        500,
      );
    }
    const mealRows = (mealsResult.data ?? []) as StoredMealCheckin[];
    return apiSuccess(
      (daysResult.data ?? []).map((day) => ({
        localDate: day.local_date,
        notes: day.notes,
        slots: normalizeMealSlotCheckins(
          mealRows
            .filter((meal) => meal.local_date === day.local_date)
            .map((meal) => ({
              mealType: meal.meal_type,
              status: meal.status,
              skipReason: meal.skip_reason,
            })),
        ),
      })),
    );
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Calendar services are temporarily unavailable.",
      503,
    );
  }
}
