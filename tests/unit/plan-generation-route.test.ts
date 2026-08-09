import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  providerGenerate: vi.fn(),
  requestUpdate: vi.fn(),
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
          data: {
            user_id: "user-1",
            onboarding_status: "completed",
            height_cm: null,
          },
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
                data: { id: "goal-1" },
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
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  };
}

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") return profileQuery();
      if (table === "goals") return goalQuery();
      if (table === "weight_entries") {
        return orderedQuery([
          {
            id: "weight-1",
            weight_kg: 80,
            is_onboarding_baseline: true,
          },
        ]);
      }
      if (table === "meal_preferences") return orderedQuery([]);
      if (table === "onboarding_warnings") return warningsQuery();
      throw new Error(`Unexpected test table: ${table}`);
    }),
    rpc: vi.fn(),
  }),
}));

import { POST } from "../../app/api/plans/generate/route";

describe("POST plan generation route", () => {
  beforeEach(() => {
    routeState.providerGenerate.mockReset();
    routeState.requestUpdate.mockReset();
    routeState.requestUpdate.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
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
  });
});
