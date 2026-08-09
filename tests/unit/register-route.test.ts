import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  developmentDemo: false,
  signUp: vi.fn(),
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => routeState.developmentDemo,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signUp: routeState.signUp },
  }),
}));

import { POST } from "../../app/api/auth/register/route";

function registrationRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: "Jamie Rivera",
      gender: "prefer_not_to_say",
      dateOfBirth: "2000-02-29",
      timeZone: "America/New_York",
      email: "jamie@example.test",
      password: "correct horse battery staple",
      termsAccepted: true,
      privacyAccepted: true,
      ...overrides,
    }),
  });
}

describe("POST registration route", () => {
  beforeEach(() => {
    routeState.developmentDemo = false;
    routeState.signUp.mockReset();
    routeState.signUp.mockResolvedValue({
      data: { user: { identities: [{ id: "identity-1" }] } },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes canonical DOB metadata to Auth without trusting a client age", async () => {
    const response = await POST(registrationRequest());

    expect(response.status).toBe(201);
    expect(routeState.signUp).toHaveBeenCalledWith({
      email: "jamie@example.test",
      password: "correct horse battery staple",
      options: {
        data: {
          full_name: "Jamie Rivera",
          gender: "prefer_not_to_say",
          date_of_birth: "2000-02-29",
          registration_time_zone: "America/New_York",
          terms_version: "1.2",
          privacy_version: "1.3",
        },
      },
    });
    expect(routeState.signUp.mock.calls[0]?.[0].options.data).not.toHaveProperty(
      "age",
    );
  });

  it.each(["2026-02-29", "2999-01-01", "not-a-date"])(
    "rejects invalid DOB %s before calling Auth",
    async (dateOfBirth) => {
      const response = await POST(registrationRequest({ dateOfBirth }));
      const result = await response.json();

      expect(response.status).toBe(422);
      expect(result.error.code).toBe("INVALID_DATE_OF_BIRTH");
      expect(routeState.signUp).not.toHaveBeenCalled();
    },
  );

  it("rejects the legacy numeric-age payload", async () => {
    const body = {
      fullName: "Jamie Rivera",
      gender: "prefer_not_to_say",
      age: 26,
      timeZone: "America/New_York",
      email: "jamie@example.test",
      password: "correct horse battery staple",
      termsAccepted: true,
      privacyAccepted: true,
    };
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(422);
    expect(routeState.signUp).not.toHaveBeenCalled();
  });

  it("rejects an invalid registration time zone", async () => {
    const response = await POST(
      registrationRequest({ timeZone: "Mars/Olympus_Mons" }),
    );

    expect(response.status).toBe(422);
    expect(routeState.signUp).not.toHaveBeenCalled();
  });

  it("returns a field-specific public code for an invalid email", async () => {
    const response = await POST(
      registrationRequest({ email: "not-an-email" }),
    );
    const result = await response.json();

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("INVALID_EMAIL");
    expect(result.error.action.kind).toBe("edit");
    expect(routeState.signUp).not.toHaveBeenCalled();
  });

  it("returns a field-specific public code for a locally weak password", async () => {
    const response = await POST(registrationRequest({ password: "too-short" }));
    const result = await response.json();

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("WEAK_PASSWORD");
    expect(result.error.action.kind).toBe("edit");
    expect(routeState.signUp).not.toHaveBeenCalled();
  });

  it("uses the supplied local calendar date for the registration age", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:30:00.000Z"));

    const response = await POST(
      registrationRequest({
        dateOfBirth: "2012-01-01",
        timeZone: "America/New_York",
      }),
    );

    expect(response.status).toBe(422);
    expect(routeState.signUp).not.toHaveBeenCalled();
  });

  it("states explicitly when the registration email already has an account", async () => {
    routeState.signUp.mockResolvedValueOnce({
      data: { user: null },
      error: {
        code: "email_exists",
        status: 422,
        message: "private provider duplicate detail",
      },
    });

    const response = await POST(registrationRequest());
    const result = await response.json();

    expect(response.status).toBe(409);
    expect(result.error).toMatchObject({
      code: "EMAIL_ALREADY_REGISTERED",
      action: { href: "/login" },
    });
    expect(JSON.stringify(result)).not.toContain("private provider");
  });

  it("detects the provider's obfuscated duplicate-signup response", async () => {
    routeState.signUp.mockResolvedValueOnce({
      data: { user: { identities: [] } },
      error: null,
    });

    const response = await POST(registrationRequest());
    const result = await response.json();

    expect(response.status).toBe(409);
    expect(result.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("returns a safe leaked-password repair message", async () => {
    routeState.signUp.mockResolvedValueOnce({
      data: { user: null },
      error: {
        code: "weak_password",
        reasons: ["pwned"],
        message: "private breach provider detail",
      },
    });

    const response = await POST(registrationRequest());
    const result = await response.json();

    expect(response.status).toBe(422);
    expect(result.error.code).toBe("PASSWORD_COMPROMISED");
    expect(JSON.stringify(result)).not.toContain("private breach");
  });
});
