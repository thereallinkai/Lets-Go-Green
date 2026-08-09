import { describe, expect, it } from "vitest";
import {
  classifyPlanGenerationFailure,
  type PlanGenerationFailureCode,
} from "../../src/lib/plan-generation-error-taxonomy";

describe("plan-generation public error taxonomy", () => {
  it("directs legacy profiles with missing height to onboarding Step 5", () => {
    expect(classifyPlanGenerationFailure("PROFILE_HEIGHT_REQUIRED")).toEqual({
      code: "PROFILE_HEIGHT_REQUIRED",
      message: "Add your height before generating a plan.",
      details:
        "Open onboarding Step 5 or your profile, save a valid height, and generate the plan again.",
      status: 422,
      retryable: false,
      action: {
        kind: "navigate",
        label: "Add height",
        href: "/onboarding?step=5",
      },
    });
  });

  it.each<PlanGenerationFailureCode>([
    "PROFILE_DATA_LOAD_FAILED",
    "TRUSTED_PROFILE_INCOMPLETE",
    "INSUFFICIENT_ELIGIBLE_FOODS",
    "CATALOG_LOAD_FAILED",
    "PROVIDER_OUTPUT_REJECTED",
    "PLAN_PERSISTENCE_FAILED",
    "PLAN_GENERATION_FAILED",
  ])("gives %s a stable action and status", (code) => {
    const result = classifyPlanGenerationFailure(code);

    expect(result).toEqual(
      expect.objectContaining({
        code,
        message: expect.any(String),
        details: expect.any(String),
        status: expect.any(Number),
        action: expect.objectContaining({ label: expect.any(String) }),
      }),
    );
  });
});
