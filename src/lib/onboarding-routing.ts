export type OnboardingStep = 2 | 3 | 4 | 5 | 6;

/**
 * Treat the URL as untrusted input. Only the five routable onboarding steps
 * are accepted; every malformed, fractional, or out-of-range value starts at
 * the verification step instead of putting the client flow into an invalid
 * numeric state.
 */
export function normalizeOnboardingStep(value: unknown): OnboardingStep {
  if (typeof value !== "string" || !/^[2-6]$/.test(value)) return 2;
  return Number(value) as OnboardingStep;
}
