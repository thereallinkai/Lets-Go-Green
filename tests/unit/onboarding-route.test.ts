import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  rpc: vi.fn(),
  authResult: {
    data: { user: { id: "user-1" } as { id: string } | null },
    error: null as {
      name?: string;
      status?: number;
      code?: string;
      message?: string;
    } | null,
  },
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    clientKind: "user",
    auth: {
      getUser: vi.fn().mockImplementation(() => routeState.authResult),
    },
    rpc(
      this: { clientKind: string },
      name: string,
      args: Record<string, unknown>,
    ) {
      if (this.clientKind !== "user") {
        throw new Error("Supabase RPC lost its client context.");
      }
      return routeState.rpc(name, args);
    },
  }),
}));

import { PUT } from "../../app/api/onboarding/route";

function completionBody(overrides: Record<string, unknown> = {}) {
  return {
    meals: {
      breakfast: ["rolled-oats"],
      lunch: ["chicken-breast"],
      dinner: ["broccoli"],
    },
    currentWeight: "97",
    targetWeight: "110",
    unit: "kg",
    goalType: "muscle_gain",
    targetDate: "2099-01-01",
    height: "175",
    activity: "high",
    trainingDays: "4",
    restrictions: "",
    allergies: "",
    timeZone: "America/New_York",
    safety: [],
    notes: "",
    acknowledgedWarnings: [],
    completed: true,
    ...overrides,
  };
}

function completionRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/onboarding", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(completionBody(overrides)),
  });
}

describe("PUT onboarding route", () => {
  beforeEach(() => {
    routeState.rpc.mockReset();
    routeState.authResult = {
      data: { user: { id: "user-1" } },
      error: null,
    };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("maps AuthSessionMissingError to login before completion RPC work", async () => {
    routeState.authResult = {
      data: { user: null },
      error: {
        name: "AuthSessionMissingError",
        status: 400,
        message: "private auth-js detail",
      },
    };

    const response = await PUT(completionRequest());
    const result = await response.json();

    expect(response.status).toBe(401);
    expect(result.error).toMatchObject({
      code: "SESSION_EXPIRED",
      retryable: false,
      action: { href: "/login" },
    });
    expect(JSON.stringify(result)).not.toContain("private auth-js");
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("retries one transient transport failure and completes with the same idempotent arguments", async () => {
    routeState.rpc
      .mockRejectedValueOnce(new Error("transient connection failure"))
      .mockResolvedValueOnce({ data: "goal-1", error: null });

    const response = await PUT(completionRequest());
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toEqual({
      data: { completed: true, goalId: "goal-1" },
      error: null,
    });
    expect(routeState.rpc).toHaveBeenCalledTimes(2);
    expect(routeState.rpc.mock.calls[1]).toEqual(routeState.rpc.mock.calls[0]);
    expect(routeState.rpc).toHaveBeenCalledWith(
      "complete_onboarding_from_slugs",
      expect.objectContaining({
        preference_slugs: [
          {
            foodSlug: "rolled-oats",
            mealType: "breakfast",
            sortOrder: 0,
          },
          {
            foodSlug: "chicken-breast",
            mealType: "lunch",
            sortOrder: 0,
          },
          {
            foodSlug: "broccoli",
            mealType: "dinner",
            sortOrder: 0,
          },
        ],
        current_weight_kg: 97,
        target_weight_kg: 110,
      }),
    );
  });

  it("retries a transient PostgREST connection result", async () => {
    routeState.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST001", message: "Database unavailable." },
      })
      .mockResolvedValueOnce({ data: "goal-2", error: null });

    const response = await PUT(completionRequest());

    expect(response.status).toBe(200);
    expect(routeState.rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      databaseError: {
        code: "42501",
        message: "Authentication is required.",
      },
      status: 401,
      apiCode: "SESSION_EXPIRED",
    },
    {
      databaseError: {
        code: "23514",
        message: "A complete account profile is required before onboarding.",
      },
      status: 409,
      apiCode: "PROFILE_REQUIRED",
    },
    {
      databaseError: {
        code: "23514",
        message:
          "One or more selected foods are unavailable or not eligible for generated plans.",
      },
      status: 409,
      apiCode: "FOOD_SELECTION_CHANGED",
    },
    {
      databaseError: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "meal_preferences_user_id_meal_type_food_id_key"',
      },
      status: 409,
      apiCode: "DUPLICATE_MEAL_FOOD",
    },
    {
      databaseError: {
        code: "PGRST202",
        message: "Could not find the function in the schema cache.",
      },
      status: 503,
      apiCode: "ONBOARDING_DATABASE_OUTDATED",
    },
    {
      databaseError: {
        code: "40001",
        message: "could not serialize access due to concurrent update",
      },
      status: 409,
      apiCode: "ONBOARDING_SAVE_CONFLICT",
    },
    {
      databaseError: {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
      status: 503,
      apiCode: "ONBOARDING_SAVE_TIMEOUT",
    },
  ])(
    "maps $apiCode without exposing database details",
    async ({ databaseError, status, apiCode }) => {
      routeState.rpc.mockResolvedValueOnce({
        data: null,
        error: databaseError,
      });

      const response = await PUT(completionRequest());
      const result = await response.json();

      expect(response.status).toBe(status);
      expect(result.error.code).toBe(apiCode);
      expect(result.error.details).toEqual(expect.any(String));
      expect(result.error.action).toEqual(
        expect.objectContaining({ label: expect.any(String) }),
      );
      expect(result.error.message).not.toContain(databaseError.message);
      expect(routeState.rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps field validation ahead of database persistence", async () => {
    const response = await PUT(
      completionRequest({
        currentWeight: "not-a-weight",
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("INVALID_CURRENT_WEIGHT");
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("requires height before attempting final persistence", async () => {
    const response = await PUT(completionRequest({ height: "" }));
    const result = await response.json();

    expect(response.status).toBe(422);
    expect(result.error).toMatchObject({
      code: "MISSING_HEIGHT",
      action: { href: "/onboarding?step=5" },
    });
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("treats a missing completion result as a failed save", async () => {
    routeState.rpc.mockResolvedValueOnce({ data: null, error: null });

    const response = await PUT(completionRequest());
    const result = await response.json();

    expect(response.status).toBe(500);
    expect(result.error.code).toBe("ONBOARDING_SAVE_FAILED");
  });
});
