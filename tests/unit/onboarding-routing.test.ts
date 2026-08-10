import { describe, expect, it } from "vitest";
import { normalizeOnboardingStep } from "../../src/lib/onboarding-routing";

describe("onboarding URL routing", () => {
  it.each([
    ["2", 2],
    ["3", 3],
    ["4", 4],
    ["5", 5],
    ["6", 6],
  ])("keeps supported integer step %s", (input, expected) => {
    expect(normalizeOnboardingStep(input)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    "",
    "NaN",
    "Infinity",
    "3.5",
    " 3",
    "3 ",
    "1",
    "7",
    "-4",
    ["3", "4"],
  ])("maps malformed or unsupported value %j to step 2", (input) => {
    const result = normalizeOnboardingStep(input);

    expect(result).toBe(2);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(6);
  });
});
