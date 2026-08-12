import { describe, expect, it } from "vitest";
import {
  classifyOnboardingCompletionError,
  classifyOnboardingDraftError,
  onboardingTransportError,
} from "../../src/lib/onboarding-error-taxonomy";

describe("onboarding public error taxonomy", () => {
  it.each([
    {
      provider: { code: "42501", message: "Email verification is required." },
      code: "EMAIL_VERIFICATION_REQUIRED",
      status: 409,
    },
    {
      provider: { code: "42501", message: "private RLS policy detail" },
      code: "SESSION_EXPIRED",
      status: 401,
    },
    {
      provider: { code: "PGRST202", message: "private schema detail" },
      code: "ONBOARDING_DATABASE_OUTDATED",
      status: 503,
    },
    {
      provider: {
        code: "23514",
        message: "Choose a height before completing onboarding.",
      },
      code: "MISSING_HEIGHT",
      status: 422,
    },
    {
      provider: {
        code: "23514",
        message:
          "Onboarding is already completed and cannot be changed through setup.",
      },
      code: "ONBOARDING_ALREADY_COMPLETED",
      status: 409,
    },
    {
      provider: {
        code: "23514",
        message: "Terms and privacy acceptance could not be proven.",
      },
      code: "LEGAL_ACCEPTANCE_REQUIRED",
      status: 409,
    },
    {
      provider: {
        code: "23514",
        message: "A complete account profile is required.",
      },
      code: "PROFILE_REQUIRED",
      status: 409,
    },
    {
      provider: {
        code: "23514",
        message: "The selected foods are ambiguous.",
      },
      code: "FOOD_SELECTION_CHANGED",
      status: 409,
    },
    {
      provider: { code: "22023", message: "private invalid argument" },
      code: "INVALID_ONBOARDING",
      status: 422,
    },
    {
      provider: { code: "23505", message: "private constraint name" },
      code: "DUPLICATE_MEAL_FOOD",
      status: 409,
    },
    {
      provider: { code: "40001", message: "private serialization detail" },
      code: "ONBOARDING_SAVE_CONFLICT",
      status: 409,
    },
    {
      provider: { code: "57014", message: "private statement timeout" },
      code: "ONBOARDING_SAVE_TIMEOUT",
      status: 503,
    },
    {
      provider: { code: "XX000", message: "private database detail" },
      code: "ONBOARDING_SAVE_FAILED",
      status: 500,
    },
  ])("maps $code to a safe repair path", ({ provider, code, status }) => {
    const result = classifyOnboardingCompletionError(provider);

    expect(result).toEqual(
      expect.objectContaining({
        code,
        status,
        details: expect.any(String),
        action: expect.objectContaining({ label: expect.any(String) }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(provider.message);
  });

  it("separates draft conflicts, session failures, and service failures", () => {
    expect(classifyOnboardingDraftError({ code: "409" }, "save")).toMatchObject({
      code: "DRAFT_SAVE_CONFLICT",
      status: 409,
    });
    expect(
      classifyOnboardingDraftError({ code: "PGRST301" }, "load"),
    ).toMatchObject({ code: "SESSION_EXPIRED", status: 401 });
    expect(classifyOnboardingDraftError({ code: "XX000" }, "load")).toMatchObject({
      code: "DRAFT_LOAD_FAILED",
      status: 503,
    });
  });

  it("provides an actionable network failure for each onboarding operation", () => {
    expect(onboardingTransportError("complete")).toMatchObject({
      code: "ONBOARDING_NETWORK_ERROR",
      status: 503,
      retryable: true,
    });
    expect(onboardingTransportError("save")).toMatchObject({
      code: "ONBOARDING_SERVICE_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
  });
});
