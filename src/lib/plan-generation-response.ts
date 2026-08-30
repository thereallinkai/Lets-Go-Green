const TERMINAL_ERROR_CODES = new Set([
  "CATALOG_LOAD_FAILED",
  "GOAL_DIRECTION_CONFLICT",
  "INSUFFICIENT_ELIGIBLE_FOODS",
  "PLAN_GENERATION_FAILED",
  "PLAN_PERSISTENCE_FAILED",
  "PLAN_REQUEST_FAILED",
  "PLAN_REQUEST_INVALID_STATE",
  "PROFILE_DATA_LOAD_FAILED",
  "PROFILE_HEIGHT_REQUIRED",
  "PROVIDER_OUTPUT_REJECTED",
  "TRUSTED_PROFILE_INCOMPLETE",
]);

export type PlanGenerationResponseDecision =
  | { kind: "succeeded"; planId: string }
  | { kind: "pending" }
  | { kind: "terminal_failure" }
  | { kind: "ambiguous_failure" };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Classifies plan-generation responses without exposing provider details.
 * Ambiguous outcomes retain the idempotency key so a retry cannot create a
 * duplicate plan request; explicit terminal failures may safely use a new key.
 */
export function interpretPlanGenerationResponse(input: {
  ok: boolean;
  status?: number;
  payload: unknown;
}): PlanGenerationResponseDecision {
  const envelope = object(input.payload);
  const data = object(envelope?.data);
  const error = object(envelope?.error);
  const errorCode =
    typeof error?.code === "string" ? error.code.trim() : "";

  if (!input.ok) {
    return TERMINAL_ERROR_CODES.has(errorCode)
      ? { kind: "terminal_failure" }
      : { kind: "ambiguous_failure" };
  }

  const requestStatus =
    typeof data?.status === "string" ? data.status.trim() : "";
  if (
    input.status === 202 ||
    requestStatus === "pending" ||
    requestStatus === "processing"
  ) {
    return { kind: "pending" };
  }
  if (requestStatus === "failed") return { kind: "terminal_failure" };

  const planId = typeof data?.planId === "string" ? data.planId.trim() : "";
  return planId
    ? { kind: "succeeded", planId }
    : { kind: "ambiguous_failure" };
}
