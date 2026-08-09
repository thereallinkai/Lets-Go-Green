import type { PublicErrorDefinition } from "./api-response";

export type PlanGenerationFailureCode =
  | "PROFILE_HEIGHT_REQUIRED"
  | "PROFILE_DATA_LOAD_FAILED"
  | "TRUSTED_PROFILE_INCOMPLETE"
  | "INSUFFICIENT_ELIGIBLE_FOODS"
  | "CATALOG_LOAD_FAILED"
  | "PROVIDER_OUTPUT_REJECTED"
  | "PLAN_PERSISTENCE_FAILED"
  | "PLAN_GENERATION_FAILED";

export function classifyPlanGenerationFailure(
  code: PlanGenerationFailureCode,
): PublicErrorDefinition {
  switch (code) {
    case "PROFILE_HEIGHT_REQUIRED":
      return {
        code,
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
      };
    case "PROFILE_DATA_LOAD_FAILED":
      return {
        code,
        message: "Your saved profile information could not be loaded.",
        details:
          "Your accepted plan is unchanged. Check the connection and try generating again after a short wait.",
        status: 503,
        retryable: true,
        action: { kind: "retry", label: "Try again" },
      };
    case "TRUSTED_PROFILE_INCOMPLETE":
      return {
        code,
        message: "Complete the required profile and goal details first.",
        details:
          "Review onboarding Step 5, save all required details, and then try generating a plan again.",
        status: 409,
        retryable: false,
        action: {
          kind: "navigate",
          label: "Review profile",
          href: "/onboarding?step=5",
        },
      };
    case "INSUFFICIENT_ELIGIBLE_FOODS":
      return {
        code,
        message: "Choose at least three eligible foods before generating a plan.",
        details:
          "Review Meals and replace foods that are unavailable, unverified, or excluded by allergies and restrictions.",
        status: 422,
        retryable: false,
        action: {
          kind: "navigate",
          label: "Review meals",
          href: "/onboarding?step=3",
        },
      };
    case "CATALOG_LOAD_FAILED":
      return {
        code,
        message: "Food nutrition data could not be loaded.",
        details:
          "Your accepted plan is unchanged. Wait briefly and try generating the plan again.",
        status: 503,
        retryable: true,
        action: { kind: "retry", label: "Try again" },
      };
    case "PROVIDER_OUTPUT_REJECTED":
      return {
        code,
        message: "The generated plan did not pass the app's safety checks.",
        details:
          "No plan was replaced. Try one new generation request; review your inputs if it happens again.",
        status: 502,
        retryable: true,
        action: { kind: "retry", label: "Generate again" },
      };
    case "PLAN_PERSISTENCE_FAILED":
      return {
        code,
        message: "The generated plan could not be saved.",
        details:
          "Your accepted plan is unchanged. Wait briefly before starting a new generation request.",
        status: 503,
        retryable: true,
        action: { kind: "retry", label: "Try again" },
      };
    case "PLAN_GENERATION_FAILED":
      return {
        code,
        message: "A new plan could not be generated.",
        details:
          "Your accepted plan is unchanged. Review the inputs and try one new generation request.",
        status: 500,
        retryable: true,
        action: { kind: "retry", label: "Try again" },
      };
  }
}
