import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  developmentDemo: false,
  authThrow: null as Error | null,
  authResult: {
    data: { user: { id: "user-1" } as { id: string } | null },
    error: null as { code?: string; message?: string } | null,
  },
  readResult: {
    data: null as Record<string, unknown> | null,
    error: null as { code?: string; message?: string } | null,
  },
  writeResult: {
    data: { updated_at: "2026-08-09T12:00:00.000Z" } as Record<
      string,
      unknown
    > | null,
    error: null as { code?: string; message?: string } | null,
  },
  from: vi.fn(),
  selectAfterUpsert: vi.fn(),
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => routeState.developmentDemo,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: vi.fn().mockImplementation(() => {
        if (routeState.authThrow) throw routeState.authThrow;
        return routeState.authResult;
      }),
    },
    from: routeState.from,
  }),
}));

import { GET, PATCH } from "../../app/api/onboarding/route";

function validDraft() {
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
  };
}

function patchRequest() {
  return new Request("http://localhost/api/onboarding", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentStep: 4, draft: validDraft() }),
  });
}

describe("onboarding draft session routes", () => {
  beforeEach(() => {
    routeState.developmentDemo = false;
    routeState.authThrow = null;
    routeState.authResult = {
      data: { user: { id: "user-1" } },
      error: null,
    };
    routeState.readResult = { data: null, error: null };
    routeState.writeResult = {
      data: { updated_at: "2026-08-09T12:00:00.000Z" },
      error: null,
    };
    routeState.from.mockReset();
    routeState.selectAfterUpsert.mockReset();
    routeState.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockImplementation(() => routeState.readResult),
        }),
      }),
      upsert: vi.fn().mockReturnValue({
        select: routeState.selectAfterUpsert.mockReturnValue({
          single: vi.fn().mockImplementation(() => routeState.writeResult),
        }),
      }),
    }));
  });

  it.each([
    ["GET", () => GET(), "Try loading again"],
    ["PATCH", () => PATCH(patchRequest()), "Try saving again"],
  ])(
    "returns a retryable auth-service error from %s without calling the database",
    async (_method, invoke, actionLabel) => {
      routeState.authResult = {
        data: { user: null },
        error: { code: "unexpected_failure", message: "private auth detail" },
      };

      const response = await invoke();
      const result = await response.json();

      expect(response.status).toBe(503);
      expect(result.error).toMatchObject({
        code: "AUTH_SERVICE_UNAVAILABLE",
        retryable: true,
        action: { kind: "retry", label: actionLabel },
      });
      expect(result.error.details).toEqual(expect.any(String));
      expect(JSON.stringify(result)).not.toContain("private auth");
      expect(routeState.from).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["GET", () => GET()],
    ["PATCH", () => PATCH(patchRequest())],
  ])("maps a thrown auth lookup in %s to the auth-service envelope", async (
    _method,
    invoke,
  ) => {
    routeState.authThrow = new Error("private auth transport detail");

    const response = await invoke();
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error.code).toBe("AUTH_SERVICE_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("private auth transport");
    expect(routeState.from).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", () => GET(), "resume"],
    ["PATCH", () => PATCH(patchRequest()), "save"],
  ])("keeps an absent %s session distinct", async (_method, invoke, wording) => {
    routeState.authResult = { data: { user: null }, error: null };

    const response = await invoke();
    const result = await response.json();

    expect(response.status).toBe(401);
    expect(result.error).toMatchObject({
      code: "SESSION_EXPIRED",
      retryable: false,
      action: { kind: "navigate", label: "Log in", href: "/login" },
    });
    expect(result.error.message.toLowerCase()).toContain(wording);
    expect(routeState.from).not.toHaveBeenCalled();
  });

  it("returns the server draft timestamp when loading", async () => {
    routeState.readResult = {
      data: {
        current_step: 4,
        validated_data: validDraft(),
        updated_at: "2026-08-09T11:00:00.000Z",
      },
      error: null,
    };

    const response = await GET();
    const result = await response.json();

    expect(result).toMatchObject({
      data: {
        currentStep: 4,
        updatedAt: "2026-08-09T11:00:00.000Z",
      },
      error: null,
    });
  });

  it("returns the committed timestamp after saving", async () => {
    const response = await PATCH(patchRequest());
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toEqual({
      data: { saved: true, updatedAt: "2026-08-09T12:00:00.000Z" },
      error: null,
    });
    expect(routeState.selectAfterUpsert).toHaveBeenCalledWith("updated_at");
  });

  it("keeps demo timestamps explicit", async () => {
    routeState.developmentDemo = true;

    expect(await (await GET()).json()).toEqual({
      data: { currentStep: null, draft: null, updatedAt: null },
      error: null,
    });
    expect(await (await PATCH(patchRequest())).json()).toEqual({
      data: { saved: true, updatedAt: null },
      error: null,
    });
  });
});
