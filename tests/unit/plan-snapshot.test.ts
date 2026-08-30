import { describe, expect, it } from "vitest";
import {
  readPlanSnapshotRange,
  readPlanSnapshotWeight,
} from "../../src/lib/plan-snapshot";

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

describe("plan input snapshot ranges", () => {
  it("reads valid deterministic nutrition ranges", () => {
    const snapshot = {
      deterministicRanges: {
        energyKcal: { minimum: 1_800, maximum: 2_100 },
        proteinGrams: { minimum: 95, maximum: 130 },
      },
    };

    expect(readPlanSnapshotRange(snapshot, "energyKcal")).toEqual({
      minimum: 1_800,
      maximum: 2_100,
    });
    expect(readPlanSnapshotRange(snapshot, "proteinGrams")).toEqual({
      minimum: 95,
      maximum: 130,
    });
  });

  it.each([
    {},
    { deterministicRanges: null },
    { deterministicRanges: { energyKcal: null } },
    { deterministicRanges: { energyKcal: { minimum: -1, maximum: 2_100 } } },
    { deterministicRanges: { energyKcal: { minimum: 2_100, maximum: 1_800 } } },
    { deterministicRanges: { energyKcal: { minimum: "1800", maximum: 2_100 } } },
    {
      deterministicRanges: {
        energyKcal: { minimum: 1_800, maximum: Number.POSITIVE_INFINITY },
      },
    },
  ])("rejects an invalid or legacy range snapshot", (snapshot) => {
    expect(readPlanSnapshotRange(snapshot, "energyKcal")).toBeNull();
  });
});
