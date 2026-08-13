import { z } from "zod";
import type { Database, Json } from "@/src/types/database";
import { localDateInTimeZone } from "@/src/lib/domain";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import {
  classifyOnboardingCompletionError,
  classifyOnboardingDraftError,
  onboardingTransportError,
} from "@/src/lib/onboarding-error-taxonomy";
import {
  normalizeMealFoodSlugs,
  parseOptionalHeight,
  parseWeightKg,
} from "@/src/lib/onboarding-input";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const mealSelectionSchema = z
  .array(z.string().min(1).max(120))
  .max(50)
  .transform(normalizeMealFoodSlugs);

const mealSchema = z.object({
  breakfast: mealSelectionSchema,
  lunch: mealSelectionSchema,
  dinner: mealSelectionSchema,
});

const draftSchema = z
  .object({
    meals: mealSchema,
    currentWeight: z.string().max(30),
    targetWeight: z.string().max(30),
    unit: z.enum(["kg", "lb"]),
    goalType: z.enum(["fat_loss", "muscle_gain", "maintenance", "recomposition"]),
    targetDate: z.string().max(10),
    height: z.string().max(30),
    activity: z.string().max(40),
    trainingDays: z.string().max(2),
    restrictions: z.string().max(1_000),
    allergies: z.string().max(1_000),
    timeZone: z.string().min(1).max(100),
    safety: z.array(z.string().max(120)).max(10),
    notes: z.string().max(2_000),
    acknowledgedWarnings: z
      .array(
        z.object({
          mealType: z.enum(["breakfast", "lunch", "dinner"]),
          warningCode: z.enum([
            "missing_carbohydrate",
            "missing_protein",
            "missing_vegetable",
          ]),
          contextVersion: z.literal("meal-composition-v1"),
        }),
      )
      .max(8),
  })
  .strict();

const patchSchema = z.object({
  currentStep: z.number().int().min(3).max(6),
  draft: draftSchema,
});

const completionSchema = draftSchema.extend({
  activity: z.enum(["low", "light", "moderate", "high"]),
  trainingDays: z.string().refine((value) => {
    const trainingDays = Number(value);
    return value.trim().length > 0
      && Number.isInteger(trainingDays)
      && trainingDays >= 0
      && trainingDays <= 7;
  }),
  completed: z.literal(true),
});

type CompleteOnboardingFromSlugsArgs =
  Database["public"]["Functions"]["complete_onboarding_from_slugs"]["Args"];
type NullableCompleteOnboardingFromSlugsArgs = Omit<
  CompleteOnboardingFromSlugsArgs,
  "profile_height_cm" | "profile_notes" | "profile_safety_context"
> & {
  profile_height_cm: number | null;
  profile_notes: string | null;
  profile_safety_context: string | null;
};

type OnboardingRpcError = {
  code?: string;
  message?: string;
};

type OnboardingRpcResult = {
  data: string | null;
  error: OnboardingRpcError | null;
};

class AuthLookupUnavailableError extends Error {}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf())
    && date.toISOString().slice(0, 10) === value;
}

async function requireUser() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    return {
      supabase,
      user: data.user,
      authError: error,
      sessionMissing: isAuthSessionMissing(error),
    };
  } catch {
    throw new AuthLookupUnavailableError();
  }
}

function authServiceUnavailable(operation: "load" | "save") {
  const isLoad = operation === "load";
  return apiError(
    "AUTH_SERVICE_UNAVAILABLE",
    "Your account session could not be checked right now.",
    503,
    {
      details: isLoad
        ? "Server-saved onboarding progress was not loaded. Your browser copy is unchanged; check the connection and try again."
        : "The server did not save this change. Your browser copy is unchanged; check the connection and try again.",
      retryable: true,
      action: {
        kind: "retry",
        label: isLoad ? "Try loading again" : "Try saving again",
      },
    },
  );
}

async function completeOnboardingWithRetry(
  rpc: (
    name: string,
    args: CompleteOnboardingFromSlugsArgs,
  ) => Promise<OnboardingRpcResult>,
  args: CompleteOnboardingFromSlugsArgs,
) {
  const invoke = () => rpc("complete_onboarding_from_slugs", args);
  try {
    const firstResult = await invoke();
    if (!/^PGRST00[0-2]$/.test(firstResult.error?.code ?? "")) {
      return firstResult;
    }
    console.warn("complete_onboarding RPC connection retry", {
      code: firstResult.error?.code,
    });
  } catch {
    console.warn("complete_onboarding RPC transport retry");
  }
  return invoke();
}

