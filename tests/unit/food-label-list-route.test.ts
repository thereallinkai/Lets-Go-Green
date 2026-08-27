import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  after: vi.fn(),
  cleanup: vi.fn(),
  serverClient: null as unknown,
  adminClient: { role: "trusted" },
}));

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: (...args: unknown[]) => routeState.after(...args),
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => routeState.serverClient,
}));

vi.mock("@/src/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => routeState.adminClient,
}));

vi.mock("@/src/lib/food-label-object-cleanup", () => ({
  retryPendingFoodLabelObjectCleanup: (...args: unknown[]) =>
    routeState.cleanup(...args),
}));

import { GET } from "../../app/api/food-labels/route";

const userId = "11111111-1111-4111-8111-111111111111";

function labelListClient(options?: {
  user?: { id: string } | null;
  authError?: { code?: string; message?: string } | null;
  rows?: unknown[];
}) {
  const limit = vi.fn().mockResolvedValue({
    data: options?.rows ?? [{ id: "label-draft" }],
    error: null,
  });
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  routeState.serverClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options?.user === undefined ? { id: userId } : options.user },
        error: options?.authError ?? null,
      }),
    },
    from: vi.fn(() => ({ select })),
  };
}

beforeEach(() => {
  routeState.after.mockReset();
  routeState.cleanup.mockReset();
  routeState.cleanup.mockResolvedValue(true);
  labelListClient();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("food label list cleanup retry", () => {
  it("schedules owner-scoped private-object cleanup after an authenticated response", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ id: "label-draft" }],
      error: null,
    });
    expect(routeState.after).toHaveBeenCalledTimes(1);

    const retry = routeState.after.mock.calls[0]?.[0] as () => Promise<void>;
    await retry();

    expect(routeState.cleanup).toHaveBeenCalledWith(
      routeState.adminClient,
      userId,
    );
  });

  it("keeps a successful list response independent from a later cleanup failure", async () => {
    routeState.cleanup.mockRejectedValueOnce(new Error("storage unavailable"));

    const response = await GET();
    const retry = routeState.after.mock.calls[0]?.[0] as () => Promise<void>;
    await expect(retry()).resolves.toBeUndefined();

    expect(response.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith(
      "food label cleanup retry could not start",
    );
  });

  it("does not schedule trusted cleanup without an authenticated owner", async () => {
    labelListClient({ user: null });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(routeState.after).not.toHaveBeenCalled();
    expect(routeState.cleanup).not.toHaveBeenCalled();
  });
});
