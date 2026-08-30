import type { Json } from "@/src/types/database";

function isJsonObject(
  value: Json | undefined,
): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads an immutable weight captured when a plan was generated.
 *
 * Older plan rows can predate these fields, so callers must retain a legacy
 * fallback. Invalid snapshots are never allowed to replace trusted fallback
 * data in the UI.
 */
export function readPlanSnapshotWeight(
  snapshot: Json,
  key: "startWeightKg" | "targetWeightKg",
) {
  if (!isJsonObject(snapshot) || !isJsonObject(snapshot.profile)) return null;
  const value = snapshot.profile[key];
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 20 &&
    value <= 500
    ? value
    : null;
}

/** Reads a deterministic range captured when a plan was generated. */
export function readPlanSnapshotRange(
  snapshot: Json,
  key: "energyKcal" | "proteinGrams",
): { minimum: number; maximum: number } | null {
  if (!isJsonObject(snapshot)) return null;

  const ranges = snapshot.deterministicRanges;
  if (!isJsonObject(ranges)) return null;

  const candidate = ranges[key];
  if (!isJsonObject(candidate)) return null;

  const minimum = candidate.minimum;
  const maximum = candidate.maximum;
  return typeof minimum === "number" &&
    Number.isFinite(minimum) &&
    minimum >= 0 &&
    typeof maximum === "number" &&
    Number.isFinite(maximum) &&
    maximum >= minimum
    ? { minimum, maximum }
    : null;
}
