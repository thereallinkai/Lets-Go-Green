import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isValidIanaTimeZone } from "@/src/lib/domain";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const profileSchema = z
  .object({
    section: z.literal("profile"),
    fullName: z.string().trim().min(1).max(120),
    preferredWeightUnit: z.enum(["kg", "lb"]),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidIanaTimeZone),
  })
  .strict();

const goalSchema = z
  .object({
    section: z.literal("goal"),
    goalType: z.enum([
      "fat_loss",
      "muscle_gain",
      "maintenance",
      "body_recomposition",
    ]),
  })
  .strict();

const preferenceItemSchema = z.string().trim().min(1).max(120);

const preferencesSchema = z
  .object({
    section: z.literal("preferences"),
    allergies: z.array(preferenceItemSchema).max(50),
    dietaryRestrictions: z.array(preferenceItemSchema).max(50),
    dislikedFoods: z.array(preferenceItemSchema).max(100),
    trainingDaysPerWeek: z.number().int().min(0).max(7).nullable(),
    safetyContext: z.string().trim().max(4000),
  })
  .strict();

const settingsUpdateSchema = z.discriminatedUnion("section", [
  profileSchema,
  goalSchema,
  preferencesSchema,
]);

function uniqueItems(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLocaleLowerCase("en-US");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function PATCH(request: Request) {
  const parsed = settingsUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(
      "INVALID_SETTINGS",
      "Review the settings fields and try again.",
      422,
    );
  }

  if (isDevelopmentDemo()) {
    return apiSuccess({
      saved: true,
      persisted: false,
      section: parsed.data.section,
    });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "SETTINGS_AUTH_UNAVAILABLE",
        "Your session could not be checked before saving settings.",
        503,
        {
          details: "No settings were changed. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try saving again" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError(
        "SESSION_EXPIRED",
        "Log in again before saving settings.",
        401,
      );
    }

    if (parsed.data.section === "profile") {
      const { data: profile, error } = await supabase
        .from("profiles")
        .update({
          full_name: parsed.data.fullName,
          preferred_weight_unit: parsed.data.preferredWeightUnit,
          time_zone: parsed.data.timeZone,
        })
        .eq("user_id", auth.user.id)
        .select("full_name,preferred_weight_unit,time_zone")
        .maybeSingle();
      if (error) {
        return apiError(
          "PROFILE_SAVE_FAILED",
          "Profile settings could not be saved.",
          500,
        );
      }
      if (!profile) {
        return apiError(
          "PROFILE_REQUIRED",
          "Complete profile setup before saving profile settings.",
          409,
        );
      }

      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          ...auth.user.user_metadata,
          full_name: parsed.data.fullName,
        },
      });

      return apiSuccess({
        saved: true,
        persisted: true,
        section: "profile" as const,
        profile,
        displayMetadataUpdated: !metadataError,
      });
    }

    if (parsed.data.section === "goal") {
      const { data: goal, error } = await supabase
        .from("goals")
        .update({ goal_type: parsed.data.goalType })
        .eq("user_id", auth.user.id)
        .eq("status", "active")
        .select("id,goal_type,status,target_weight_kg,target_date")
        .maybeSingle();
      if (error) {
        return apiError(
          "GOAL_SAVE_FAILED",
          "The active goal could not be updated.",
          500,
        );
      }
      if (!goal) {
        return apiError(
          "ACTIVE_GOAL_REQUIRED",
          "There is no active goal to update.",
          409,
        );
      }
      return apiSuccess({
        saved: true,
        persisted: true,
        section: "goal" as const,
        goal,
      });
    }

    if (parsed.data.section === "preferences") {
      const { data: profile, error } = await supabase
        .from("profiles")
        .update({
          allergies: uniqueItems(parsed.data.allergies),
          dietary_restrictions: uniqueItems(
            parsed.data.dietaryRestrictions,
          ),
          disliked_foods: uniqueItems(parsed.data.dislikedFoods),
          training_days_per_week: parsed.data.trainingDaysPerWeek,
          safety_context: parsed.data.safetyContext || null,
        })
        .eq("user_id", auth.user.id)
        .select(
          "allergies,dietary_restrictions,disliked_foods,training_days_per_week,safety_context",
        )
        .maybeSingle();
      if (error) {
        return apiError(
          "PREFERENCES_SAVE_FAILED",
          "Preferences could not be saved.",
          500,
        );
      }
      if (!profile) {
        return apiError(
          "PROFILE_REQUIRED",
          "Create a profile before saving preferences.",
          409,
        );
      }
      return apiSuccess({
        saved: true,
        persisted: true,
        section: "preferences" as const,
        profile,
      });
    }

    return apiError("INVALID_SETTINGS", "That settings section is not supported.", 422);
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Settings services are temporarily unavailable.",
      503,
    );
  }
}
