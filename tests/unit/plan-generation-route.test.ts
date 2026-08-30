import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  authResult: {
    data: { user: { id: "user-1" } as { id: string } | null },
    error: null as unknown,
  },
  providerGenerate: vi.fn(),
  requestEq: vi.fn(),
  requestIs: vi.fn(),
  requestUpdate: vi.fn(),
  serverError: false,
  profileData: null as Record<string, unknown> | null,
  goalData: null as Record<string, unknown> | null,
  weightsData: [] as Array<Record<string, unknown>>,
  preferencesData: [] as Array<Record<string, unknown>>,
  warningsData: [] as Array<Record<string, unknown>>,
  eligibleFoodIds: [] as string[],
  foodsData: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/src/lib/env", () => ({
  getAIProviderMode: () => "mock",
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/ai/provider", () => ({
  createPlanProvider: () => ({
    mode: "mock",
    model: "deterministic-test-model",
    generate: routeState.providerGenerate,
  }),
}));

vi.mock("@/src/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: vi.fn().mockResolvedValue({
      data: [
        {
          result_state: "reserved",
          request_id: "request-1",
          request_status: "pending",
          plan_id: null,
        },
      ],
      error: null,
    }),
    from: vi.fn().mockReturnValue({
      update: routeState.requestUpdate,
    }),
  }),
}));

function profileQuery() {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: routeState.profileData,
          error: null,
        }),
      }),
    }),
  };
}

function goalQuery() {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: routeState.goalData,
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

function orderedQuery(data: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  };
}

function warningsQuery() {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: routeState.warningsData,
        error: null,
      }),
    }),
  };
}

function foodsQuery() {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: routeState.foodsData, error: null }),
    }),
  };
}

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    if (routeState.serverError) throw new Error("private server failure");
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue(routeState.authResult),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") return profileQuery();
        if (table === "goals") return goalQuery();
        if (table === "weight_entries") {
          return orderedQuery(routeState.weightsData);
        }
        if (table === "meal_preferences") {
          return orderedQuery(routeState.preferencesData);
        }
        if (table === "onboarding_warnings") return warningsQuery();
        if (table === "foods") return foodsQuery();
        throw new Error(`Unexpected test table: ${table}`);
      }),
      rpc: vi.fn().mockImplementation(async (name: string) => {
        if (name !== "plan_eligible_food_ids") {
          throw new Error(`Unexpected test RPC: ${name}`);
        }
        return {
          data: routeState.eligibleFoodIds.map((foodId) => ({
            food_id: foodId,
          })),
          error: null,
        };
      }),
    };
  },
}));

import { POST } from "../../app/api/plans/generate/route";

