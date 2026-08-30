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

import { PATCH } from "../../app/api/settings/route";

function profileRequest() {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      section: "profile",
      fullName: "Green Tester",
      preferredWeightUnit: "kg",
      timeZone: "America/New_York",
    }),
  });
}

function goalRequest(goalType: string) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ section: "goal", goalType }),
  });
}

function resolvedQuery(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe("settings route profile persistence", () => {
  beforeEach(() => {
    routeState.client = null;
  });

  it("updates an existing profile without requiring INSERT privilege", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        full_name: "Green Tester",
        preferred_weight_unit: "kg",
        time_zone: "America/New_York",
      },
      error: null,
    });
    const select = vi.fn(() => ({ maybeSingle }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const upsert = vi.fn();
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", user_metadata: {} } },
          error: null,
        }),
        updateUser: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn(() => ({ update, upsert })),
    };

    const response = await PATCH(profileRequest());

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      full_name: "Green Tester",
      preferred_weight_unit: "kg",
      time_zone: "America/New_York",
    });
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns PROFILE_REQUIRED when the verified profile is absent", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateUser = vi.fn();
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", user_metadata: {} } },
          error: null,
        }),
        updateUser,
      },
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({ maybeSingle })),
          })),
        })),
      })),
    };

    const response = await PATCH(profileRequest());

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("PROFILE_REQUIRED");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("distinguishes a missing session from an auth-service outage", async () => {
    const from = vi.fn();
    routeState.client = {
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValueOnce({
            data: { user: null },
            error: { name: "AuthSessionMissingError", status: 400 },
          })
          .mockResolvedValueOnce({
            data: { user: null },
            error: { name: "AuthRetryableFetchError", status: 0 },
          }),
      },
      from,
    };

    const signedOut = await PATCH(profileRequest());
    const unavailable = await PATCH(profileRequest());

    expect(signedOut.status).toBe(401);
    expect((await signedOut.json()).error.code).toBe("SESSION_EXPIRED");
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error).toMatchObject({
      code: "SETTINGS_AUTH_UNAVAILABLE",
      retryable: true,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a goal-type change that conflicts with the saved target", async () => {
    const goalRead = resolvedQuery({
      data: { id: "goal-1", target_weight_kg: 70 },
      error: null,
    });
    const baselineRead = resolvedQuery({
      data: { weight_kg: 80 },
      error: null,
    });
    const goalUpdate = resolvedQuery({ data: null, error: null });
    const update = vi.fn(() => goalUpdate);
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", user_metadata: {} } },
          error: null,
        }),
      },
      from: vi.fn((table: string) =>
        table === "goals"
          ? { select: goalRead.select, update }
          : { select: baselineRead.select },
      ),
    };

    const response = await PATCH(goalRequest("muscle_gain"));
    const result = await response.json();

    expect(response.status).toBe(422);
    expect(result.error).toMatchObject({
      code: "GOAL_DIRECTION_CONFLICT",
      retryable: false,
      action: { href: "/onboarding?step=4" },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("updates a goal type after validating its saved weight direction", async () => {
    const goalRead = resolvedQuery({
      data: { id: "goal-1", target_weight_kg: 70 },
      error: null,
    });
    const baselineRead = resolvedQuery({
      data: { weight_kg: 80 },
      error: null,
    });
    const goalUpdate = resolvedQuery({
      data: {
        id: "goal-1",
        goal_type: "fat_loss",
        status: "active",
        target_weight_kg: 70,
        target_date: "2026-12-31",
      },
      error: null,
    });
    const update = vi.fn(() => goalUpdate);
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", user_metadata: {} } },
          error: null,
        }),
      },
      from: vi.fn((table: string) =>
        table === "goals"
          ? { select: goalRead.select, update }
          : { select: baselineRead.select },
      ),
    };

    const response = await PATCH(goalRequest("fat_loss"));

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ goal_type: "fat_loss" });
    expect(goalUpdate.eq).toHaveBeenCalledWith("id", "goal-1");
    expect(goalUpdate.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(goalUpdate.eq).toHaveBeenCalledWith("status", "active");
  });
});
