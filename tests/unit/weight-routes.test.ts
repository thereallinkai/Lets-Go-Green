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

import {
  DELETE as deleteWeight,
  PUT as updateWeight,
} from "../../app/api/weights/[id]/route";
import {
  GET as loadWeights,
  POST as saveWeight,
} from "../../app/api/weights/route";

const entryId = "00000000-0000-4000-8000-000000000101";
const baselineError = {
  code: "23514",
  message: "The onboarding baseline weight is protected.",
};

function clientWithRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  routeState.client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    rpc,
  };
  return rpc;
}

describe("protected onboarding baseline weight routes", () => {
  beforeEach(() => {
    routeState.client = null;
  });

  it("returns a safe conflict instead of editing the baseline", async () => {
    const rpc = clientWithRpc({ data: null, error: baselineError });
    const response = await updateWeight(
      new Request(`http://localhost/api/weights/${entryId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weight: 175, unit: "lb" }),
      }),
      { params: Promise.resolve({ id: entryId }) },
    );
    const result = await response.json();

    expect(response.status).toBe(409);
    expect(result.error).toMatchObject({
      code: "BASELINE_WEIGHT_IMMUTABLE",
      retryable: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "update_weight_entry",
      expect.objectContaining({ target_entry_id: entryId }),
    );
  });

  it("returns the same safe conflict instead of deleting the baseline", async () => {
    const rpc = clientWithRpc({ data: null, error: baselineError });
    const response = await deleteWeight(
      new Request(`http://localhost/api/weights/${entryId}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: entryId }) },
    );
    const result = await response.json();

    expect(response.status).toBe(409);
    expect(result.error).toMatchObject({
      code: "BASELINE_WEIGHT_IMMUTABLE",
      retryable: false,
    });
    expect(rpc).toHaveBeenCalledWith("delete_weight_entry", {
      target_entry_id: entryId,
    });
  });

  it("still updates an ordinary owned weight through the guarded RPC", async () => {
    const saved = {
      id: entryId,
      weight_kg: 79.379,
      source_display_unit: "lb",
      is_onboarding_baseline: false,
    };
    clientWithRpc({ data: saved, error: null });

    const response = await updateWeight(
      new Request(`http://localhost/api/weights/${entryId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weight: 175, unit: "lb" }),
      }),
      { params: Promise.resolve({ id: entryId }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(saved);
  });

  it("distinguishes a retryable authentication-service failure from no session", async () => {
    const rpc = vi.fn();
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "private auth diagnostic" },
        }),
      },
      rpc,
    };

    const response = await deleteWeight(
      new Request(`http://localhost/api/weights/${entryId}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: entryId }) },
    );
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toMatchObject({
      code: "WEIGHT_AUTH_UNAVAILABLE",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("private auth");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats Supabase's missing-session error as signed out", async () => {
    const rpc = vi.fn();
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { name: "AuthSessionMissingError", status: 400 },
        }),
      },
      rpc,
    };

    const response = await deleteWeight(
      new Request(`http://localhost/api/weights/${entryId}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: entryId }) },
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("SESSION_EXPIRED");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed history limit before querying the database", async () => {
    const limit = vi.fn();
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({ limit })),
          })),
        })),
      })),
    };

    const response = await loadWeights(
      new Request("http://localhost/api/weights?limit=not-a-number"),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("INVALID_WEIGHT_LIMIT");
    expect(limit).not.toHaveBeenCalled();
  });

  it("does not fall back to UTC when the profile time zone query fails", async () => {
    const rpc = vi.fn();
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "private profile diagnostic" },
            }),
          }),
        }),
      }),
      rpc,
    };

    const response = await saveWeight(
      new Request("http://localhost/api/weights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          localDate: "2026-08-01",
          weight: 80,
          unit: "kg",
        }),
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toMatchObject({
      code: "WEIGHT_PROFILE_UNAVAILABLE",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("private profile");
    expect(rpc).not.toHaveBeenCalled();
  });
});
