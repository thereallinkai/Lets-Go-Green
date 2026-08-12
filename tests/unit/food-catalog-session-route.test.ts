import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  authResult: {
    data: { user: { id: "user-1" } as { id: string } | null },
    error: null as {
      code?: string;
      message?: string;
      name?: string;
      status?: number;
    } | null,
  },
  rpcResult: {
    data: [] as unknown,
    error: null as { code?: string; message?: string } | null,
  },
  createError: null as Error | null,
  authThrow: null as Error | null,
  rpc: vi.fn(),
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    if (routeState.createError) throw routeState.createError;
    return {
      auth: {
        getUser: vi.fn().mockImplementation(() => {
          if (routeState.authThrow) throw routeState.authThrow;
          return routeState.authResult;
        }),
      },
      rpc(
        this: unknown,
        name: string,
        args: Record<string, unknown>,
      ) {
        return routeState.rpc(name, args);
      },
    };
  },
}));

import { GET } from "../../app/api/foods/route";

function request(query = "oats") {
  return new Request(
    `http://localhost/api/foods?q=${encodeURIComponent(query)}`,
  );
}

function catalogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "rolled-oats",
    english_name: "Rolled oats",
    icon_ref: null,
    verification_status: "verified",
    ownership_type: "catalog",
    food_kind: "generic",
    catalog_status: "active",
    brand_name: null,
    product_name: null,
    variant_name: null,
    gtin: null,
    package_description: null,
    categories: ["Carbohydrate"],
    nutrition: null,
    source: null,
    plan_eligible: true,
    total_count: 1,
    ...overrides,
  };
}

describe("food catalog session handling", () => {
  beforeEach(() => {
    routeState.authResult = {
      data: { user: { id: "user-1" } },
      error: null,
    };
    routeState.rpcResult = { data: [], error: null };
    routeState.createError = null;
    routeState.authThrow = null;
    routeState.rpc.mockReset();
    routeState.rpc.mockImplementation(() => routeState.rpcResult);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns a retryable auth-service error instead of calling it session expiry", async () => {
    routeState.authResult = {
      data: { user: null },
      error: { code: "unexpected_failure", message: "private auth detail" },
    };

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toMatchObject({
      code: "AUTH_SERVICE_UNAVAILABLE",
      retryable: true,
      action: { kind: "retry", label: "Try search again" },
    });
    expect(result.error.details).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain("private auth");
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("returns a concrete login action only when the session is absent", async () => {
    routeState.authResult = { data: { user: null }, error: null };

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(401);
    expect(result.error).toMatchObject({
      code: "SESSION_EXPIRED",
      retryable: false,
      action: { kind: "navigate", label: "Log in", href: "/login" },
    });
    expect(result.error.details).toEqual(expect.any(String));
  });

  it("treats auth-js AuthSessionMissingError as a signed-out session", async () => {
    routeState.authResult = {
      data: { user: null },
      error: {
        name: "AuthSessionMissingError",
        status: 400,
        message: "Auth session missing!",
      },
    };

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(401);
    expect(result.error.code).toBe("SESSION_EXPIRED");
    expect(routeState.rpc).not.toHaveBeenCalled();
  });

  it("returns a safe retry envelope for a catalog database failure", async () => {
    routeState.rpcResult = {
      data: null,
      error: { code: "PGRST001", message: "private database detail" },
    };

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toMatchObject({
      code: "FOODS_LOAD_FAILED",
      retryable: true,
      action: { kind: "retry", label: "Try search again" },
    });
    expect(result.error.details).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain("private database");
  });

  it("returns a safe retry envelope for a transport failure", async () => {
    routeState.rpc.mockRejectedValue(new Error("private transport detail"));

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      retryable: true,
      action: { kind: "retry", label: "Try search again" },
    });
    expect(result.error.details).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain("private transport");
  });

  it("fails closed instead of silently omitting malformed catalog rows", async () => {
    routeState.rpcResult = {
      data: [
        catalogRow({ total_count: 2 }),
        { id: "malformed-private-row", total_count: 2 },
      ],
      error: null,
    };

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toMatchObject({
      code: "FOOD_CATALOG_RESPONSE_INVALID",
      retryable: true,
      action: { kind: "retry", label: "Try search again" },
    });
    expect(JSON.stringify(result)).not.toContain("malformed-private-row");
    expect(response.headers.get("X-Total-Count")).toBeNull();
  });

  it("fails closed when the catalog RPC returns a non-array payload", async () => {
    routeState.rpcResult = { data: { unexpected: true }, error: null };

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error.code).toBe("FOOD_CATALOG_RESPONSE_INVALID");
  });

  it("fails closed when the catalog total count is malformed", async () => {
    routeState.rpcResult = {
      data: [catalogRow({ total_count: "not-a-count" })],
      error: null,
    };

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error.code).toBe("FOOD_CATALOG_RESPONSE_INVALID");
    expect(response.headers.get("X-Total-Count")).toBeNull();
  });

  it("does not claim zero total matches for an empty page past the end", async () => {
    routeState.rpcResult = { data: [], error: null };

    const response = await GET(
      new Request("http://localhost/api/foods?q=oats&limit=10&offset=30"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [], error: null });
    expect(response.headers.get("X-Total-Count")).toBeNull();
  });

  it.each(["client creation", "session lookup"])(
    "maps an auth %s exception to the auth-service envelope",
    async (failurePoint) => {
      if (failurePoint === "client creation") {
        routeState.createError = new Error("private client detail");
      } else {
        routeState.authThrow = new Error("private auth transport detail");
      }

      const response = await GET(request());
      const result = await response.json();

      expect(response.status).toBe(503);
      expect(result.error.code).toBe("AUTH_SERVICE_UNAVAILABLE");
      expect(JSON.stringify(result)).not.toContain("private");
      expect(routeState.rpc).not.toHaveBeenCalled();
    },
  );
});
