import { createHash } from "node:crypto";
import { z } from "zod";
import type { Json } from "@/src/types/database";
import {
  calculateNutritionEstimate,
  evaluateSafetyContext,
  filterEligibleFoods,
  localDateInTimeZone,
  resolveProfileAge,
  validateAiPlanDomain,
  validatePlanNutritionRanges,
  type AllowedPlanFood,
  type MeasurementBasis,
  type NutritionRecord,
} from "@/src/lib/domain";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { getAIProviderMode, isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import {
  createPlanProvider,
  type PlanProviderInput,
  type ProviderFood,
} from "@/src/lib/ai/provider";
import { PLAN_PROMPT_VERSION } from "@/src/lib/ai/prompt";
import { decidePlanGenerationReplay } from "@/src/lib/domain/idempotency";
import {
  classifyPlanGenerationFailure,
  type PlanGenerationFailureCode,
} from "@/src/lib/plan-generation-error-taxonomy";

export const runtime = "nodejs";

const schema = z.object({
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9._:-]{8,128}$/),
});

type PlanGenerationReservation = {
  result_state: "reserved" | "replayed" | "rate_limited";
  request_id: string | null;
  request_status: "pending" | "processing" | "succeeded" | "failed" | null;
  plan_id: string | null;
};

function json(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

const demoFoods: ProviderFood[] = [
  ["rolled-oats", "Rolled oats", "dry"],
  ["eggs", "Eggs", "as_sold"],
  ["blueberries", "Blueberries", "raw"],
  ["brown-rice", "Brown rice", "cooked"],
  ["chicken-breast", "Chicken breast", "cooked"],
  ["broccoli", "Broccoli", "cooked"],
  ["fish", "Fish", "cooked"],
  ["potatoes", "Potatoes", "cooked"],
  ["spinach", "Spinach", "cooked"],
].map(([id, name, basis]) => ({
  id,
  name,
  allowedMeasurementBases: [basis as MeasurementBasis],
  minimumGrams: 20,
  maximumGrams: 500,
}));

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_IDEMPOTENCY_KEY", "A valid idempotency key is required.", 422);
  const providerMode = getAIProviderMode();
  if (providerMode === "unavailable") return apiError("AI_UNAVAILABLE", "Plan generation is unavailable.", 503);

  if (isDevelopmentDemo()) {
    const provider = createPlanProvider("mock");
    const plan = await provider.generate({
      safetyIdentifier: "development-demo",
      profile: {
        age: 30,
        currentWeightKg: 80.7,
        startWeightKg: 82,
        targetWeightKg: 76,
        goalType: "fat_loss",
        targetDate: "2026-10-30",
        activityLevel: "moderate",
        trainingDaysPerWeek: 3,
        preferredUnit: "kg",
        timeZone: "America/New_York",
        allergies: [],
        dietaryRestrictions: [],
        safetyRequiresNonRestrictivePlan: false,
      },
      deterministicRanges: {
        energyKcal: { minimum: 2_050, maximum: 2_250 },
        proteinGrams: { minimum: 130, maximum: 155 },
      },
      allowedFoods: demoFoods,
      acknowledgedWarnings: [],
    });
    return apiSuccess({
      planId: "mock-plan-draft",
      status: "generated",
      provider: "mock",
      label: "Mock AI plan — development only",
      plan,
    }, 201);
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  let user: NonNullable<
    Awaited<ReturnType<typeof createSupabaseServerClient>> extends {
      auth: { getUser: () => Promise<{ data: { user: infer User } }> };
    }
      ? User
      : never
  >;
  try {
    supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return planAuthUnavailable();
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to generate a plan.", 401);
    }
    user = auth.user;
  } catch {
    return planAuthUnavailable();
  }
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return apiError(
      "TRUSTED_SERVER_UNAVAILABLE",
      "Plan generation is not configured on this server.",
      503,
    );
  }

  const mode = providerMode === "openai" ? "openai" : "mock";
  const provider = createPlanProvider(mode);
  const reserveGeneration = admin.rpc.bind(admin) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: PlanGenerationReservation[] | null;
    error: { code?: string } | null;
  }>;
  const { data: reservationRows, error: reservationError } =
    await reserveGeneration("reserve_plan_generation", {
      target_user_id: user.id,
      request_idempotency_key: parsed.data.idempotencyKey,
      request_provider: provider.mode,
      request_model: provider.model,
      request_prompt_version: PLAN_PROMPT_VERSION,
    });
  const reservation = reservationRows?.[0];
  if (reservationError || !reservation) {
    return apiError(
      "PLAN_REQUEST_RESERVATION_FAILED",
      "The plan request could not be reserved. Try again.",
      503,
    );
  }
  if (reservation.result_state === "rate_limited") {
    return apiError(
      "PLAN_RATE_LIMITED",
      "Wait a few minutes before generating another plan.",
      429,
    );
  }
  if (reservation.result_state === "replayed") {
    if (!reservation.request_id || !reservation.request_status) {
      return apiError(
        "PLAN_REQUEST_INVALID_STATE",
        "The saved plan request is incomplete. Start a new generation request.",
        500,
      );
    }
    const replay = decidePlanGenerationReplay({
      status: reservation.request_status,
      planId: reservation.plan_id,
    });
    if (replay.action === "return_plan") {
      return apiSuccess({
        requestId: reservation.request_id,
        planId: replay.planId,
        status: "succeeded",
        replayed: true,
      });
    }
    if (replay.action === "wait") {
      return apiSuccess(
        {
          requestId: reservation.request_id,
          planId: null,
          status: reservation.request_status,
          replayed: true,
        },
        202,
      );
    }
    if (replay.action === "retry_with_new_key") {
      return apiError(
        "PLAN_REQUEST_FAILED",
        "That plan request did not finish. Start a new generation request.",
        409,
      );
    }
    return apiError(
      "PLAN_REQUEST_INVALID_STATE",
      "The completed plan request has no saved plan. Start a new generation request.",
      500,
    );
  }
  if (!reservation.request_id) {
    return apiError(
      "PLAN_REQUEST_INVALID_STATE",
      "The plan request was not initialized. Try again.",
      500,
    );
  }
  const generationRequest = { id: reservation.request_id };

  try {
    const [
      profileResult,
      goalResult,
      weightsResult,
      preferencesResult,
      warningsResult,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", user.id).single(),
      supabase.from("goals").select("*").eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("weight_entries").select("*").eq("user_id", user.id).order("local_date", { ascending: true }),
      supabase.from("meal_preferences").select("food_id,meal_type,sort_order").eq("user_id", user.id).order("sort_order"),
      supabase.from("onboarding_warnings").select("warning_code").eq("user_id", user.id),
    ]);

    const profile = profileResult.data;
    const goal = goalResult.data;
    const weights = weightsResult.data ?? [];
    if (
      profileResult.error ||
      goalResult.error ||
      weightsResult.error ||
      preferencesResult.error ||
      warningsResult.error
    ) {
      throw new Error("profile_data_load_failed");
    }
    if (
      !profile ||
      profile.onboarding_status !== "completed" ||
      !goal ||
      weights.length === 0
    ) {
      throw new Error("trusted_profile_incomplete");
    }
    // New onboarding requires height. Older completed profiles can still have
    // NULL here, so fail with a repair path before doing any calculations.
    if (profile.height_cm === null) {
      throw new Error("profile_height_required");
    }

    const foodIds = [...new Set((preferencesResult.data ?? []).map((item) => item.food_id))];
    if (foodIds.length < 3) throw new Error("insufficient_eligible_foods");
    const eligibilityRpc = supabase.rpc.bind(supabase) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: Array<{ food_id: string }> | null;
      error: { code?: string } | null;
    }>;
    const eligibleResult = await eligibilityRpc("plan_eligible_food_ids", {
      candidate_food_ids: foodIds,
    });
    if (eligibleResult.error) throw new Error("catalog_load_failed");
    const centrallyEligibleIds = new Set(
      (eligibleResult.data ?? []).map((row) => row.food_id),
    );
    if (centrallyEligibleIds.size < 3) {
      throw new Error("insufficient_eligible_foods");
    }
    const foodsResult = await supabase
      .from("foods")
      .select(`
        id,
        slug,
        english_name,
        ownership_type,
        verification_status,
        food_nutrition (
          calories,
          carbohydrate_g,
          fat_g,
          fiber_g,
          food_id,
          measurement_basis,
          protein_g,
          reference_quantity,
          reference_unit,
          sodium_mg,
          source_name,
          source_reference,
          verification_status
        ),
        food_allergens (
          allergen:allergens (
            slug,
            aliases
          )
        ),
        food_dietary_restrictions (
          restriction:dietary_restriction_types (
            slug,
            aliases
          )
        )
      `)
      .in("id", [...centrallyEligibleIds]);
    if (foodsResult.error) throw new Error("catalog_load_failed");

    const enrichedFoods = (foodsResult.data ?? []).map((food) => ({
      ...food,
      allergens: food.food_allergens.flatMap(({ allergen }) =>
        allergen ? [allergen.slug, ...allergen.aliases] : [],
      ),
      dietaryRestrictionViolations: food.food_dietary_restrictions.flatMap(
        ({ restriction }) =>
          restriction ? [restriction.slug, ...restriction.aliases] : [],
      ),
    }));
    const eligibility = filterEligibleFoods(enrichedFoods, {
      allergies: profile.allergies,
      dietaryRestrictions: profile.dietary_restrictions,
    });
    const allowedFoodIds = new Set(eligibility.allowed.map((food) => food.id));
    const allowedFoods: ProviderFood[] = eligibility.allowed.flatMap((food) => {
      const bases = food.food_nutrition
        .filter(
          (record) =>
            record.reference_unit === "g" &&
            record.calories !== null &&
            record.protein_g !== null &&
            record.carbohydrate_g !== null &&
            record.fat_g !== null &&
            (
              (food.ownership_type === "catalog" &&
                food.verification_status === "verified" &&
                record.verification_status === "verified") ||
              (food.ownership_type === "private" &&
                food.verification_status === "user_label" &&
                record.verification_status === "user_label")
            ),
        )
        .map((record) => record.measurement_basis);
      const uniqueBases = [...new Set(bases)];
      return uniqueBases.length
        ? [{
            id: food.id,
            name: food.english_name,
            allowedMeasurementBases: uniqueBases,
            minimumGrams: 20,
            maximumGrams: 500,
          }]
        : [];
    });
    if (allowedFoods.length < 3) throw new Error("insufficient_eligible_foods");

    const startWeight = weights.find((entry) => entry.is_onboarding_baseline) ?? weights[0]!;
    const latestWeight = weights[weights.length - 1]!;
    const profileAge = resolveProfileAge(
      profile.date_of_birth,
      profile.age,
      localDateInTimeZone(new Date(), profile.time_zone),
    );
    if (profileAge === null) throw new Error("trusted_profile_incomplete");
    const safety = evaluateSafetyContext({
      ageYears: profileAge,
      relevantMedicalConcerns: Boolean(profile.safety_context),
    });
    const activityMap = {
      sedentary: "sedentary",
      lightly_active: "light",
      moderately_active: "moderate",
      very_active: "very_active",
      extremely_active: "very_active",
    } as const;
    const estimate = calculateNutritionEstimate({
      weightKg: latestWeight.weight_kg,
      heightCm: profile.height_cm,
      ageYears: profileAge,
      sexForEstimate:
        profile.gender === "male" || profile.gender === "female"
          ? profile.gender
          : "unspecified",
      activityLevel: profile.activity_level ? activityMap[profile.activity_level] : null,
      goalType: goal.goal_type,
      relevantMedicalConcerns: safety.requiresNonRestrictivePlan,
    });

    const input: PlanProviderInput = {
      safetyIdentifier: createHash("sha256").update(`lets-go-green:${user.id}`).digest("hex"),
      profile: {
        age: profileAge,
        gender: profile.gender,
        heightCm: profile.height_cm,
        currentWeightKg: latestWeight.weight_kg,
        startWeightKg: startWeight.weight_kg,
        targetWeightKg: goal.target_weight_kg,
        goalType: goal.goal_type,
        targetDate: goal.target_date,
        activityLevel: profile.activity_level ?? "unspecified",
        trainingDaysPerWeek: profile.training_days_per_week ?? 0,
        preferredUnit: profile.preferred_weight_unit,
        timeZone: profile.time_zone,
        allergies: profile.allergies,
        dietaryRestrictions: profile.dietary_restrictions,
        safetyRequiresNonRestrictivePlan: safety.requiresNonRestrictivePlan,
      },
      deterministicRanges: {
        energyKcal: estimate.calorieRange
          ? { minimum: estimate.calorieRange.minimum, maximum: estimate.calorieRange.maximum }
          : null,
        proteinGrams: estimate.proteinRange
          ? { minimum: estimate.proteinRange.minimum, maximum: estimate.proteinRange.maximum }
          : null,
      },
      allowedFoods,
      acknowledgedWarnings: (warningsResult.data ?? []).map((warning) => warning.warning_code),
    };

    const plan = await provider.generate(input);
    const allowedForValidation: AllowedPlanFood[] = enrichedFoods
      .filter((food) => allowedFoodIds.has(food.id))
      .flatMap((food) => {
        const bases = allowedFoods.find((allowed) => allowed.id === food.id)?.allowedMeasurementBases ?? [];
        return bases.length
          ? [{
              id: food.id,
              allowedMeasurementBases: bases,
              allowedUnits: ["g"],
              minimumQuantity: { g: 20 },
              maximumQuantity: { g: 500 },
              allergens: food.allergens,
              dietaryRestrictionViolations: food.dietaryRestrictionViolations,
              verificationStatus: food.verification_status,
            }]
          : [];
      });
    const validated = validateAiPlanDomain(plan, {
      allowedFoods: allowedForValidation,
      profile: {
        allergies: profile.allergies,
        dietaryRestrictions: profile.dietary_restrictions,
      },
      requiresNonRestrictivePlan: safety.requiresNonRestrictivePlan,
    });
    if (!validated.success) throw new Error("provider_output_rejected");
    const trustedNutrition: NutritionRecord[] = enrichedFoods.flatMap((food) =>
      food.food_nutrition.map((record) => ({
        foodId: record.food_id,
        measurementBasis: record.measurement_basis,
        referenceQuantity: record.reference_quantity,
        referenceUnit: record.reference_unit,
        calories: record.calories,
        proteinGrams: record.protein_g,
        carbohydrateGrams: record.carbohydrate_g,
        fatGrams: record.fat_g,
        fiberGrams: record.fiber_g,
        sodiumMilligrams: record.sodium_mg,
        verificationStatus: record.verification_status,
        sourceName: record.source_name ?? undefined,
        sourceReference: record.source_reference ?? undefined,
      })),
    );
    const nutritionValidation = validatePlanNutritionRanges(
      validated.plan,
      trustedNutrition,
      input.deterministicRanges,
    );
    if (!nutritionValidation.valid) {
      throw new Error("provider_output_rejected");
    }

    const inputSnapshot = {
      profile: input.profile,
      deterministicRanges: input.deterministicRanges,
      allowedFoodIds: allowedFoods.map((food) => food.id),
      acknowledgedWarnings: input.acknowledgedWarnings,
      calculatedDailyNutrition: nutritionValidation.days.map((day) => ({
        dayIndex: day.dayIndex,
        totals: day.nutrition.totals,
        pendingNutrients: day.nutrition.pendingNutrients,
      })),
    };
    const { data: planId, error: saveError } = await admin.rpc("save_plan_version", {
      target_user_id: user.id,
      target_goal_id: goal.id,
      plan_provider: provider.mode,
      plan_model: provider.model,
      plan_prompt_version: PLAN_PROMPT_VERSION,
      plan_input_snapshot: json(inputSnapshot),
      plan_output: json(validated.plan),
      generation_request_id: generationRequest.id,
    });
    if (saveError || !planId) throw new Error("plan_persistence_failed");
    return apiSuccess({
      requestId: generationRequest.id,
      planId,
      status: "generated",
      provider: provider.mode,
      label: provider.mode === "mock" ? "Mock AI plan — development only" : "Suggested by AI",
    }, 201);
  } catch (error) {
    const code =
      error instanceof Error &&
      [
        "trusted_profile_incomplete",
        "profile_height_required",
        "profile_data_load_failed",
        "insufficient_eligible_foods",
        "provider_output_rejected",
        "plan_persistence_failed",
        "catalog_load_failed",
      ].includes(error.message)
        ? error.message.toUpperCase()
        : "PLAN_GENERATION_FAILED";
    await admin
      .from("ai_generation_requests")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        sanitized_error_code: code,
      })
      .eq("id", generationRequest.id)
      .eq("user_id", user.id);
    return publicError(
      classifyPlanGenerationFailure(code as PlanGenerationFailureCode),
    );
  }
}

function planAuthUnavailable() {
  return apiError(
    "PLAN_AUTH_UNAVAILABLE",
    "Your session could not be checked before generating a plan.",
    503,
    {
      details:
        "No plan request was started. Check the connection and try again with the same request.",
      retryable: true,
      action: { kind: "retry", label: "Try generating again" },
    },
  );
}
