import { z } from "zod";
import { parseLocalDate } from "@/src/lib/domain";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ date: string; id: string }>;
  },
) {
  const { date, id } = await params;
  try {
    parseLocalDate(date);
  } catch {
    return apiError(
      "INVALID_LOCAL_DATE",
      "Use a valid YYYY-MM-DD local date.",
      422,
    );
  }
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("INVALID_MEAL_ITEM", "Choose a valid recorded food.", 422);
  }
  if (isDevelopmentDemo()) return apiSuccess({ id, localDate: date });

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "CHECKIN_AUTH_UNAVAILABLE",
        "Your session could not be checked before removing the food.",
        503,
        {
          details: "No food record was changed. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try removing again" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to remove a food.", 401);
    }
    const itemResult = await supabase
      .from("daily_meal_items")
      .select("id,meal_checkin_id")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (itemResult.error) {
      return apiError(
        "MEAL_ITEM_DELETE_FAILED",
        "The recorded food could not be checked before removal.",
        500,
      );
    }
    if (!itemResult.data) {
      return apiError(
        "MEAL_ITEM_NOT_FOUND",
        "That recorded food was not found for this date.",
        404,
      );
    }
    const checkinResult = await supabase
      .from("daily_meal_checkins")
      .select("id")
      .eq("id", itemResult.data.meal_checkin_id)
      .eq("user_id", auth.user.id)
      .eq("local_date", date)
      .maybeSingle();
    if (checkinResult.error) {
      return apiError(
        "MEAL_ITEM_DELETE_FAILED",
        "The recorded food date could not be checked before removal.",
        500,
      );
    }
    if (!checkinResult.data) {
      return apiError(
        "MEAL_ITEM_NOT_FOUND",
        "That recorded food was not found for this date.",
        404,
      );
    }
    const { data, error } = await supabase.rpc("delete_daily_meal_item", {
      target_item_id: id,
    });
    if (error) {
      return apiError(
        "MEAL_ITEM_DELETE_FAILED",
        "The recorded food could not be removed.",
        500,
      );
    }
    if (!data) {
      return apiError(
        "MEAL_ITEM_NOT_FOUND",
        "That recorded food was not found.",
        404,
      );
    }
    return apiSuccess({ id: data });
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Meal-item services are temporarily unavailable.",
      503,
    );
  }
}
