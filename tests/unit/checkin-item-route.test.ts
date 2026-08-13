import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  authResult: {
    data: { user: { id: "user-1" } as { id: string } | null },
    error: null as { name?: string; status?: number } | null,
  },
  itemResult: {
    data: {
      id: "11111111-1111-4111-8111-111111111111",
      meal_checkin_id: "22222222-2222-4222-8222-222222222222",
    } as { id: string; meal_checkin_id: string } | null,
    error: null as { code?: string } | null,
  },
  checkinResult: {
    data: null as { id: string } | null,
    error: null as { code?: string } | null,
  },
  rpc: vi.fn(),
}));

function queryBuilder(result: {
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
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => routeState.authResult,
    },
    from: (table: string) =>
      queryBuilder(
        table === "daily_meal_items"
          ? routeState.itemResult
          : routeState.checkinResult,
      ),
    rpc: routeState.rpc,
  }),
}));

import { DELETE } from "../../app/api/checkins/[date]/items/[id]/route";

describe("DELETE check-in item route", () => {
  beforeEach(() => {
    routeState.authResult.data.user = { id: "user-1" };
    routeState.authResult.error = null;
    routeState.itemResult.data = {
      id: "11111111-1111-4111-8111-111111111111",
      meal_checkin_id: "22222222-2222-4222-8222-222222222222",
    };
    routeState.itemResult.error = null;
    routeState.checkinResult.data = null;
    routeState.checkinResult.error = null;
    routeState.rpc.mockReset();
  });

  it("rejects an invalid local date before attempting deletion", async () => {
    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({
        date: "2026-02-30",
        id: "11111111-1111-4111-8111-111111111111",
      }),
    });

    expect(response.status).toBe(422);
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("does not delete an item whose meal check-in is not on the route date", async () => {
    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({
        date: "2026-07-29",
        id: "11111111-1111-4111-8111-111111111111",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("MEAL_ITEM_NOT_FOUND");
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("distinguishes an auth outage from a missing session", async () => {
    routeState.authResult.data.user = null;
    routeState.authResult.error = {
      name: "AuthRetryableFetchError",
      status: 0,
    };

    const unavailable = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({
        date: "2026-07-29",
        id: "11111111-1111-4111-8111-111111111111",
      }),
    });
    const unavailableBody = await unavailable.json();

    expect(unavailable.status).toBe(503);
    expect(unavailableBody.error).toMatchObject({
      code: "CHECKIN_AUTH_UNAVAILABLE",
      retryable: true,
    });

    routeState.authResult.error = {
      name: "AuthSessionMissingError",
    };
    const signedOut = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({
        date: "2026-07-29",
        id: "11111111-1111-4111-8111-111111111111",
      }),
    });

    expect(signedOut.status).toBe(401);
    expect((await signedOut.json()).error.code).toBe("SESSION_EXPIRED");
  });
});
