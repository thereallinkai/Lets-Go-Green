import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const proxyState = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: proxyState.getUser },
  }),
}));

import { config, proxy } from "../../proxy";

describe("authentication proxy scope", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    proxyState.getUser.mockReset();
    proxyState.getUser.mockResolvedValue({ data: { user: null } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs only for pages that need session refresh or auth redirects", () => {
    expect(config.matcher).toEqual([
      "/today/:path*",
      "/plan/:path*",
      "/calendar/:path*",
      "/progress/:path*",
      "/profile/:path*",
      "/settings/:path*",
      "/onboarding/:path*",
      "/login",
      "/register",
    ]);
    expect(config.matcher.some((route) => route.includes("api"))).toBe(false);
  });

  it.each(["/today", "/profile", "/settings/privacy"])(
    "redirects signed-out access to the protected %s route",
    async (pathname) => {
      const response = await proxy(
        new NextRequest(`http://localhost${pathname}`),
      );

      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(pathname);
    },
  );

  it("does not treat a similar public path as protected", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/today-overview"),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an authenticated user away from account entry pages", async () => {
    proxyState.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });

    const response = await proxy(new NextRequest("http://localhost/login"));

    expect(new URL(response.headers.get("location")!).pathname).toBe("/today");
  });
});
