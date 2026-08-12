import { z } from "zod";
import {
  MEAL_CHECKIN_STATUSES,
  MEAL_SLOTS,
  localDateInTimeZone,
  normalizeMealSlotCheckins,
  parseLocalDate,
  type MealSlotCheckin,
} from "@/src/lib/domain";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const statusUpdateSchema = z
  .object({
    kind: z.literal("meal_status"),
    mealType: z.enum(MEAL_SLOTS),
    status: z.enum(MEAL_CHECKIN_STATUSES),
    skipReason: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status !== "skipped" &&
      value.skipReason != null &&
      value.skipReason.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["skipReason"],
        message: "A skip reason may only be saved for a skipped meal.",
      });
    }
  });

const noteUpdateSchema = z
  .object({
    kind: z.literal("note"),
    notes: z.string().max(2_000).nullable(),
  })
  .strict();

const patchSchema = z.discriminatedUnion("kind", [
  statusUpdateSchema,
  noteUpdateSchema,
]);

const legacyUpdateSchema = z
  .object({
    breakfastCompleted: z.boolean(),
    lunchCompleted: z.boolean(),
    dinnerCompleted: z.boolean(),
    notes: z.string().max(2_000).nullable().optional(),
  })
  .strict();

type StoredMealCheckin = {
  id: string;
  meal_type: (typeof MEAL_SLOTS)[number];
  skip_reason: string | null;
  status: (typeof MEAL_CHECKIN_STATUSES)[number];
};

type StoredMealItem = {
  id: string;
  meal_checkin_id: string;
  food:
    | {
        id: string;
        english_name: string;
        verification_status: string;
      }
    | null;
};

function validDate(value: string) {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function toSlotCheckins(
  rows: readonly StoredMealCheckin[] | null | undefined,
): MealSlotCheckin[] {
  return normalizeMealSlotCheckins(
    (rows ?? []).map((row) => ({
      mealType: row.meal_type,
      status: row.status,
      skipReason: row.skip_reason,
    })),
  );
}

async function context(includeTimeZone = false) {
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user || !includeTimeZone) {
    return {
      supabase,
      user: data.user,
      authError,
      timeZone: null,
      profileError: null,
    };
  }
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("time_zone")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return {
    supabase,
    user: data.user,
    authError,
    timeZone: profile?.time_zone ?? null,
    profileError,
  };
}

function authUnavailable() {
  return apiError(
    "CHECKIN_AUTH_UNAVAILABLE",
    "Your session could not be checked before using check-ins.",
    503,
    {
      details: "No check-in data was changed. Check the connection and try again.",
      retryable: true,
      action: { kind: "retry", label: "Try again" },
    },
  );
}

function profileUnavailable() {
  return apiError(
    "CHECKIN_PROFILE_UNAVAILABLE",
    "Your time zone could not be checked before saving the check-in.",
    503,
    {
      details: "No check-in data was changed. Check the connection and try again.",
      retryable: true,
      action: { kind: "retry", label: "Try saving again" },
    },
  );
}

function demoCheckin(date: string) {
  return {
    localDate: date,
    notes: null,
    slots: normalizeMealSlotCheckins([
      { mealType: "breakfast", status: "completed", skipReason: null },
      { mealType: "lunch", status: "completed", skipReason: null },
    ]),
  };
}

export async function GET(
  _request: Request,
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
  if (isDevelopmentDemo()) return apiSuccess(demoCheckin(date));

  try {
    const { supabase, user, authError } = await context();
    if (authError && !isAuthSessionMissing(authError)) {
      return authUnavailable();
    }
    if (!user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to view check-ins.", 401);
    }
    const [dayResult, mealsResult] = await Promise.all([
      supabase
        .from("daily_checkins")
        .select("notes")
        .eq("user_id", user.id)
        .eq("local_date", date)
        .maybeSingle(),
      supabase
        .from("daily_meal_checkins")
        .select("id,meal_type,status,skip_reason")
        .eq("user_id", user.id)
        .eq("local_date", date),
    ]);
    if (dayResult.error || mealsResult.error) {
      return apiError(
        "CHECKIN_LOAD_FAILED",
        "The check-in could not be loaded.",
        500,
      );
    }
    const mealRows = (mealsResult.data ?? []) as StoredMealCheckin[];
    const mealIds = mealRows.map((meal) => meal.id);
    const itemsResult = mealIds.length
      ? await supabase
          .from("daily_meal_items")
          .select(
            "id,meal_checkin_id,food:foods(id,english_name,verification_status)",
          )
          .eq("user_id", user.id)
          .in("meal_checkin_id", mealIds)
          .order("sort_order")
      : { data: [], error: null };
    if (itemsResult.error) {
      return apiError(
        "CHECKIN_LOAD_FAILED",
        "The recorded foods could not be loaded.",
        500,
      );
    }
    const itemRows = (itemsResult.data ?? []) as StoredMealItem[];
    return apiSuccess({
      localDate: date,
      notes: dayResult.data?.notes ?? null,
      slots: toSlotCheckins(mealRows).map((slot) => {
        const storedMeal = mealRows.find(
          (meal) => meal.meal_type === slot.mealType,
        );
        return {
          ...slot,
          items: storedMeal
            ? itemRows
                .filter((item) => item.meal_checkin_id === storedMeal.id)
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
                )
            : [],
        };
      }),
    });
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Check-in services are temporarily unavailable.",
      503,
    );
  }
}