describe("POST plan generation route", () => {
  beforeEach(() => {
    routeState.authResult = {
      data: { user: { id: "user-1" } },
      error: null,
    };
    routeState.providerGenerate.mockReset();
    routeState.requestEq.mockReset();
    routeState.requestIs.mockReset();
    routeState.requestUpdate.mockReset();
    routeState.serverError = false;
    routeState.profileData = {
      user_id: "user-1",
      onboarding_status: "completed",
      height_cm: null,
    };
    routeState.goalData = { id: "goal-1" };
    routeState.weightsData = [
      {
        id: "weight-1",
        weight_kg: 80,
        is_onboarding_baseline: true,
      },
    ];
    routeState.preferencesData = [];
    routeState.warningsData = [];
    routeState.eligibleFoodIds = [];
    routeState.foodsData = [];
    const requestUpdateQuery = {
      eq: routeState.requestEq,
      is: routeState.requestIs,
    };
    routeState.requestEq.mockReturnValue(requestUpdateQuery);
    routeState.requestIs.mockResolvedValue({ error: null });
    routeState.requestUpdate.mockReturnValue(requestUpdateQuery);
  });

  it("blocks a legacy completed profile with no height before generation", async () => {
    const response = await POST(
      new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "height-test-1" }),
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(422);
    expect(result.error).toMatchObject({
      code: "PROFILE_HEIGHT_REQUIRED",
      action: { href: "/onboarding?step=5" },
    });
    expect(routeState.providerGenerate).not.toHaveBeenCalled();
    expect(routeState.requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        sanitized_error_code: "PROFILE_HEIGHT_REQUIRED",
      }),
    );
    expect(routeState.requestEq).toHaveBeenCalledWith("status", "processing");
    expect(routeState.requestIs).toHaveBeenCalledWith("plan_id", null);
  });

  it("returns a signed-out error for Supabase's missing-session result", async () => {
    routeState.authResult = {
      data: { user: null },
      error: { name: "AuthSessionMissingError", status: 400 },
    };

    const response = await POST(
      new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "missing-session-1" }),
      }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("SESSION_EXPIRED");
  });

  it("rejects a contradictory stored goal before catalog or provider work", async () => {
    routeState.profileData = {
      activity_level: "moderately_active",
      age: 30,
      allergies: [],
      date_of_birth: null,
      dietary_restrictions: [],
      gender: "male",
      height_cm: 180,
      onboarding_status: "completed",
      preferred_weight_unit: "kg",
      safety_context: null,
      time_zone: "UTC",
      training_days_per_week: 3,
    };
    routeState.goalData = {
      id: "goal-1",
      goal_type: "muscle_gain",
      plan_start_date: "2026-01-01",
      target_date: "2026-12-31",
      target_weight_kg: 70,
    };
    routeState.weightsData = [
      { weight_kg: 80, is_onboarding_baseline: true },
    ];

    const response = await POST(
      new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "goal-conflict-1" }),
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(409);
    expect(result.error).toMatchObject({
      code: "GOAL_DIRECTION_CONFLICT",
      retryable: false,
      action: { href: "/onboarding?step=4" },
    });
    expect(routeState.providerGenerate).not.toHaveBeenCalled();
    expect(routeState.requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        sanitized_error_code: "GOAL_DIRECTION_CONFLICT",
      }),
    );
  });

  it.each(["auth", "client"])(
    "returns a structured retryable error for a %s service failure",
    async (kind) => {
      if (kind === "client") {
        routeState.serverError = true;
      } else {
        routeState.authResult = {
          data: { user: null },
          error: { name: "AuthRetryableFetchError", status: 0 },
        };
      }

      const response = await POST(
        new Request("http://localhost/api/plans/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: `service-failure-${kind}` }),
        }),
      );
      const result = await response.json();

      expect(response.status).toBe(503);
      expect(result.error).toMatchObject({
        code: "PLAN_AUTH_UNAVAILABLE",
        retryable: true,
      });
      expect(JSON.stringify(result)).not.toContain("private");
    },
  );

  it("requires a non-restrictive plan for an aggressive stored goal timeline", async () => {
    routeState.profileData = {
      user_id: "user-1",
      activity_level: "moderately_active",
      age: 30,
      allergies: [],
      date_of_birth: null,
      dietary_restrictions: [],
      gender: "male",
      height_cm: 180,
      onboarding_status: "completed",
      preferred_weight_unit: "kg",
      safety_context: null,
      time_zone: "UTC",
      training_days_per_week: 3,
    };
    routeState.goalData = {
      id: "goal-1",
      goal_type: "fat_loss",
      plan_start_date: "2026-01-01",
      target_date: "2026-02-01",
      target_weight_kg: 70,
    };
    routeState.weightsData = [
      {
        weight_kg: 80,
        is_onboarding_baseline: true,
      },
    ];
    routeState.preferencesData = [
      { food_id: "food-1", meal_type: "breakfast", sort_order: 0 },
      { food_id: "food-2", meal_type: "lunch", sort_order: 0 },
      { food_id: "food-3", meal_type: "dinner", sort_order: 0 },
    ];
    routeState.eligibleFoodIds = ["food-1", "food-2", "food-3"];
    routeState.foodsData = ["food-1", "food-2", "food-3"].map(
      (foodId) => ({
        id: foodId,
        slug: foodId,
        english_name: foodId,
        ownership_type: "catalog",
        verification_status: "verified",
        food_allergens: [],
        food_dietary_restrictions: [],
        food_nutrition: [
          {
            calories: 100,
            carbohydrate_g: 10,
            fat_g: 2,
            fiber_g: 1,
            food_id: foodId,
            measurement_basis: "as_sold",
            protein_g: 10,
            reference_quantity: 100,
            reference_unit: "g",
            sodium_mg: 20,
            source_name: "test",
            source_reference: `test:${foodId}`,
            verification_status: "verified",
          },
        ],
      }),
    );
    routeState.providerGenerate.mockRejectedValue(
      new Error("stop after inspecting trusted provider input"),
    );

    const response = await POST(
      new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "aggressive-goal-rate-1" }),
      }),
    );

    expect(response.status).toBe(500);
    expect(routeState.providerGenerate).toHaveBeenCalledOnce();
    expect(routeState.providerGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          goalType: "fat_loss",
          safetyRequiresNonRestrictivePlan: true,
        }),
        deterministicRanges: expect.objectContaining({
          energyKcal: null,
        }),
      }),
    );
  });
});
