import { describe, expect, it } from "vitest";
import { readPlanSnapshotWeight } from "../../src/lib/plan-snapshot";

describe("plan input snapshot weights", () => {
  it("reads the immutable start and target weights from a generated plan", () => {
    const snapshot = {
      profile: {
        startWeightKg: 82.4,
        targetWeightKg: 74,
      },
    };

    expect(readPlanSnapshotWeight(snapshot, "startWeightKg")).toBe(82.4);
    expect(readPlanSnapshotWeight(snapshot, "targetWeightKg")).toBe(74);
  });

  it.each([
    [{}, "startWeightKg"],
    [{ profile: null }, "startWeightKg"],
    [{ profile: { startWeightKg: "82" } }, "startWeightKg"],
    [{ profile: { startWeightKg: 0 } }, "startWeightKg"],
    [{ profile: { startWeightKg: -1 } }, "startWeightKg"],
    [{ profile: { startWeightKg: 19.999 } }, "startWeightKg"],
    [{ profile: { startWeightKg: 500.001 } }, "startWeightKg"],
    [{ profile: { startWeightKg: Number.POSITIVE_INFINITY } }, "startWeightKg"],
  ] as const)("rejects an unsafe or legacy snapshot", (snapshot, key) => {
    expect(readPlanSnapshotWeight(snapshot, key)).toBeNull();
  });
});
