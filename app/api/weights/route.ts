import { z } from "zod";
import { convertWeight, localDateInTimeZone, parseLocalDate } from "@/src/lib/domain";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import {
  isProtectedBaselineError,
  weightAuthUnavailable,
  weightProfileUnavailable,
} from "@/src/lib/weight-entry-errors";

const entrySchema = z
  .object({
    localDate: z.string(),
    weight: z.number().positive(),
    unit: z.enum(["kg", "lb"]),
  })
  .strict();

async function userContext() {
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  return { supabase, user: data.user, authError };
}

async function datedUserContext() {
  const context = await userContext();
  if (context.authError || !context.user) {
    return { ...context, timeZone: null, profileError: null };
  }
  const { data: profile, error: profileError } = await context.supabase
    .from("profiles")
    .select("time_zone")
    .eq("user_id", context.user.id)
    .maybeSingle();
  return {
    ...context,
    timeZone: profile?.time_zone ?? null,
    profileError,
  };
}

export async function GET(request: Request) {
  if (isDevelopmentDemo()) return apiSuccess([]);
  try {
    const { supabase, user, authError } = await userContext();
    if (authError && !isAuthSessionMissing(authError)) {
      return publicError(weightAuthUnavailable());
    }
    if (!user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to view weight entries.", 401);
    }
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") ?? 90);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 365) {
      return apiError(
        "INVALID_WEIGHT_LIMIT",
        "Choose a whole-number weight-history limit from 1 through 365.",
        422,
      );
    }
    const limit = requestedLimit;
    const { data, error } = await supabase
      .from("weight_entries")
      .select("*")
      .eq("user_id", user.id)
      .order("local_date", { ascending: true })
      .limit(limit);
    if (error) return apiError("WEIGHTS_LOAD_FAILED", "Weight entries could not be loaded.", 500);
    return apiSuccess(data);
  } catch {
    return apiError("SERVICE_UNAVAILABLE", "Weight services are temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  const parsed = entrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_WEIGHT", "Enter a valid positive weight and local date.", 422);
  try {
    parseLocalDate(parsed.data.localDate);
  } catch {
    return apiError("INVALID_LOCAL_DATE", "Use a valid YYYY-MM-DD local date.", 422);
  }
  const weightKg = convertWeight(parsed.data.weight, parsed.data.unit, "kg");
  if (weightKg < 20 || weightKg > 500) {
    return apiError("WEIGHT_OUT_OF_RANGE", "Enter a weight between 20 and 500 kilograms equivalent.", 422);
  }
  if (isDevelopmentDemo()) {
    return apiSuccess({ localDate: parsed.data.localDate, weightKg, sourceDisplayUnit: parsed.data.unit }, 201);
  }

  try {
    const { supabase, user, authError, timeZone, profileError } =
      await datedUserContext();
    if (authError && !isAuthSessionMissing(authError)) {
      return publicError(weightAuthUnavailable());
    }
    if (!user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to save weight entries.", 401);
    }
    if (profileError) return publicError(weightProfileUnavailable());
    if (!timeZone) {
      return apiError(
        "PROFILE_REQUIRED",
        "Complete your profile before saving weight entries.",
        409,
        {
          details: "A saved time zone is required for local-date validation.",
          retryable: false,
          action: { kind: "navigate", label: "Open profile", href: "/profile" },
        },
      );
    }
    if (parsed.data.localDate > localDateInTimeZone(new Date(), timeZone)) {
      return apiError("FUTURE_WEIGHT_DISABLED", "A weight entry cannot use a future local date.", 409);
    }
    const { data, error } = await supabase.rpc("save_weight_entry", {
      entry_date: parsed.data.localDate,
      entry_weight_kg: weightKg,
      entry_source_display_unit: parsed.data.unit,
    });
    if (isProtectedBaselineError(error)) {
      return apiError(
        "BASELINE_WEIGHT_IMMUTABLE",
        "Your onboarding starting weight is protected.",
        409,
        {
          details:
            "Keep the original starting point and add a new reading on another local date.",
          retryable: false,
          action: { kind: "edit", label: "Use another date" },
        },
      );
    }
    if (error) return apiError("WEIGHT_SAVE_FAILED", "The weight entry could not be saved.", 500);
    return apiSuccess(data, 201);
  } catch {
    return apiError("SERVICE_UNAVAILABLE", "Weight services are temporarily unavailable.", 503);
  }
}
