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
