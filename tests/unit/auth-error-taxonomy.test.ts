import { describe, expect, it } from "vitest";
import {
  classifyAuthError,
  duplicateSignupResult,
  isAuthSessionMissing,
} from "../../src/lib/auth-error-taxonomy";

describe("authentication public error taxonomy", () => {
  it.each([
    {
      provider: { code: "email_exists", message: "raw duplicate detail" },
      code: "EMAIL_ALREADY_REGISTERED",
      status: 409,
    },
    {
      provider: {
        code: "email_address_invalid",
        message: "raw validation detail",
      },
      code: "INVALID_EMAIL",
      status: 422,
    },
    {
      provider: { code: "weak_password", message: "raw password policy" },
      code: "WEAK_PASSWORD",
      status: 422,
    },
    {
      provider: {
        code: "weak_password",
        reasons: ["pwned"],
        message: "raw breach-provider detail",
      },
      code: "PASSWORD_COMPROMISED",
      status: 422,
    },
    {
      provider: {
        code: "over_email_send_rate_limit",
        message: "raw rate limit detail",
      },
      code: "REGISTRATION_RATE_LIMITED",
      status: 429,
    },
    {
      provider: { code: "captcha_failed", message: "raw captcha detail" },
      code: "CAPTCHA_FAILED",
      status: 400,
    },
    {
      provider: { code: "signup_disabled", message: "raw config detail" },
      code: "AUTH_CONFIGURATION_ERROR",
      status: 503,
    },
  ])(
    "maps registration failures to $code without leaking provider details",
    ({ provider, code, status }) => {
      const result = classifyAuthError(provider, "register");

      expect(result).toEqual(
        expect.objectContaining({
          code,
          status,
          details: expect.any(String),
          action: expect.objectContaining({ label: expect.any(String) }),
        }),
      );
      expect(JSON.stringify(result)).not.toContain(provider.message);
    },
  );

  it("makes identity-related login failures indistinguishable", () => {
    const errors = [
      "invalid_credentials",
      "user_not_found",
      "email_not_confirmed",
      "user_banned",
      "email_address_invalid",
    ].map((code) =>
      classifyAuthError(
        { code, status: 400, message: `private ${code} detail` },
        "login",
      ),
    );

    for (const error of errors) {
      expect(error).toEqual(errors[0]);
      expect(error.code).toBe("INVALID_CREDENTIALS");
    }
    expect(JSON.stringify(errors)).not.toContain("private");
  });

  it("distinguishes retryable operational failures without exposing internals", () => {
    const network = classifyAuthError(
      new TypeError("private network stack"),
      "register",
    );
    const service = classifyAuthError(
      { status: 503, message: "private service response" },
      "verify_email",
    );

    expect(network).toMatchObject({
      code: "AUTH_NETWORK_ERROR",
      status: 503,
      retryable: true,
    });
    expect(service).toMatchObject({
      code: "AUTH_SERVICE_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
    expect(JSON.stringify({ network, service })).not.toContain("private");
  });

  it("keeps a retryable verification attempt on the current code", () => {
    const result = classifyAuthError(
      { code: "unexpected_verification_failure" },
      "verify_email",
    );

    expect(result).toMatchObject({
      code: "VERIFICATION_UNAVAILABLE",
      retryable: true,
      action: { kind: "retry", label: "Try again" },
    });
    expect(result.details).toContain("same verification");
    expect(result.details).toContain("only if the current code");
  });

  it("returns operation-specific rate-limit and session repair codes", () => {
    expect(
      classifyAuthError({ status: 429 }, "request_recovery").code,
    ).toBe("RECOVERY_RATE_LIMITED");
    expect(
      classifyAuthError({ status: 429 }, "resend_verification").code,
    ).toBe("VERIFICATION_RATE_LIMITED");
    expect(
      classifyAuthError({ code: "session_expired" }, "update_password"),
    ).toMatchObject({
      code: "SESSION_EXPIRED",
      status: 401,
      action: { href: "/forgot-password" },
    });
    expect(
      classifyAuthError(
        { name: "AuthSessionMissingError", status: 400 },
        "update_password",
      ),
    ).toMatchObject({
      code: "SESSION_EXPIRED",
      status: 401,
      action: { href: "/forgot-password" },
    });
  });

  it("recognizes structural missing-session errors without treating service failures as signed out", () => {
    expect(
      isAuthSessionMissing({
        name: "AuthSessionMissingError",
        status: 400,
      }),
    ).toBe(true);
    expect(isAuthSessionMissing({ code: "refresh_token_not_found" })).toBe(
      true,
    );
    expect(
      isAuthSessionMissing({
        name: "AuthRetryableFetchError",
        status: 503,
      }),
    ).toBe(false);
  });

  it("recognizes Supabase's intentionally obfuscated duplicate-signup result", () => {
    expect(duplicateSignupResult({ user: { identities: [] } })).toBe(true);
    expect(
      duplicateSignupResult({ user: { identities: [{ id: "identity-1" }] } }),
    ).toBe(false);
    expect(duplicateSignupResult({ user: null })).toBe(false);
  });
});
