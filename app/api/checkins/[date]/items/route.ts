import { z } from "zod";
import {
  MEAL_SLOTS,
  localDateInTimeZone,
  parseLocalDate,
} from "@/src/lib/domain";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const bodySchema = z
  .object({
    mealType: z.enum(MEAL_SLOTS),
    foodId: z.string().trim().min(1).max(128),
  })
  .strict();

function validDate(value: string) {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  if (!validDate(date)) {
    return apiError(
      "INVALID_LOCAL_DATE",
      "Use a valid YYYY-MM-DD local date.",
      422,
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(
      "INVALID_MEAL_ITEM",
      "Choose a valid meal slot and food.",
      422,
    );
  }
  if (isDevelopmentDemo()) {
    return apiSuccess(
      {
        id: `demo-${parsed.data.mealType}-${parsed.data.foodId}`,
        localDate: date,
        ...parsed.data,
      },
      201,
    );
  }
  if (!z.string().uuid().safeParse(parsed.data.foodId).success) {
    return apiError(
      "INVALID_MEAL_ITEM",
      "Choose a valid food from the catalog.",
      422,
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "CHECKIN_AUTH_UNAVAILABLE",
        "Your session could not be checked before adding the food.",
        503,
        {
          details: "No food record was changed. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try adding again" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to add a food.", 401);
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("time_zone")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (profileError) {
      return apiError(
        "CHECKIN_PROFILE_UNAVAILABLE",
        "Your time zone could not be checked before adding the food.",
        503,
        {
          details: "No food record was changed. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try adding again" },
        },
      );
    }
    if (!profile?.time_zone) {
      return apiError(
        "PROFILE_REQUIRED",
        "Complete profile setup before recording foods.",
        409,
        {
          details: "A verified profile and time zone are required for local-date records.",
          action: { kind: "navigate", label: "Finish profile setup", href: "/onboarding" },
        },
      );
    }
    const timeZone = profile.time_zone;
    if (date > localDateInTimeZone(new Date(), timeZone)) {
      return apiError(
        "FUTURE_CHECKIN_DISABLED",
        "Foods cannot be recorded for a future date.",
        409,
      );
    }

    const { data, error } = await supabase.rpc("add_daily_meal_item", {
      checkin_date: date,
      target_meal_type: parsed.data.mealType,
      target_food_id: parsed.data.foodId,
    });
    if (error || !data) {
      return apiError(
        "MEAL_ITEM_SAVE_FAILED",
        "The selected food could not be added.",
        500,
      );
    }
    const { data: food } = await supabase
      .from("foods")
      .select("id,english_name,verification_status")
      .eq("id", parsed.data.foodId)
      .maybeSingle();
    return apiSuccess(
      {
        id: data.id,
        localDate: date,
        mealType: parsed.data.mealType,
        food: food ?? {
          id: parsed.data.foodId,
          english_name: "Selected food",
          verification_status: "unavailable",
        },
      },
      201,
    );
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Meal-item services are temporarily unavailable.",
      503,
    );
  }
}