export async function PATCH(
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
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(
      "INVALID_CHECKIN",
      "Send a valid desired meal status or day note.",
      422,
    );
  }
  if (isDevelopmentDemo()) {
    return apiSuccess({ localDate: date, ...parsed.data });
  }

  try {
    const { supabase, user, authError, timeZone, profileError } =
      await context(true);
    if (authError && !isAuthSessionMissing(authError)) {
      return authUnavailable();
    }
    if (!user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to update check-ins.", 401);
    }
    if (profileError) return profileUnavailable();
    if (!timeZone) {
      return apiError(
        "PROFILE_REQUIRED",
        "Complete profile setup before saving check-ins.",
        409,
        {
          details: "A verified profile and time zone are required for local-date records.",
          action: { kind: "navigate", label: "Finish profile setup", href: "/onboarding" },
        },
      );
    }
    if (date > localDateInTimeZone(new Date(), timeZone)) {
      return apiError(
        "FUTURE_CHECKIN_DISABLED",
        "Future meal completion is disabled.",
        409,
      );
    }

    if (parsed.data.kind === "note") {
      const { data, error } = await supabase.rpc("set_daily_checkin_note", {
        checkin_date: date,
        desired_note: parsed.data.notes ?? "",
      });
      if (error) {
        return apiError(
          "CHECKIN_SAVE_FAILED",
          "The check-in note could not be saved.",
          500,
        );
      }
      return apiSuccess({
        localDate: date,
        notes: data?.notes ?? parsed.data.notes,
      });
    }

    const normalizedSkipReason =
      parsed.data.status === "skipped"
        ? parsed.data.skipReason?.trim()
        : undefined;
    const { data, error } = await supabase.rpc("set_daily_meal_checkin", {
      checkin_date: date,
      target_meal_type: parsed.data.mealType,
      desired_status: parsed.data.status,
      ...(normalizedSkipReason
        ? { desired_skip_reason: normalizedSkipReason }
        : {}),
    });
    if (error) {
      return apiError(
        "CHECKIN_SAVE_FAILED",
        "The meal status could not be saved.",
        500,
      );
    }
    return apiSuccess({
      localDate: date,
      mealType: data?.meal_type ?? parsed.data.mealType,
      status: data?.status ?? parsed.data.status,
      skipReason: data?.skip_reason ?? null,
    });
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Check-in services are temporarily unavailable.",
      503,
    );
  }
}

export async function PUT(
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
  const requestBody = await request.json().catch(() => null);
  const parsed = legacyUpdateSchema.safeParse(requestBody);
  if (!parsed.success) {
    return apiError(
      "INVALID_CHECKIN",
      "Send the desired final state for breakfast, lunch, and dinner.",
      422,
    );
  }
  if (isDevelopmentDemo()) {
    return apiSuccess({ localDate: date, ...parsed.data });
  }

  try {
    const { supabase, user, authError, timeZone, profileError } =
      await context(true);
    if (authError && !isAuthSessionMissing(authError)) {
      return authUnavailable();
    }
    if (!user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to update check-ins.", 401);
    }
    if (profileError) return profileUnavailable();
    if (!timeZone) {
      return apiError(
        "PROFILE_REQUIRED",
        "Complete profile setup before saving check-ins.",
        409,
        {
          details: "A verified profile and time zone are required for local-date records.",
          action: { kind: "navigate", label: "Finish profile setup", href: "/onboarding" },
        },
      );
    }
    if (date > localDateInTimeZone(new Date(), timeZone)) {
      return apiError(
        "FUTURE_CHECKIN_DISABLED",
        "Future meal completion is disabled.",
        409,
      );
    }
    const notesWereProvided =
      requestBody !== null &&
      typeof requestBody === "object" &&
      Object.prototype.hasOwnProperty.call(requestBody, "notes");
    const { data, error } = await supabase.rpc("upsert_daily_checkin", {
      checkin_date: date,
      desired_breakfast_completed: parsed.data.breakfastCompleted,
      desired_lunch_completed: parsed.data.lunchCompleted,
      desired_dinner_completed: parsed.data.dinnerCompleted,
      ...(typeof parsed.data.notes === "string"
        ? { checkin_notes: parsed.data.notes }
        : {}),
    });
    if (error) {
      return apiError(
        "CHECKIN_SAVE_FAILED",
        "The check-in could not be saved.",
        500,
      );
    }
    if (notesWereProvided && parsed.data.notes === null) {
      const { error: noteError } = await supabase.rpc(
        "set_daily_checkin_note",
        {
          checkin_date: date,
          desired_note: "",
        },
      );
      if (noteError) {
        return apiError(
          "CHECKIN_SAVE_FAILED",
          "The meal states were saved, but the note could not be cleared.",
          500,
        );
      }
    }
    return apiSuccess(data);
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Check-in services are temporarily unavailable.",
      503,
    );
  }
}
