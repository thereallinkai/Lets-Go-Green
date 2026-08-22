import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  serverClient: null as unknown,
  adminClient: { rpc: vi.fn() } as { rpc: ReturnType<typeof vi.fn> },
  cleanup: vi.fn(),
}));

vi.mock("server-only", () => ({}));

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
  trustedFoodLabelRpc: (admin: { rpc: ReturnType<typeof vi.fn> }) =>
    admin.rpc,
  retryPendingFoodLabelObjectCleanup: (...args: unknown[]) =>
    routeState.cleanup(...args),
}));

import { DELETE } from "../../app/api/food-labels/[id]/route";

const userId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";

function context(id = draftId) {
  return { params: Promise.resolve({ id }) };
}

function authenticated() {
  routeState.serverClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
  };
}

beforeEach(() => {
  authenticated();
  routeState.adminClient.rpc = vi.fn().mockResolvedValue({
    data: [
      { discarded: true, already_absent: false, cleanup_queued: 1 },
    ],
    error: null,
  });
  routeState.cleanup.mockReset();
  routeState.cleanup.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("food label draft discard route", () => {
  it("rejects an invalid ID before authentication", async () => {
    const getUser = vi.fn();
    routeState.serverClient = { auth: { getUser } };

    const response = await DELETE(
      new Request("http://localhost/api/food-labels/not-a-uuid", {
        method: "DELETE",
      }),
      context("not-a-uuid"),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("INVALID_LABEL_ID");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("distinguishes an unavailable auth service from a missing session", async () => {
    routeState.serverClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { code: "AUTH_BACKEND_DOWN", message: "network failed" },
        }),
      },
    };
    const unavailable = await DELETE(
      new Request(`http://localhost/api/food-labels/${draftId}`),
      context(),
    );
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.code).toBe(
      "LABEL_AUTH_UNAVAILABLE",
    );

    routeState.serverClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    };
    const missing = await DELETE(
      new Request(`http://localhost/api/food-labels/${draftId}`),
      context(),
    );
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe("SESSION_EXPIRED");
  });

  it("owner-binds the trusted discard and treats an absent draft as idempotent success", async () => {
    routeState.adminClient.rpc.mockResolvedValueOnce({
      data: [
        { discarded: true, already_absent: true, cleanup_queued: 0 },
      ],
      error: null,
    });

    const response = await DELETE(
      new Request(`http://localhost/api/food-labels/${draftId}`),
      context(),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      discarded: true,
      alreadyAbsent: true,
      cleanupPending: false,
      persisted: true,
    });
    expect(routeState.adminClient.rpc).toHaveBeenCalledWith(
      "discard_food_label_draft",
      { target_user_id: userId, target_submission_id: draftId },
    );
    expect(routeState.cleanup).toHaveBeenCalledWith(
      routeState.adminClient,
      userId,
    );
  });

  it("reports durable cleanup as pending without undoing a successful discard", async () => {
    routeState.cleanup.mockResolvedValueOnce(false);

    const response = await DELETE(
      new Request(`http://localhost/api/food-labels/${draftId}`),
      context(),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      discarded: true,
      cleanupPending: true,
    });
  });

  it.each([
    ["LABEL_DRAFT_UPLOAD_IN_PROGRESS", undefined, "LABEL_DRAFT_UPLOAD_IN_PROGRESS", 409],
    ["LABEL_DRAFT_NOT_DISCARDABLE", undefined, "LABEL_DRAFT_NOT_DISCARDABLE", 409],
    ["LABEL_DRAFT_DISCARD_CONFLICT", undefined, "LABEL_DRAFT_DISCARD_CONFLICT", 409],
    ["database serialization", "40001", "LABEL_DRAFT_DISCARD_CONFLICT", 409],
  ])(
    "maps %s without running storage cleanup",
    async (message, code, publicCode, status) => {
      routeState.adminClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message, code },
      });

      const response = await DELETE(
        new Request(`http://localhost/api/food-labels/${draftId}`),
        context(),
      );
      const payload = await response.json();

      expect(response.status).toBe(status);
      expect(payload.error.code).toBe(publicCode);
      expect(routeState.cleanup).not.toHaveBeenCalled();
    },
  );

  it("redacts unexpected database diagnostics", async () => {
    routeState.adminClient.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "XX000",
        message: "secret storage.objects owner diagnostic",
      },
    });

    const response = await DELETE(
      new Request(`http://localhost/api/food-labels/${draftId}`),
      context(),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("LABEL_DRAFT_DISCARD_FAILED");
    expect(JSON.stringify(payload)).not.toContain("storage.objects");
    expect(JSON.stringify(payload)).not.toContain("XX000");
  });
});
