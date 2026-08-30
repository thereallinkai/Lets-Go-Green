import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { PRIMARY_MEAL_TYPES } from "@/src/lib/domain/meal-slots";
import { isDevelopmentDemo } from "@/src/lib/env";
import { loadMealPreferenceSummaries } from "@/src/lib/meal-preference-loader";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const preferenceMutationSchema = z
  .object({
    mealType: z.enum(PRIMARY_MEAL_TYPES),
    foodId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
const accountFoodIdSchema = z.string().uuid();

function authUnavailable() {
  return apiError(
    "SETTINGS_AUTH_UNAVAILABLE",
    "Your session could not be checked before changing meal preferences.",
    503,
    {
      details:
        "No meal preference was changed. Check the connection and try again.",
      retryable: true,
      action: { kind: "retry", label: "Try again" },
    },
  );
}

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  return {
    supabase,
    user: data.user,
    authError: error,
    sessionMissing: isAuthSessionMissing(error),
  };
}

function invalidAccountFoodId() {
  return apiError(
    "INVALID_MEAL_PREFERENCE",
    "Choose a valid saved food.",
    422,
    {
      details: "The food identifier was not valid, so no meal preference was changed.",
      retryable: false,
      action: { kind: "edit", label: "Choose another food" },
    },
  );
}

function mutationUnavailable(operation: "add" | "remove") {
  return apiError(
    operation === "add"
      ? "MEAL_PREFERENCE_ADD_UNAVAILABLE"
      : "MEAL_PREFERENCE_REMOVE_UNAVAILABLE",
    operation === "add"
      ? "The food could not be added to this meal."
      : "The food could not be removed from this meal.",
    503,
    {
      details:
        operation === "add"
          ? "No preference was added. Check the connection and try again."
          : "The saved preference is unchanged. Check the connection and try again.",
      retryable: true,
      action: {
        kind: "retry",
        label: operation === "add" ? "Try adding again" : "Try removing again",
      },
    },
  );
}

function preferencesLoadUnavailable() {
  return apiError(
    "MEAL_PREFERENCES_LOAD_UNAVAILABLE",
    "Saved meal preferences could not be refreshed.",
    503,
    {
      details:
        "The preferences currently shown on this page are unchanged. Check the connection and try again.",
      retryable: true,
      action: { kind: "retry", label: "Refresh preferences" },
    },
  );
}

export async function POST(request: Request) {
  const parsed = preferenceMutationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(
      "INVALID_MEAL_PREFERENCE",
      "Choose a supported meal and saved food.",
      422,
      {
        details:
          "Meal preferences support Breakfast, Lunch, or Dinner and one valid saved food at a time.",
        retryable: false,
        action: { kind: "edit", label: "Choose another food" },
      },
    );
  }

  if (isDevelopmentDemo()) {
    return apiSuccess({
      id: `demo-${parsed.data.mealType}-${parsed.data.foodId}`,
      mealType: parsed.data.mealType,
      foodId: parsed.data.foodId,
      sortOrder: 0,
      persisted: false,
    });
  }

  let authentication: Awaited<ReturnType<typeof authenticatedClient>>;
  try {
    authentication = await authenticatedClient();
  } catch {
    return authUnavailable();
  }
  const { supabase, user, authError, sessionMissing } = authentication;
  if (authError && !sessionMissing) return authUnavailable();
  if (!user || sessionMissing) {
    return apiError(
      "SESSION_EXPIRED",
      "Log in again before changing meal preferences.",
      401,
      {
        details: "No meal preference was changed.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      },
    );
  }
  if (!accountFoodIdSchema.safeParse(parsed.data.foodId).success) {
    return invalidAccountFoodId();
  }

  try {
    const { data: preference, error: appendError } = await supabase
      .rpc("append_meal_preference", {
        selected_meal_type: parsed.data.mealType,
        selected_food_id: parsed.data.foodId,
      })
      .single();

    if (appendError) {
      if (appendError.message === "DUPLICATE_MEAL_PREFERENCE") {
        return apiError(
          "DUPLICATE_MEAL_PREFERENCE",
          "That food is already selected for this meal.",
          409,
          {
            details: "No duplicate was created. Refresh the page to see the saved choice.",
            retryable: false,
            action: { kind: "retry", label: "Refresh preferences" },
          },
        );
      }
      if (appendError.message === "MEAL_PREFERENCE_LIMIT_REACHED") {
        return apiError(
          "MEAL_PREFERENCE_LIMIT_REACHED",
          `${parsed.data.mealType[0].toUpperCase()}${parsed.data.mealType.slice(1)} already has the maximum of 50 foods.`,
          409,
          {
            details: "Remove one saved food before adding another. Your existing preferences are unchanged.",
            retryable: false,
            action: { kind: "edit", label: "Remove a food" },
          },
        );
      }
      if (appendError.message === "FOOD_NOT_PLAN_ELIGIBLE") {
        return apiError(
          "FOOD_NOT_PLAN_ELIGIBLE",
          "This food is no longer ready for meal preferences.",
          409,
          {
            details:
              "Its catalog, nutrition, ownership, or safety review changed before the save. No preference was added.",
            retryable: false,
            action: { kind: "edit", label: "Choose another food" },
          },
        );
      }
      if (appendError.message === "ONBOARDING_NOT_COMPLETED") {
        return apiError(
          "ONBOARDING_REQUIRED",
          "Complete onboarding before editing meal preferences.",
          409,
          {
            details:
              "No preference was added. Finish the saved onboarding steps, then return to Settings.",
            retryable: false,
            action: {
              kind: "navigate",
              label: "Continue onboarding",
              href: "/onboarding",
            },
          },
        );
      }
      return mutationUnavailable("add");
    }
    if (!preference) return mutationUnavailable("add");

    return apiSuccess({
      id: preference.id,
      mealType: preference.meal_type,
      foodId: preference.food_id,
      sortOrder: preference.sort_order,
      persisted: true,
    });
  } catch {
    return mutationUnavailable("add");
  }
}

export async function GET() {
  if (isDevelopmentDemo()) return apiSuccess([]);

  let authentication: Awaited<ReturnType<typeof authenticatedClient>>;
  try {
    authentication = await authenticatedClient();
  } catch {
    return authUnavailable();
  }
  const { supabase, user, authError, sessionMissing } = authentication;
  if (authError && !sessionMissing) return authUnavailable();
  if (!user || sessionMissing) {
    return apiError(
      "SESSION_EXPIRED",
      "Log in again to load meal preferences.",
      401,
      {
        details: "The preferences currently shown on this page are unchanged.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      },
    );
  }

  try {
    const result = await loadMealPreferenceSummaries(supabase, user.id);
    if (result.error) return preferencesLoadUnavailable();
    return apiSuccess(result.data);
  } catch {
    return preferencesLoadUnavailable();
  }
}

export async function DELETE(request: Request) {
  const parsed = preferenceMutationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(
      "INVALID_MEAL_PREFERENCE",
      "Choose a saved meal preference to remove.",
      422,
      {
        details:
          "Meal preferences support Breakfast, Lunch, or Dinner and one valid saved food at a time.",
        retryable: false,
        action: { kind: "edit", label: "Review the selection" },
      },
    );
  }

  if (isDevelopmentDemo()) {
    return apiSuccess({
      removed: true,
      mealType: parsed.data.mealType,
      foodId: parsed.data.foodId,
      persisted: false,
    });
  }

  let authentication: Awaited<ReturnType<typeof authenticatedClient>>;
  try {
    authentication = await authenticatedClient();
  } catch {
    return authUnavailable();
  }
  const { supabase, user, authError, sessionMissing } = authentication;
  if (authError && !sessionMissing) return authUnavailable();
  if (!user || sessionMissing) {
    return apiError(
      "SESSION_EXPIRED",
      "Log in again before changing meal preferences.",
      401,
      {
        details: "The saved meal preference is unchanged.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      },
    );
  }
  if (!accountFoodIdSchema.safeParse(parsed.data.foodId).success) {
    return invalidAccountFoodId();
  }

  try {
    const { data: removed, error } = await supabase
      .rpc("remove_meal_preference", {
        selected_meal_type: parsed.data.mealType,
        selected_food_id: parsed.data.foodId,
      })
      .single();
    if (error) {
      if (error.message === "ONBOARDING_NOT_COMPLETED") {
        return apiError(
          "ONBOARDING_REQUIRED",
          "Complete onboarding before editing meal preferences.",
          409,
          {
            details:
              "No preference was removed. Finish the saved onboarding steps, then return to Settings.",
            retryable: false,
            action: {
              kind: "navigate",
              label: "Continue onboarding",
              href: "/onboarding",
            },
          },
        );
      }
      return apiError(
        "MEAL_PREFERENCE_REMOVE_FAILED",
        "The food could not be removed from this meal.",
        500,
        {
          details: "The saved preference is unchanged. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try removing again" },
        },
      );
    }
    if (!removed?.removed) return mutationUnavailable("remove");
    if (removed.already_absent) {
      return apiSuccess({
        removed: true,
        alreadyAbsent: true,
        mealType: parsed.data.mealType,
        foodId: parsed.data.foodId,
        persisted: true,
      });
    }

    return apiSuccess({
      removed: true,
      mealType: parsed.data.mealType,
      foodId: parsed.data.foodId,
      persisted: true,
    });
  } catch {
    return mutationUnavailable("remove");
  }
}
