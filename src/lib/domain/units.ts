export const KILOGRAM_TO_POUND = 2.2046226218 as const;

export type WeightUnit = "kg" | "lb";

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number.`);
  }
}

export function kilogramsToPounds(kilograms: number): number {
  assertFinite(kilograms, "Kilograms");
  return kilograms * KILOGRAM_TO_POUND;
}

export function poundsToKilograms(pounds: number): number {
  assertFinite(pounds, "Pounds");
  return pounds / KILOGRAM_TO_POUND;
}

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) {
    assertFinite(value, "Weight");
    return value;
  }
  return from === "kg" ? kilogramsToPounds(value) : poundsToKilograms(value);
}
