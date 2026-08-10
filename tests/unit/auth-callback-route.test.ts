import { beforeEach, describe, expect, it, vi } from "vitest";

const callbackState = vi.hoisted(() => ({
  client: null as unknown,
  createError: null as Error | null,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    if (callbackState.createError) throw callbackState.createError;
    return callbackState.client;
  },
}));

import { GET } from "../../app/auth/callback/route";
import {
  authCallbackErrorForLogin,
  safeAuthCallbackNext,
} from "../../src/lib/auth-callback";

function callbackRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/auth/callback");
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return new Request(url);
}

describe("authentication callback route", () => {
  beforeEach(() => {
    callbackState.createError = null;
    callbackState.client = {
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
        verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      },
    };
  });

  it("allows a same-origin relative destination", async () => {
    const response = await GET(
      callbackRequest({ code: "valid-code", next: "/onboarding?step=3" }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/onboarding?step=3",
    );
  });

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "\\\\attacker.example/path",
    "/\\attacker.example/path",
    "/%5Cattacker.example/path",
    "/%255Cattacker.example/path",
    "/safe\u0000unsafe",
    "/safe\nunsafe",
    "javascript:alert(1)",
  ])("rejects unsafe redirect destination %j", async (next) => {
    const response = await GET(callbackRequest({ code: "valid-code", next }));

    expect(response.headers.get("location")).toBe("http://localhost/today");
  });

  it("uses a concrete incomplete-link error without calling auth", async () => {
    const response = await GET(callbackRequest({ type: "signup" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("authError")).toBe(
      "AUTH_CALLBACK_INCOMPLETE",
    );
    expect(
      (callbackState.client as { auth: { verifyOtp: ReturnType<typeof vi.fn> } })
        .auth.verifyOtp,
    ).not.toHaveBeenCalled();
  });

  it("reports an invalid or expired verification link without provider text", async () => {
    callbackState.client = {
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          error: {
            code: "otp_expired",
            message: "private provider diagnostic",
            status: 400,
          },
        }),
      },
    };

    const response = await GET(callbackRequest({ code: "expired-code" }));
    const location = response.headers.get("location")!;

    expect(new URL(location).searchParams.get("authError")).toBe(
      "AUTH_LINK_INVALID_OR_EXPIRED",
    );
    expect(location).not.toContain("private");
  });

  it("distinguishes an expired recovery link", async () => {
    callbackState.client = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          error: { code: "otp_expired", message: "private", status: 400 },
        }),
      },
    };

    const response = await GET(
      callbackRequest({
        token_hash: "expired-token",
        type: "recovery",
      }),
    );

    expect(new URL(response.headers.get("location")!).searchParams.get("authError"))
      .toBe("RECOVERY_LINK_INVALID_OR_EXPIRED");
  });

  it("keeps PKCE recovery-code failures on the recovery path", async () => {
    callbackState.client = {
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          error: { code: "otp_expired", message: "private", status: 400 },
        }),
      },
    };

    const response = await GET(
      callbackRequest({
        code: "expired-recovery-code",
        purpose: "recovery",
        next: "/reset-password",
      }),
    );

    expect(new URL(response.headers.get("location")!).searchParams.get("authError"))
      .toBe("RECOVERY_LINK_INVALID_OR_EXPIRED");
  });

  it.each([
    { error: { code: "unexpected_failure", message: "private", status: 500 } },
    {
      error: {
        name: "AuthRetryableFetchError",
        message: "private network diagnostic",
        status: 0,
      },
    },
    { thrown: new Error("private transport detail") },
  ])("reports a safe service failure for $error$thrown", async (failure) => {
    if (failure.thrown) {
      callbackState.createError = failure.thrown;
    } else {
      callbackState.client = {
        auth: {
          exchangeCodeForSession: vi.fn().mockResolvedValue({
            error: failure.error,
          }),
        },
      };
    }

    const response = await GET(callbackRequest({ code: "some-code" }));
    const location = response.headers.get("location")!;

    expect(new URL(location).searchParams.get("authError")).toBe(
      "AUTH_CALLBACK_SERVICE_UNAVAILABLE",
    );
    expect(location).not.toContain("private");
  });
});

describe("authentication callback public input", () => {
  it("maps only allowlisted callback codes to login errors", () => {
    expect(authCallbackErrorForLogin("AUTH_CALLBACK_INCOMPLETE")).toMatchObject({
      code: "AUTH_CALLBACK_INCOMPLETE",
      retryable: false,
      action: { href: "/onboarding?step=2" },
    });
    expect(authCallbackErrorForLogin("attacker-controlled message")).toBeNull();
    expect(authCallbackErrorForLogin(["AUTH_CALLBACK_INCOMPLETE"])).toBeNull();
  });

  it("rejects encoded redirect separators through repeated decoding", () => {
    expect(safeAuthCallbackNext("/%25252525255Cevil.example", "/today")).toBe(
      "/today",
    );
  });
});
