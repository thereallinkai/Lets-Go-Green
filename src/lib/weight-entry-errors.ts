import type { PublicErrorDefinition } from "./api-response";

export function isProtectedBaselineError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "23514" &&
    candidate.message === "The onboarding baseline weight is protected."
  );
}

export function weightAuthUnavailable(): PublicErrorDefinition {
  return {
    code: "WEIGHT_AUTH_UNAVAILABLE",
    message: "Your session could not be checked right now.",
    details:
      "No weight information was changed. Check the connection and try again.",
    status: 503,
    retryable: true,
    action: { kind: "retry", label: "Try again" },
  };
}

export function weightProfileUnavailable(): PublicErrorDefinition {
  return {
    code: "WEIGHT_PROFILE_UNAVAILABLE",
    message: "Your profile time zone could not be loaded.",
    details:
      "No weight information was changed. Reload the profile before saving a local-date reading.",
    status: 503,
    retryable: true,
    action: { kind: "retry", label: "Try again" },
  };
}
