export const MEASUREMENT_BASES = [
  "raw",
  "dry",
  "cooked",
  "as_sold",
  "label_serving",
] as const;
export type MeasurementBasis = (typeof MEASUREMENT_BASES)[number];
export type NutritionUnit = "g" | "serving";
export type NutritionVerificationStatus =
  | "verified"
  | "user_label"
  | "source_reported"
  | "pending_verification"
  | "unavailable";

type NutrientKey =
  | "calories"
  | "proteinGrams"
  | "carbohydrateGrams"
  | "fatGrams"
  | "fiberGrams"
  | "sodiumMilligrams";

export interface NutritionRecord {
  foodId: string;
  measurementBasis: MeasurementBasis;
  referenceQuantity: number;
  referenceUnit: NutritionUnit;
  calories: number | null;
  proteinGrams: number | null;
  carbohydrateGrams: number | null;
  fatGrams: number | null;
  fiberGrams?: number | null;
  sodiumMilligrams?: number | null;
  verificationStatus: NutritionVerificationStatus;
  sourceName?: string;
  sourceReference?: string;
}

export interface NutritionItem {
  foodId: string;
  quantity: number;
  unit: NutritionUnit;
  measurementBasis: MeasurementBasis;
}

type NutritionTotals = Record<NutrientKey, number | null>;

export interface NutritionAggregation {
  totals: NutritionTotals;
  pendingNutrients: NutrientKey[];
  itemCount: number;
  hasPendingVerification: boolean;
}

export class NutritionAggregationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "missing_record"
      | "measurement_basis_mismatch"
      | "unit_mismatch"
      | "ambiguous_record"
      | "invalid_quantity",
    readonly foodId: string,
  ) {
    super(message);
    this.name = "NutritionAggregationError";
  }
}

const NUTRIENT_KEYS: readonly NutrientKey[] = [
  "calories",
  "proteinGrams",
  "carbohydrateGrams",
  "fatGrams",
  "fiberGrams",
  "sodiumMilligrams",
];

function emptyTotals(): Record<NutrientKey, number> {
  return {
    calories: 0,
    proteinGrams: 0,
    carbohydrateGrams: 0,
    fatGrams: 0,
    fiberGrams: 0,
    sodiumMilligrams: 0,
  };
}

export function aggregateNutrition(
  items: readonly NutritionItem[],
  records: readonly NutritionRecord[],
): NutritionAggregation {
  const knownTotals = emptyTotals();
  const pending = new Set<NutrientKey>();
  let hasPendingVerification = false;

  for (const item of items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new NutritionAggregationError(
        `Nutrition quantity for ${item.foodId} must be positive.`,
        "invalid_quantity",
        item.foodId,
      );
    }
    const foodRecords = records.filter((record) => record.foodId === item.foodId);
    const matching = foodRecords.filter(
      (record) => record.measurementBasis === item.measurementBasis,
    );
    if (matching.length === 0) {
      throw new NutritionAggregationError(
        foodRecords.length > 0
          ? `No ${item.measurementBasis} nutrition record exists for ${item.foodId}.`
          : `No nutrition record exists for ${item.foodId}.`,
        foodRecords.length > 0
          ? "measurement_basis_mismatch"
          : "missing_record",
        item.foodId,
      );
    }
    if (matching.length > 1) {
      throw new NutritionAggregationError(
        `More than one ${item.measurementBasis} nutrition record exists for ${item.foodId}.`,
        "ambiguous_record",
        item.foodId,
      );
    }
    const record = matching[0];
    if (record.referenceUnit !== item.unit) {
      throw new NutritionAggregationError(
        `The ${item.unit} quantity for ${item.foodId} cannot use a ${record.referenceUnit} nutrition reference.`,
        "unit_mismatch",
        item.foodId,
      );
    }
    if (
      !Number.isFinite(record.referenceQuantity) ||
      record.referenceQuantity <= 0
    ) {
      throw new NutritionAggregationError(
        `Nutrition reference quantity for ${item.foodId} must be positive.`,
        "invalid_quantity",
        item.foodId,
      );
    }

    const multiplier = item.quantity / record.referenceQuantity;
    hasPendingVerification ||= !["verified", "user_label"].includes(
      record.verificationStatus,
    );
    for (const key of NUTRIENT_KEYS) {
      const value = record[key] ?? null;
      if (value === null) {
        pending.add(key);
      } else {
        knownTotals[key] += value * multiplier;
      }
    }
  }

  const totals = Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, pending.has(key) ? null : knownTotals[key]]),
  ) as NutritionTotals;
  return {
    totals,
    pendingNutrients: NUTRIENT_KEYS.filter((key) => pending.has(key)),
    itemCount: items.length,
    hasPendingVerification,
  };
}

export function combineNutritionAggregations(
  aggregations: readonly NutritionAggregation[],
): NutritionAggregation {
  const knownTotals = emptyTotals();
  const pending = new Set<NutrientKey>();
  for (const aggregation of aggregations) {
    for (const key of NUTRIENT_KEYS) {
      const value = aggregation.totals[key];
      if (value === null) pending.add(key);
      else knownTotals[key] += value;
    }
  }
  return {
    totals: Object.fromEntries(
      NUTRIENT_KEYS.map((key) => [
        key,
        pending.has(key) ? null : knownTotals[key],
      ]),
    ) as NutritionTotals,
    pendingNutrients: NUTRIENT_KEYS.filter((key) => pending.has(key)),
    itemCount: aggregations.reduce(
      (sum, aggregation) => sum + aggregation.itemCount,
      0,
    ),
    hasPendingVerification: aggregations.some(
      (aggregation) => aggregation.hasPendingVerification,
    ),
  };
}
