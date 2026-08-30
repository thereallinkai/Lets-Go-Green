import { describe, expect, it } from "vitest";

import { decidePlanGenerationReplay } from "../../src/lib/domain/idempotency";

describe("plan generation replay decisions", () => {
  it("distinguishes successful, active, and failed generation replays", () => {
    expect(
      decidePlanGenerationReplay({
        status: "succeeded",
        planId: "plan-1",
      }),
    ).toEqual({ action: "return_plan", planId: "plan-1" });
    expect(
      decidePlanGenerationReplay({
        status: "processing",
        planId: null,
      }),
    ).toEqual({ action: "wait" });
    expect(
      decidePlanGenerationReplay({
        status: "failed",
        planId: null,
      }),
    ).toEqual({ action: "retry_with_new_key" });
    expect(
      decidePlanGenerationReplay({
        status: "succeeded",
        planId: null,
      }),
    ).toEqual({ action: "invalid_terminal_state" });
  });
});
