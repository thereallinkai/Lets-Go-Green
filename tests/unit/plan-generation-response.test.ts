import { describe, expect, it } from "vitest";
import { interpretPlanGenerationResponse } from "../../src/lib/plan-generation-response";

describe("plan generation response interpretation", () => {
  it("returns a persisted plan identifier for a successful response", () => {
    expect(
      interpretPlanGenerationResponse({
        ok: true,
        status: 201,
        payload: { data: { planId: " plan-1 ", status: "generated" } },
      }),
    ).toEqual({ kind: "succeeded", planId: "plan-1" });
  });

  it.each([
    [202, { data: { status: "processing" } }],
    [200, { data: { status: "pending" } }],
  ])("recognizes an active request", (status, payload) => {
    expect(
      interpretPlanGenerationResponse({ ok: true, status, payload }),
    ).toEqual({ kind: "pending" });
  });

  it.each([
    "PLAN_REQUEST_FAILED",
    "PLAN_REQUEST_INVALID_STATE",
    "GOAL_DIRECTION_CONFLICT",
    "PROFILE_HEIGHT_REQUIRED",
    "PLAN_GENERATION_FAILED",
  ])("recognizes terminal error %s", (code) => {
    expect(
      interpretPlanGenerationResponse({
        ok: false,
        status: 500,
        payload: { error: { code } },
      }),
    ).toEqual({ kind: "terminal_failure" });
  });

  it.each([
    { ok: false, status: 503, payload: null },
    {
      ok: false,
      status: 503,
      payload: { error: { code: "PLAN_REQUEST_RESERVATION_FAILED" } },
    },
    { ok: true, status: 201, payload: { data: { planId: null } } },
  ])("retains the request key for an ambiguous outcome", (input) => {
    expect(interpretPlanGenerationResponse(input)).toEqual({
      kind: "ambiguous_failure",
    });
  });
});
