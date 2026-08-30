import { describe, expect, it } from "vitest";

import {
  KILOGRAM_TO_POUND,
  kilogramsToPounds,
  poundsToKilograms,
} from "../../src/lib/domain/units";

describe("weight units", () => {
  it("uses the required exact conversion factor", () => {
    expect(KILOGRAM_TO_POUND).toBe(2.2046226218);
    expect(kilogramsToPounds(1)).toBe(2.2046226218);
  });

  it("converts pounds back to kilograms without display rounding", () => {
    expect(poundsToKilograms(220.46226218)).toBeCloseTo(100, 12);
  });

  it("rejects non-finite values", () => {
    expect(() => kilogramsToPounds(Number.NaN)).toThrow(/finite/);
  });
});
