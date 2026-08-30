import {
  addLocalDays,
  daysBetweenLocalDates,
  enumerateLocalDates,
} from "./dates";

export interface WeightEntry {
  localDate: string;
  weightKg: number;
}

export interface RollingAveragePoint {
  localDate: string;
  weightKg: number | null;
  rollingAverageKg: number | null;
  observationCount: number;
}

function entryMap(entries: readonly WeightEntry[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const entry of entries) {
    // The date parser is exercised by date arithmetic.
    daysBetweenLocalDates(entry.localDate, entry.localDate);
    if (!Number.isFinite(entry.weightKg) || entry.weightKg <= 0) {
      throw new RangeError("Weight entries must contain positive finite values.");
    }
    result.set(entry.localDate, entry.weightKg);
  }
  return result;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildSevenDayRollingAverageSeries(
  entries: readonly WeightEntry[],
  range?: { startDate: string; endDate: string },
): RollingAveragePoint[] {
  if (entries.length === 0 && !range) return [];
  const values = entryMap(entries);
  const sortedDates = [...values.keys()].sort();
  const startDate = range?.startDate ?? sortedDates[0];
  const endDate = range?.endDate ?? sortedDates[sortedDates.length - 1];

  return enumerateLocalDates(startDate, endDate).map((localDate) => {
    const windowDates = enumerateLocalDates(addLocalDays(localDate, -6), localDate);
    const observed = windowDates.flatMap((date) => {
      const value = values.get(date);
      return value === undefined ? [] : [value];
    });
    return {
      localDate,
      weightKg: values.get(localDate) ?? null,
      rollingAverageKg:
        observed.length === 7 ? average(observed) : null,
      observationCount: observed.length,
    };
  });
}
