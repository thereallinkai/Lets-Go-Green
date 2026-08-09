import type { PublicErrorDefinition } from "./api-response";

export type OnboardingDatabaseError = {
  code?: string;
  message?: string;
};

function retryable(
  code: string,
  message: string,
  details: string,
  status = 503,
): PublicErrorDefinition {
  return {
    code,
    message,
    details,
    status,
    retryable: true,
    action: { kind: "retry", label: "Try again" },
  };
}

export function classifyOnboardingCompletionError(
  error: OnboardingDatabaseError,
): PublicErrorDefinition {
  const code = (error.code ?? "").toUpperCase();
  const message = (error.message ?? "").toLowerCase();

  if (code === "42501") {
    if (message.includes("email verification")) {
      return {
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verify your email before completing onboarding.",
        details: "Request a new code if the previous code has expired.",
        status: 409,
        retryable: false,
        action: {
          kind: "navigate",
          label: "Verify email",
          href: "/onboarding?step=2",
        },
      };
    }
    return {
      code: "SESSION_EXPIRED",
      message: "Log in again to complete onboarding.",
      details: "Your information remains saved in this browser.",
      status: 401,
      retryable: false,
      action: { kind: "navigate", label: "Log in", href: "/login" },
    };
  }
  if (code === "23514" && message.includes("height")) {
    return {
      code: "MISSING_HEIGHT",
      message: "Choose your height before completing onboarding.",
      details: "Return to Step 5, select a height, and save the final step again.",
      status: 422,
      retryable: false,
      action: {
        kind: "navigate",
        label: "Choose height",
        href: "/onboarding?step=5",
      },
    };
  }
  if (code === "PGRST202" || code === "42883") {
    return {
      code: "ONBOARDING_DATABASE_OUTDATED",
      message: "The database update required for onboarding is not available yet.",
      details: "In local development, restart with npm run dev:all, wait for readiness, and retry.",
      status: 503,
      retryable: true,
      action: { kind: "restart", label: "Restart services, then retry" },
    };
  }
  if (code === "23514" && message.includes("terms and privacy acceptance")) {
    return {
      code: "LEGAL_ACCEPTANCE_REQUIRED",
      message: "Your Terms and Privacy acceptance could not be verified.",
      details: "Sign in again. For a disposable local test account, registration may need to be repeated.",
      status: 409,
      retryable: false,
      action: { kind: "navigate", label: "Log in again", href: "/login" },
    };
  }
  if (code === "23514" && message.includes("account profile")) {
    return {
      code: "PROFILE_REQUIRED",
      message: "The verified account profile is incomplete.",
      details: "Return to registration if date of birth or account verification was not completed.",
      status: 409,
      retryable: false,
      action: { kind: "navigate", label: "Review registration", href: "/register" },
    };
  }
  if (
    code === "23514" &&
    (message.includes("selected food") ||
      message.includes("selected foods") ||
      message.includes("food names are ambiguous"))
  ) {
    return {
      code: "FOOD_SELECTION_CHANGED",
      message: "One or more selected foods are unavailable or still need review.",
      details: "Edit Meals, replace the affected foods, and submit again.",
      status: 409,
      retryable: false,
      action: { kind: "edit", label: "Review meal selections" },
    };
  }
  if (code === "22023") {
    return {
      code: "INVALID_ONBOARDING",
      message: "Some onboarding information has an unsupported format.",
      details: "Review meal preferences, warnings, activity, and required profile fields.",
      status: 422,
      retryable: false,
      action: { kind: "edit", label: "Review onboarding" },
    };
  }
  if (code === "23505") {
    return {
      code: "DUPLICATE_MEAL_FOOD",
      message: "A food was selected more than once for the same meal.",
      details: "Remove the duplicate selection and submit again.",
      status: 409,
      retryable: false,
      action: { kind: "edit", label: "Review meal selections" },
    };
  }
  if (code === "40001" || code === "40P01" || code === "409") {
    return retryable(
      "ONBOARDING_SAVE_CONFLICT",
      "Onboarding changed while the final step was being saved.",
      "Reload the saved information, review it, and submit once more.",
      409,
    );
  }
  if (
    code === "57014" ||
    code === "PGRST000" ||
    code === "PGRST001" ||
    code === "PGRST002"
  ) {
    return retryable(
      "ONBOARDING_SAVE_TIMEOUT",
      "The final onboarding save did not finish.",
      "Your browser copy is unchanged. Check the connection and try again.",
    );
  }
  return retryable(
    "ONBOARDING_SAVE_FAILED",
    "The final onboarding step could not be saved.",
    "Your information remains in this browser. Wait briefly and try again.",
    500,
  );
}

export function classifyOnboardingDraftError(
  error: OnboardingDatabaseError,
  operation: "load" | "save",
): PublicErrorDefinition {
  const code = (error.code ?? "").toUpperCase();
  if (code === "42501" || code === "PGRST301") {
    return {
      code: "SESSION_EXPIRED",
      message: `Log in again to ${operation} onboarding progress.`,
      details: "The browser copy of your information is unchanged.",
      status: 401,
      retryable: false,
      action: { kind: "navigate", label: "Log in", href: "/login" },
    };
  }
  if (operation === "save" && (code === "23505" || code === "409")) {
    return retryable(
      "DRAFT_SAVE_CONFLICT",
      "A newer onboarding draft already exists.",
      "Reload the saved draft before making more changes.",
      409,
    );
  }
  return retryable(
    operation === "load" ? "DRAFT_LOAD_FAILED" : "DRAFT_SAVE_FAILED",
    operation === "load"
      ? "Onboarding progress could not be loaded."
      : "Onboarding progress could not be saved.",
    operation === "load"
      ? "Retry before relying on previously saved server progress."
      : "Your browser copy is unchanged. Check the connection and try again.",
    503,
  );
}

export function onboardingTransportError(operation: "load" | "save" | "complete") {
  return retryable(
    operation === "complete" ? "ONBOARDING_NETWORK_ERROR" : "ONBOARDING_SERVICE_UNAVAILABLE",
    "Onboarding services could not be reached.",
    operation === "complete"
      ? "The final step was not confirmed. Your information remains in this browser."
      : "Check the connection and try again; your browser copy is unchanged.",
  );
}
