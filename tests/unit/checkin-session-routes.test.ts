import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  authResult: {
    data: { user: null as { id: string } | null },
    error: null as { name?: string; status?: number } | null,
  },
  profileResult: {
    data: { time_zone: "America/New_York" } as {
      time_zone: string;
    } | null,
    error: null as { code?: string } | null,
  },
  rpc: vi.fn(),
}));

function profileQueryBuilder() {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => routeState.profileResult),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => routeState.authResult },
    from: () => profileQueryBuilder(),
    rpc: routeState.rpc,
  }),
}));

import { GET as GET_CHECKINS } from "../../app/api/checkins/route";
import { PATCH as PATCH_CHECKIN } from "../../app/api/checkins/[date]/route";
import { POST as POST_ITEM } from "../../app/api/checkins/[date]/items/route";

const routeParams = {
  params: Promise.resolve({ date: "2026-08-12" }),
};

describe("check-in session and profile failures", () => {
  beforeEach(() => {
    routeState.authResult.data.user = null;
    routeState.authResult.error = null;
    routeState.profileResult.data = { time_zone: "America/New_York" };
    routeState.profileResult.error = null;
    routeState.rpc.mockReset();
  });

  it("reports an auth outage instead of pretending the session expired", async () => {
    routeState.authResult.error = {
      name: "AuthRetryableFetchError",
      status: 0,
    };

    const responses = await Promise.all([
      GET_CHECKINS(
        new Request(
          "http://localhost/api/checkins?from=2026-08-01&to=2026-08-12",
        ),
      ),
      PATCH_CHECKIN(
        new Request("http://localhost/api/checkins/2026-08-12", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "meal_status",
            mealType: "breakfast",
            status: "completed",
          }),
        }),
        routeParams,
      ),
      POST_ITEM(
        new Request("http://localhost/api/checkins/2026-08-12/items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mealType: "breakfast",
            foodId: "10000000-0000-4000-8000-000000000001",
          }),
        }),
        routeParams,
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(503);
      expect((await response.json()).error).toMatchObject({
        code: "CHECKIN_AUTH_UNAVAILABLE",
        retryable: true,
      });
    }
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the local-date profile cannot be loaded", async () => {
    routeState.authResult.data.user = { id: "user-1" };
    routeState.profileResult.data = null;
    routeState.profileResult.error = { code: "08006" };

    const response = await PATCH_CHECKIN(
      new Request("http://localhost/api/checkins/2026-08-12", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "meal_status",
          mealType: "lunch",
          status: "skipped",
          skipReason: "Travel day",
        }),
      }),
      routeParams,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatchObject({
      code: "CHECKIN_PROFILE_UNAVAILABLE",
      retryable: true,
    });
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("requires a real profile instead of silently using UTC", async () => {
    routeState.authResult.data.user = { id: "user-1" };
    routeState.profileResult.data = null;

    const response = await POST_ITEM(
      new Request("http://localhost/api/checkins/2026-08-12/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mealType: "dinner",
          foodId: "10000000-0000-4000-8000-000000000001",
        }),
      }),
      routeParams,
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: "PROFILE_REQUIRED",
      action: { href: "/onboarding" },
    });
    expect(routeState.rpc).not.toHaveBeenCalled();
  });
});
