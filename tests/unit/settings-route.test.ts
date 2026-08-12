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
});
