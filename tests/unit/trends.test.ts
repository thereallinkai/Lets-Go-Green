import { describe, expect, it } from "vitest";

import { addLocalDays } from "../../src/lib/domain/dates";
import {
  buildSevenDayRollingAverageSeries,
  type WeightEntry,
} from "../../src/lib/domain/trends";

function entries(
  startDate: string,
  weights: readonly number[],
): WeightEntry[] {
  return weights.map((weightKg, index) => ({
    localDate: addLocalDays(startDate, index),
    weightKg,
  }));
}

describe("weight trends", () => {
  it("renders missing dates as gaps rather than zero", () => {
    const series = buildSevenDayRollingAverageSeries(
      [
        { localDate: "2026-07-01", weightKg: 70 },
        { localDate: "2026-07-03", weightKg: 69.5 },
      ],
      { startDate: "2026-07-01", endDate: "2026-07-03" },
    );
    expect(series[1]).toEqual({
      localDate: "2026-07-02",
      weightKg: null,
      rollingAverageKg: null,
      observationCount: 1,
    });
  });

  it("only emits a rolling average for a complete calendar window", () => {
    const series = buildSevenDayRollingAverageSeries(
      entries("2026-07-01", [70, 70, 70, 70, 70, 70, 70]),
    );
    expect(series.slice(0, 6).every((point) => point.rollingAverageKg === null)).toBe(
      true,
    );
    expect(series[6].rollingAverageKg).toBe(70);
  });
});