export async function GET() {
  if (isDevelopmentDemo()) {
    return apiSuccess({ currentStep: null, draft: null, updatedAt: null });
  }
  try {
    const { supabase, user, authError, sessionMissing } = await requireUser();
    if (authError && !sessionMissing) {
      return authServiceUnavailable("load");
    }
    if (sessionMissing || !user) {
      return apiError("SESSION_EXPIRED", "Log in to resume onboarding.", 401, {
        details: "Any browser-saved onboarding information is unchanged.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      });
    }
    const { data, error } = await supabase
      .from("onboarding_drafts")
      .select("current_step,validated_data,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      return publicError(classifyOnboardingDraftError(error, "load"));
    }
    return apiSuccess({
      currentStep: data?.current_step ?? null,
      draft: data?.validated_data ?? null,
      updatedAt: data?.updated_at ?? null,
    });
  } catch (error) {
    if (error instanceof AuthLookupUnavailableError) {
      return authServiceUnavailable("load");
    }
    return publicError(onboardingTransportError("load"));
  }
}

export async function PATCH(request: Request) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("INVALID_DRAFT", "The onboarding draft was not valid.", 422, {
      details: "Review the current step before saving again.",
      retryable: false,
      action: { kind: "edit", label: "Review this step" },
    });
  }
  if (isDevelopmentDemo()) return apiSuccess({ saved: true, updatedAt: null });
  try {
    const { supabase, user, authError, sessionMissing } = await requireUser();
    if (authError && !sessionMissing) {
      return authServiceUnavailable("save");
    }
    if (sessionMissing || !user) {
      return apiError("SESSION_EXPIRED", "Log in to save onboarding progress.", 401, {
        details: "The browser copy of your information is unchanged.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      });
    }
    const { data, error } = await supabase
      .from("onboarding_drafts")
      .upsert({
        user_id: user.id,
        current_step: parsed.data.currentStep,
        validated_data: toJson(parsed.data.draft),
      })
      .select("updated_at")
      .single();
    if (error) {
      return publicError(classifyOnboardingDraftError(error, "save"));
    }
    return apiSuccess({ saved: true, updatedAt: data.updated_at });
  } catch (error) {
    if (error instanceof AuthLookupUnavailableError) {
      return authServiceUnavailable("save");
    }
    return publicError(onboardingTransportError("save"));
  }
}

export async function PUT(request: Request) {
  const parsed = completionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(
      "INVALID_ONBOARDING",
      "Review the required goal and profile details.",
      422,
      {
        details: "Correct the marked fields before completing onboarding.",
        retryable: false,
        action: { kind: "edit", label: "Review onboarding" },
      },
    );
  }
  if (!parsed.data.targetDate) {
    return apiError(
      "TARGET_DATE_REQUIRED",
      "Choose a target date before completing onboarding.",
      422,
      {
        details: "Return to Goal and timeline, then choose today or a future date.",
        retryable: false,
        action: { kind: "edit", label: "Choose target date" },
      },
    );
  }
  const parsedHeight = parseOptionalHeight(parsed.data.height);
  if (!parsedHeight.ok) {
    return apiError(
      "INVALID_HEIGHT",
      "Enter a height from 50 to 300 cm, such as 175 cm or 5 ft 9 in.",
      422,
      {
        details: "Use centimetres or feet and inches in onboarding Step 5.",
        retryable: false,
        action: { kind: "edit", label: "Edit height" },
      },
    );
  }
  if (parsedHeight.heightCm === null) {
    return apiError(
      "MISSING_HEIGHT",
      "Choose your height before completing onboarding.",
      422,
      {
        details: "Return to Step 5 and select a height before saving the final step.",
        retryable: false,
        action: {
          kind: "navigate",
          label: "Choose height",
          href: "/onboarding?step=5",
        },
      },
    );
  }
  const currentWeight = parseWeightKg(
    parsed.data.currentWeight,
    parsed.data.unit,
  );
  if (!currentWeight.ok) {
    return apiError(
      "INVALID_CURRENT_WEIGHT",
      "Enter a current weight from 20 to 500 kg, or the equivalent in pounds.",
      422,
      {
        details: "Return to Goal and timeline and enter a number in the selected unit.",
        retryable: false,
        action: { kind: "edit", label: "Edit current weight" },
      },
    );
  }
  const targetWeight = parseWeightKg(
    parsed.data.targetWeight,
    parsed.data.unit,
  );
  if (!targetWeight.ok) {
    return apiError(
      "INVALID_TARGET_WEIGHT",
      "Enter a target weight from 20 to 500 kg, or the equivalent in pounds.",
      422,
      {
        details: "Return to Goal and timeline and enter a number in the selected unit.",
        retryable: false,
        action: { kind: "edit", label: "Edit target weight" },
      },
    );
  }
  if (isDevelopmentDemo()) return apiSuccess({ completed: true, goalId: "demo-goal" });

  try {
    const { supabase, user, authError, sessionMissing } = await requireUser();
    if (authError && !sessionMissing) {
      return authServiceUnavailable("save");
    }
    if (sessionMissing || !user) {
      return apiError(
        "SESSION_EXPIRED",
        "Log in to complete onboarding.",
        401,
        {
          details: "The current onboarding information is unchanged.",
          retryable: false,
          action: { kind: "navigate", label: "Log in", href: "/login" },
        },
      );
    }

    const preferences = (["breakfast", "lunch", "dinner"] as const).flatMap((mealType) =>
      parsed.data.meals[mealType].map((slug, sortOrder) => ({
        mealType,
        foodSlug: slug,
        sortOrder,
      })),
    );

    const activityMap = {
      low: "sedentary",
      light: "lightly_active",
      moderate: "moderately_active",
      high: "very_active",
    } as const;
    const goalMap = {
      fat_loss: "fat_loss",
      muscle_gain: "muscle_gain",
      maintenance: "maintenance",
      recomposition: "body_recomposition",
    } as const;
    const trainingValue = Number(parsed.data.trainingDays);
    let planStartDate: string;
    try {
      planStartDate = localDateInTimeZone(new Date(), parsed.data.timeZone);
    } catch {
      return apiError(
        "INVALID_TIME_ZONE",
        "Choose a supported time zone before completing onboarding.",
        422,
        {
          details: "Allow automatic time-zone detection or select a valid IANA time zone.",
          retryable: false,
          action: { kind: "edit", label: "Choose time zone" },
        },
      );
    }
    if (!isCalendarDate(parsed.data.targetDate)
      || parsed.data.targetDate < planStartDate) {
      return apiError(
        "INVALID_TARGET_DATE",
        "Choose a target date that is today or later.",
        422,
        {
          details: "Return to Goal and timeline and choose today or a future date.",
          retryable: false,
          action: { kind: "edit", label: "Edit target date" },
        },
      );
    }
    const dietaryRestrictions = parsed.data.restrictions
      ? parsed.data.restrictions.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
    const allergies = parsed.data.allergies
      ? parsed.data.allergies.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
    if (dietaryRestrictions.length > 50 || allergies.length > 50) {
      return apiError(
        "TOO_MANY_RESTRICTIONS",
        "Use no more than 50 comma-separated allergies or dietary restrictions.",
        422,
        {
          details: "Remove duplicates and keep only current dietary restrictions and allergies.",
          retryable: false,
          action: { kind: "edit", label: "Review restrictions" },
        },
      );
    }

    const completeOnboardingArgs = {
      profile_height_cm: parsedHeight.heightCm,
      profile_weight_unit: parsed.data.unit,
      profile_time_zone: parsed.data.timeZone,
      profile_activity_level: activityMap[parsed.data.activity],
      profile_training_days: trainingValue,
      profile_dietary_restrictions: dietaryRestrictions,
      profile_allergies: allergies,
      profile_disliked_foods: [],
      profile_safety_context: parsed.data.safety.join("; ") || null,
      profile_notes: parsed.data.notes || null,
      selected_goal_type: goalMap[parsed.data.goalType],
      current_weight_kg: currentWeight.weightKg,
      target_weight_kg: targetWeight.weightKg,
      plan_start_date: planStartDate,
      target_date: parsed.data.targetDate,
      preference_slugs: toJson(preferences),
      acknowledged_warnings: toJson(parsed.data.acknowledgedWarnings),
    } satisfies NullableCompleteOnboardingFromSlugsArgs;

    // PostgreSQL accepts NULL for these nullable parameters. Supabase CLI
    // 2.109.1 omits those null unions from its generated RPC argument type.
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      name: string,
      args: CompleteOnboardingFromSlugsArgs,
    ) => Promise<OnboardingRpcResult>;
    const { data: goalId, error } = await completeOnboardingWithRetry(
      rpc,
      completeOnboardingArgs as CompleteOnboardingFromSlugsArgs,
    );
    if (error) {
      console.error("complete_onboarding_from_slugs RPC failed", {
        code: error.code,
      });
      return publicError(classifyOnboardingCompletionError(error));
    }
    if (!goalId) {
      return publicError(
        classifyOnboardingCompletionError({ code: "UNEXPECTED_RESULT" }),
      );
    }
    return apiSuccess({ completed: true, goalId });
  } catch (error) {
    if (error instanceof AuthLookupUnavailableError) {
      return authServiceUnavailable("save");
    }
    console.error("complete_onboarding transport unavailable");
    return publicError(onboardingTransportError("complete"));
  }
}
