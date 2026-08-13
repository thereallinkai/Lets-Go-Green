import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  developmentDemo: false,
  client: null as unknown,
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => routeState.developmentDemo,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => routeState.client,
}));

import { POST as login } from "../../app/api/auth/login/route";
import { POST as logout } from "../../app/api/auth/logout/route";
import { POST as forgotPassword } from "../../app/api/auth/forgot/route";
import { POST as resendVerification } from "../../app/api/auth/resend/route";
import { POST as resetPassword } from "../../app/api/auth/reset/route";
import { POST as verifyEmail } from "../../app/api/auth/verify/route";

function post(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("authentication routes use safe public errors", () => {
  beforeEach(() => {
    routeState.developmentDemo = false;
    routeState.client = null;
  });

  it("keeps login identity failures enumeration-safe", async () => {
    const responses = [];
    for (const code of ["invalid_credentials", "email_not_confirmed"]) {
      routeState.client = {
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { code, message: `private ${code} provider detail` },
          }),
        },
      };
      const response = await login(
        post("/api/auth/login", {
          email: "jamie@example.test",
          password: "wrong-password",
        }),
      );
      responses.push({ status: response.status, body: await response.json() });
    }

    expect(responses[0]).toEqual(responses[1]);
    expect(responses[0]).toMatchObject({
      status: 401,
      body: { error: { code: "INVALID_CREDENTIALS" } },
    });
    expect(JSON.stringify(responses)).not.toContain("private");
  });

  it("reports a profile-status failure after valid credentials", async () => {
    routeState.client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "private database detail" },
            }),
          }),
        }),
      }),
    };

    const response = await login(
      post("/api/auth/login", {
        email: "jamie@example.test",
        password: "correct horse battery staple",
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error.code).toBe("PROFILE_STATUS_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("private database");
  });

  it("does not report logout success when the provider returns an error", async () => {
    routeState.client = {
      auth: {
        signOut: vi.fn().mockResolvedValue({
          error: { code: "unexpected_failure", message: "private detail" },
        }),
      },
    };

    const response = await logout();
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toMatchObject({
      code: "LOGOUT_FAILED",
      retryable: true,
      action: { kind: "retry" },
    });
    expect(JSON.stringify(result)).not.toContain("private detail");
  });

  it("keeps unknown recovery addresses indistinguishable from accepted requests", async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({
      error: { code: "user_not_found", message: "private identity detail" },
    });
    routeState.client = {
      auth: {
        resetPasswordForEmail,
      },
    };

    const response = await forgotPassword(
      post("/api/auth/forgot", { email: "unknown@example.test" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { sent: true },
      error: null,
    });
    const expectedOrigin =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost";
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "unknown@example.test",
      {
        redirectTo:
          `${expectedOrigin}/auth/callback?purpose=recovery&next=/reset-password`,
      },
    );
  });

  it("reports a recovery rate limit without exposing provider details", async () => {
    routeState.client = {
      auth: {
        resetPasswordForEmail: vi.fn().mockResolvedValue({
          error: {
            code: "over_email_send_rate_limit",
            message: "private provider rate detail",
          },
        }),
      },
    };

    const response = await forgotPassword(
      post("/api/auth/forgot", { email: "jamie@example.test" }),
    );
    const result = await response.json();

    expect(response.status).toBe(429);
    expect(result.error.code).toBe("RECOVERY_RATE_LIMITED");
    expect(JSON.stringify(result)).not.toContain("private provider");
  });

  it("maps verification resend rate limits", async () => {
    routeState.client = {
      auth: {
        resend: vi.fn().mockResolvedValue({
          error: {
            code: "over_email_send_rate_limit",
            message: "private provider rate detail",
          },
        }),
      },
    };

    const response = await resendVerification(
      post("/api/auth/resend", { email: "jamie@example.test" }),
    );
    const result = await response.json();

    expect(response.status).toBe(429);
    expect(result.error.code).toBe("VERIFICATION_RATE_LIMITED");
    expect(JSON.stringify(result)).not.toContain("private provider");
  });

  it("maps expired email codes to a request-new-code action", async () => {
    routeState.client = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { code: "otp_expired", message: "private OTP detail" },
        }),
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "other-user", email: "other@example.test" },
          },
          error: null,
        }),
      },
    };

    const response = await verifyEmail(
      post("/api/auth/verify", {
        email: "jamie@example.test",
        token: "123456",
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.error).toMatchObject({
      code: "INVALID_OR_EXPIRED_CODE",
      action: { label: "Request a new code" },
    });
    expect(JSON.stringify(result)).not.toContain("private OTP");
  });

  it("distinguishes a verified account profile lookup failure from a missing profile", async () => {
    routeState.client = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "jamie@example.test",
              email_confirmed_at: "2026-08-10T12:00:00.000Z",
            },
          },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi
              .fn()
              .mockRejectedValue(
                new TypeError("private profile query detail"),
              ),
          }),
        }),
      }),
    };

    const response = await verifyEmail(
      post("/api/auth/verify", {
        email: "jamie@example.test",
        token: "123456",
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toMatchObject({
      code: "VERIFIED_PROFILE_STATUS_UNAVAILABLE",
      retryable: true,
      action: { label: "Check profile setup again" },
    });
    expect(JSON.stringify(result)).not.toContain("private profile");
    expect(JSON.stringify(result)).not.toContain("/register");
  });

  it("repairs a missing profile for the verified session and re-reads it", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { user_id: "user-1" },
        error: null,
      });
    const rpc = vi.fn().mockResolvedValue({
      data: { ready: true, repaired: true },
      error: null,
    });
    routeState.client = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: {
            user: { id: "user-1", email: "jamie@example.test" },
          },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle,
          }),
        }),
      }),
      rpc,
    };

    const response = await verifyEmail(
      post("/api/auth/verify", {
        email: "jamie@example.test",
        token: "123456",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { verified: true, profileReady: true },
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith("repair_verified_profile");
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it("returns a safe administrative action when verified-profile repair fails", async () => {
    routeState.client = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: {
            user: { id: "user-1", email: "jamie@example.test" },
          },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "private database repair detail" },
      }),
    };

    const response = await verifyEmail(
      post("/api/auth/verify", {
        email: "jamie@example.test",
        token: "123456",
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toMatchObject({
      code: "VERIFIED_PROFILE_REPAIR_FAILED",
      retryable: false,
      action: {
        kind: "contact_support",
        label: "Contact the site administrator",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private database");
    expect(JSON.stringify(result)).not.toContain("/register");
  });

  it("continues profile setup from an already verified session", async () => {
    const verifyOtp = vi.fn();
    routeState.client = {
      auth: {
        verifyOtp,
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "jamie@example.test",
              email_confirmed_at: "2026-08-10T12:00:00.000Z",
            },
          },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { user_id: "user-1" },
              error: null,
            }),
          }),
        }),
      }),
    };

    const response = await verifyEmail(
      post("/api/auth/verify", { resume: true }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        verified: true,
        profileReady: true,
        redirectTo: "/onboarding?step=3",
      },
      error: null,
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does not continue an authenticated session whose email is unconfirmed", async () => {
    const from = vi.fn();
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "jamie@example.test",
              email_confirmed_at: null,
            },
          },
          error: null,
        }),
      },
      from,
    };

    const response = await verifyEmail(
      post("/api/auth/verify", { resume: true }),
    );
    const result = await response.json();

    expect(response.status).toBe(403);
    expect(result.error).toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
      retryable: false,
      action: { kind: "edit", label: "Enter the verification code" },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("maps AuthSessionMissingError during verified-session resume to login", async () => {
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: {
            name: "AuthSessionMissingError",
            status: 400,
            message: "private missing-session detail",
          },
        }),
      },
    };

    const response = await verifyEmail(
      post("/api/auth/verify", { resume: true }),
    );
    const result = await response.json();

    expect(response.status).toBe(401);
    expect(result.error).toMatchObject({
      code: "VERIFIED_SESSION_EXPIRED",
      retryable: false,
      action: { kind: "navigate", label: "Log in", href: "/login" },
    });
    expect(JSON.stringify(result)).not.toContain("private missing-session");
  });

  it("recovers a matching verified session when a lost response consumed the code", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { code: "otp_expired", message: "consumed code" },
    });
    routeState.client = {
      auth: {
        verifyOtp,
        getUser: vi
          .fn()
          .mockResolvedValueOnce({ data: { user: null }, error: null })
          .mockResolvedValueOnce({
            data: {
              user: {
                id: "user-1",
                email: "JAMIE@example.test",
                email_confirmed_at: "2026-08-10T12:00:00.000Z",
              },
            },
            error: null,
          }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { user_id: "user-1" },
              error: null,
            }),
          }),
        }),
      }),
    };

    const response = await verifyEmail(
      post("/api/auth/verify", {
        email: "jamie@example.test",
        token: "123456",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { verified: true, profileReady: true },
      error: null,
    });
    expect(verifyOtp).toHaveBeenCalledOnce();
  });

  it("maps leaked-password rejection without exposing breach-provider details", async () => {
    routeState.client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
        updateUser: vi.fn().mockResolvedValue({
          error: {
            code: "weak_password",
            reasons: ["pwned"],
            message: "private breach-provider detail",
          },
        }),
      },
    };

    const response = await resetPassword(
      post("/api/auth/reset", {
        password: "correct horse battery staple",
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("PASSWORD_COMPROMISED");
    expect(JSON.stringify(result)).not.toContain("private breach");
  });
});
