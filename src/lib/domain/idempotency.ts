export type PlanGenerationRequestStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed";

export type PlanGenerationReplayDecision =
  | { action: "return_plan"; planId: string }
  | { action: "wait" }
  | { action: "retry_with_new_key" }
  | { action: "invalid_terminal_state" };

export function decidePlanGenerationReplay(input: {
  status: PlanGenerationRequestStatus;
  planId: string | null;
}): PlanGenerationReplayDecision {
  if (input.status === "pending" || input.status === "processing") {
    return { action: "wait" };
  }
  if (input.status === "failed") {
    return { action: "retry_with_new_key" };
  }
  if (input.planId) {
    return { action: "return_plan", planId: input.planId };
  }
  return { action: "invalid_terminal_state" };
}
