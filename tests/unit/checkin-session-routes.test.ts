import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const routeState = vi.hoisted(() => ({
  demoMode: false,
  from: vi.fn(),
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

function singleQueryBuilder(result: {
  data: unknown;
  error: { code?: string } | null;
}) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => routeState.demoMode,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => routeState.authResult },
    from: routeState.from,
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
    routeState.demoMode = false;
    routeState.from.mockReset();
    routeState.from.mockImplementation(() =>
      singleQueryBuilder(routeState.profileResult),
    );
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

  it("returns only the committed item id without a food enrichment query", async () => {
    routeState.authResult.data.user = { id: "user-1" };
    routeState.rpc.mockResolvedValue({
      data: { id: "20000000-0000-4000-8000-000000000002" },
      error: null,
    });

    const response = await POST_ITEM(
      new Request("http://localhost/api/checkins/2026-08-12/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mealType: "breakfast",
          foodId: "10000000-0000-4000-8000-000000000001",
        }),
      }),
      routeParams,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual({
      id: "20000000-0000-4000-8000-000000000002",
    });
    expect(routeState.from).toHaveBeenCalledOnce();
    expect(routeState.from).toHaveBeenCalledWith("profiles");
  });

  it("preserves the local demo food-add response without account queries", async () => {
    routeState.demoMode = true;

    const response = await POST_ITEM(
      new Request("http://localhost/api/checkins/2026-08-12/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mealType: "breakfast",
          foodId: "demo-food",
        }),
      }),
      routeParams,
    );

    expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual({
      id: "demo-breakfast-demo-food",
      localDate: "2026-08-12",
      mealType: "breakfast",
      foodId: "demo-food",
    });
    expect(routeState.from).not.toHaveBeenCalled();
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("maps the recorded-food skip invariant to a stable conflict", async () => {
    routeState.authResult.data.user = { id: "user-1" };
    routeState.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message: "A meal slot with recorded food items cannot be skipped.",
        details: "private table and constraint diagnostics",
      },
    });

    const response = await PATCH_CHECKIN(
      new Request("http://localhost/api/checkins/2026-08-12", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "meal_status",
          mealType: "dinner",
          status: "skipped",
          skipReason: null,
        }),
      }),
      routeParams,
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toEqual({
      code: "RECORDED_FOODS_PREVENT_SKIP",
      message: "This meal now has recorded food and cannot be skipped.",
      details:
        "Another tab may have added food. Reload Today, review this meal, and remove every recorded food before trying to skip it.",
      retryable: false,
      action: {
        kind: "navigate",
        label: "Reload Today",
        href: "/today",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private table");
    expect(routeState.rpc).toHaveBeenCalledWith("set_daily_meal_checkin", {
      checkin_date: "2026-08-12",
      target_meal_type: "dinner",
      desired_status: "skipped",
    });
  });

  it("keeps unrelated database failures generic and redacted", async () => {
    routeState.authResult.data.user = { id: "user-1" };
    routeState.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message: "Some other private constraint failed.",
        details: "raw SQL diagnostics must stay private",
      },
    });

    const response = await PATCH_CHECKIN(
      new Request("http://localhost/api/checkins/2026-08-12", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "meal_status",
          mealType: "dinner",
          status: "skipped",
        }),
      }),
      routeParams,
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "CHECKIN_SAVE_FAILED",
      message: "The meal status could not be saved.",
    });
    expect(JSON.stringify(body)).not.toContain("constraint");
    expect(JSON.stringify(body)).not.toContain("raw SQL");
  });
});
