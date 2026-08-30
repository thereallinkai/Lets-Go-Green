import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/health/route";

describe("health route native project identity", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.stubEnv("ENABLE_REAL_AI", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes a valid native project identity in development demo mode", async () => {
    const nativeProjectId = "a".repeat(64);
    vi.stubEnv("LETS_GO_GREEN_NATIVE_PROJECT_ID", nativeProjectId);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        readiness: "ready",
        database: "not_configured",
        nativeProjectId,
      },
      error: null,
    });
  });

  it("returns null for a malformed native project identity", async () => {
    vi.stubEnv("LETS_GO_GREEN_NATIVE_PROJECT_ID", "not-a-project-hash");

    const response = await GET();

    expect(response.status).toBe(200);
    expect((await response.json()).data.nativeProjectId).toBeNull();
  });

  it("does not expose the native project identity outside demo mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LETS_GO_GREEN_NATIVE_PROJECT_ID", "b".repeat(64));

    const response = await GET();

    expect(response.status).toBe(503);
    expect((await response.json()).data.nativeProjectId).toBeNull();
  });
});
