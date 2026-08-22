import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  client: null as unknown,
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => routeState.client,
}));

import {
  DELETE,
  GET,
  POST,
} from "../../app/api/settings/meal-preferences/route";

const userId = "11111111-1111-4111-8111-111111111111";
const foodId = "22222222-2222-4222-8222-222222222222";

function mutationRequest(method: "POST" | "DELETE", overrides = {}) {
  return new Request("http://localhost/api/settings/meal-preferences", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mealType: "breakfast",
      foodId,
      ...overrides,
    }),
  });
}

function authenticatedClient(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    ...overrides,
  };
}

describe("meal preference settings route", () => {
  beforeEach(() => {
    routeState.client = null;
  });

  it("validates the account UUID only after authenticating", async () => {
    const rpc = vi.fn();
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    routeState.client = { auth: { getUser }, rpc };

    const response = await POST(
      mutationRequest("POST", { foodId: "saved-food-slug" }),
    );

    expect(getUser).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: "INVALID_MEAL_PREFERENCE",
      retryable: false,
    });
  });

  it("rejects malformed mutations before consulting account services", async () => {
    const getUser = vi.fn();
    routeState.client = { auth: { getUser } };

    const response = await POST(
      mutationRequest("POST", {
        mealType: "morning_snack",
        unexpected: true,
      }),
    );

    expect(response.status).toBe(422);
    expect(getUser).not.toHaveBeenCalled();
    expect((await response.json()).error).toMatchObject({
      code: "INVALID_MEAL_PREFERENCE",
      retryable: false,
    });
  });

  it.each([
    ["POST", POST, mutationRequest("POST")],
    ["GET", GET, undefined],
    ["DELETE", DELETE, mutationRequest("DELETE")],
  ] as const)(
    "distinguishes an auth outage from a missing session for %s",
    async (_name, handler, request) => {
      const signedOutRequest = request?.clone();
      routeState.client = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { name: "AuthRetryableFetchError", status: 0 },
          }),
        },
      };

      const unavailable = request
        ? await (handler as typeof POST)(request)
        : await (handler as typeof GET)();
      expect(unavailable.status).toBe(503);
      expect((await unavailable.json()).error).toMatchObject({
        code: "SETTINGS_AUTH_UNAVAILABLE",
        retryable: true,
      });

      routeState.client = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { name: "AuthSessionMissingError" },
          }),
        },
      };
      const signedOut = request
        ? await (handler as typeof POST)(signedOutRequest!)
        : await (handler as typeof GET)();
      expect(signedOut.status).toBe(401);
      expect((await signedOut.json()).error).toMatchObject({
        code: "SESSION_EXPIRED",
        retryable: false,
      });
    },
  );

  it("appends exactly one preference through the authenticated RPC", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        meal_type: "breakfast",
        food_id: foodId,
        sort_order: 4,
      },
      error: null,
    });
    const rpc = vi.fn(() => ({ single }));
    routeState.client = authenticatedClient({ rpc });

    const response = await POST(mutationRequest("POST"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("append_meal_preference", {
      selected_meal_type: "breakfast",
      selected_food_id: foodId,
    });
    expect(payload.data).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      mealType: "breakfast",
      foodId,
      sortOrder: 4,
      persisted: true,
    });
  });

  it.each([
    [
      "DUPLICATE_MEAL_PREFERENCE",
      "DUPLICATE_MEAL_PREFERENCE",
      409,
      "already selected",
    ],
    [
      "MEAL_PREFERENCE_LIMIT_REACHED",
      "MEAL_PREFERENCE_LIMIT_REACHED",
      409,
      "maximum of 50",
    ],
    [
      "FOOD_NOT_PLAN_ELIGIBLE",
      "FOOD_NOT_PLAN_ELIGIBLE",
      409,
      "no longer ready",
    ],
    [
      "ONBOARDING_NOT_COMPLETED",
      "ONBOARDING_REQUIRED",
      409,
      "Complete onboarding",
    ],
  ])(
    "maps stable database failure %s without exposing raw SQL",
    async (databaseMessage, publicCode, status, publicMessage) => {
      const single = vi.fn().mockResolvedValue({
        data: null,
        error: { message: databaseMessage, code: "P0001" },
      });
      routeState.client = authenticatedClient({
        rpc: vi.fn(() => ({ single })),
      });

      const response = await POST(mutationRequest("POST"));
      const payload = await response.json();

      expect(response.status).toBe(status);
      expect(payload.error.code).toBe(publicCode);
      expect(payload.error.message).toContain(publicMessage);
      expect(JSON.stringify(payload)).not.toContain("P0001");
    },
  );

  it("does not misclassify a thrown mutation failure as an auth outage", async () => {
    routeState.client = authenticatedClient({
      rpc: vi.fn(() => {
        throw new Error("database connection closed");
      }),
    });

    const response = await POST(mutationRequest("POST"));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "MEAL_PREFERENCE_ADD_UNAVAILABLE",
    );
  });

  it("returns a safe failure when the append RPC returns no row", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: null });
    routeState.client = authenticatedClient({
      rpc: vi.fn(() => ({ single })),
    });

    const response = await POST(mutationRequest("POST"));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "MEAL_PREFERENCE_ADD_UNAVAILABLE",
    );
  });

  it("collapses unknown database details into a public add failure", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: "internal relation meal_preferences_secret failed",
        code: "XX000",
      },
    });
    routeState.client = authenticatedClient({
      rpc: vi.fn(() => ({ single })),
    });

    const response = await POST(mutationRequest("POST"));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("MEAL_PREFERENCE_ADD_UNAVAILABLE");
    expect(JSON.stringify(payload)).not.toContain("meal_preferences_secret");
    expect(JSON.stringify(payload)).not.toContain("XX000");
  });

  it("treats replaying an already-committed delete as idempotent success", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { removed: true, already_absent: true },
      error: null,
    });
    const rpc = vi.fn(() => ({ single }));
    routeState.client = authenticatedClient({ rpc });

    const response = await DELETE(mutationRequest("DELETE"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      removed: true,
      alreadyAbsent: true,
      persisted: true,
    });
    expect(rpc).toHaveBeenCalledWith("remove_meal_preference", {
      selected_meal_type: "breakfast",
      selected_food_id: foodId,
    });
  });

  it("returns the precise safe error when the serialized remove fails", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "private database diagnostic" },
    });
    routeState.client = authenticatedClient({
      rpc: vi.fn(() => ({ single })),
    });

    const response = await DELETE(mutationRequest("DELETE"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatchObject({
      code: "MEAL_PREFERENCE_REMOVE_FAILED",
      retryable: true,
    });
    expect(JSON.stringify(payload)).not.toContain("private database diagnostic");
  });

  it("maps the remove RPC onboarding guard without exposing SQL details", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "ONBOARDING_NOT_COMPLETED", code: "55000" },
    });
    routeState.client = authenticatedClient({
      rpc: vi.fn(() => ({ single })),
    });

    const response = await DELETE(mutationRequest("DELETE"));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("ONBOARDING_REQUIRED");
    expect(JSON.stringify(payload)).not.toContain("55000");
  });

  it("refreshes owner-scoped preferences with their stored food names", async () => {
    const preferenceOrderId = vi.fn().mockResolvedValue({
      data: [
        {
          id: "pref-1",
          meal_type: "breakfast",
          food_id: foodId,
          sort_order: 0,
        },
      ],
      error: null,
    });
    const preferenceOrderSort = vi.fn(() => ({ order: preferenceOrderId }));
    const preferenceOrderMeal = vi.fn(() => ({ order: preferenceOrderSort }));
    const preferenceEq = vi.fn(() => ({ order: preferenceOrderMeal }));
    const preferenceSelect = vi.fn(() => ({ eq: preferenceEq }));
    const foodIn = vi.fn().mockResolvedValue({
      data: [{ id: foodId, english_name: "Apple" }],
      error: null,
    });
    const foodSelect = vi.fn(() => ({ in: foodIn }));
    const from = vi.fn((table: string) =>
      table === "meal_preferences"
        ? { select: preferenceSelect }
        : { select: foodSelect },
    );
    routeState.client = authenticatedClient({ from });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(preferenceEq).toHaveBeenCalledWith("user_id", userId);
    expect((await response.json()).data).toEqual([
      {
        mealType: "breakfast",
        foodId,
        foodName: "Apple",
        sortOrder: 0,
      },
    ]);
  });

  it("fails the refresh safely when stored preference rows cannot be read", async () => {
    const finalOrder = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "private SELECT diagnostic" },
    });
    const orderSort = vi.fn(() => ({ order: finalOrder }));
    const orderMeal = vi.fn(() => ({ order: orderSort }));
    const ownerEq = vi.fn(() => ({ order: orderMeal }));
    routeState.client = authenticatedClient({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: ownerEq })),
      })),
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toMatchObject({
      code: "MEAL_PREFERENCES_LOAD_UNAVAILABLE",
      retryable: true,
    });
    expect(JSON.stringify(payload)).not.toContain("private SELECT diagnostic");
  });
});
