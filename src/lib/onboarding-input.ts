import { poundsToKilograms } from "@/src/lib/domain/units";

const LEGACY_FOOD_SLUGS: Readonly<Record<string, string>> = {
  "vegetable-vitamin-powder": "vegetable-or-vitamin-powder",
};

export type ParsedOptionalHeight =
  | { ok: true; heightCm: number | null }
  | { ok: false; heightCm: null };

export type ParsedWeight =
  | { ok: true; weightKg: number }
  | { ok: false; weightKg: null };

function validHeightCm(heightCm: number) {
  return Number.isFinite(heightCm) && heightCm >= 50 && heightCm <= 300;
}

function acceptedHeight(heightCm: number): ParsedOptionalHeight {
  if (!validHeightCm(heightCm)) return { ok: false, heightCm: null };
  return { ok: true, heightCm: Math.round(heightCm * 100) / 100 };
}

/**
 * Accepts an optional metric height plus common explicit imperial formats.
 * Plain numbers are centimeters; imperial values must include ft/in markers.
 */
export function parseOptionalHeight(value: string): ParsedOptionalHeight {
  const input = value.trim();
  if (!input) return { ok: true, heightCm: null };

  const centimeters = input.match(
    /^(\d+(?:\.\d+)?)\s*(?:cm|centimeters?|centimetres?)?$/i,
  );
  if (centimeters) return acceptedHeight(Number(centimeters[1]));

  const feetAndInches = input.match(
    /^(\d+)\s*(?:ft|feet|foot|'|′)\s*(\d+(?:\.\d+)?)?\s*(?:in|inches?|inch|"|″)?$/i,
  );
  if (feetAndInches) {
    const feet = Number(feetAndInches[1]);
    const inches = feetAndInches[2] ? Number(feetAndInches[2]) : 0;
    if (!Number.isInteger(feet) || inches < 0 || inches >= 12) {
      return { ok: false, heightCm: null };
    }
    return acceptedHeight((feet * 12 + inches) * 2.54);
  }

  const decimalFeet = input.match(
    /^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)$/i,
  );
  if (decimalFeet) return acceptedHeight(Number(decimalFeet[1]) * 30.48);

  const inchesOnly = input.match(
    /^(\d+(?:\.\d+)?)\s*(?:in|inches?|inch|"|″)$/i,
  );
  if (inchesOnly) return acceptedHeight(Number(inchesOnly[1]) * 2.54);

  return { ok: false, heightCm: null };
}

/**
 * Parses the reviewed weight string using the reviewed display unit.
 * The server uses this result instead of trusting a separately supplied
 * converted value.
 */
export function parseWeightKg(
  value: string,
  unit: "kg" | "lb",
): ParsedWeight {
  const input = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(input)) {
    return { ok: false, weightKg: null };
  }
  const displayedWeight = Number(input);
  const weightKg =
    unit === "kg" ? displayedWeight : poundsToKilograms(displayedWeight);
  if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 500) {
    return { ok: false, weightKg: null };
  }
  return {
    ok: true,
    weightKg: Math.round(weightKg * 1_000) / 1_000,
  };
}

function normalizeFoodSlug(slug: string) {
  return LEGACY_FOOD_SLUGS[slug] ?? slug;
}

export function normalizeMealFoodSlugs(slugs: string[]) {
  return [...new Set(slugs.map(normalizeFoodSlug))];
}
