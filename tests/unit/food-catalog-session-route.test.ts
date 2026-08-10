import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  authResult: {
    data: { user: { id: "user-1" } as { id: string } | null },
    error: null as { code?: string; message?: string } | null,
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
