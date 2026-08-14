import type { FoodNutritionFacts } from "@/src/lib/domain/food-catalog";

export type ExternalFoodProvider = "usda_fdc" | "open_food_facts";

export type ExternalFoodCandidate = {
  provider: ExternalFoodProvider;
  externalId: string;
  displayName: string;
  brandName: string | null;
  productName: string;
  variantName: string | null;
  gtin: string | null;
  dataType: string | null;
  packageDescription?: string | null;
  sourceVersion?: string | null;
  imageUrl: string | null;
  nutritionImageUrl: string | null;
  nutritionReferenceUnit: "g" | "ml" | "unknown";
  nutritionPreview: {
    calories: number | null;
    proteinGrams: number | null;
    carbohydrateGrams: number | null;
    fatGrams: number | null;
  };
};

export type ExternalFoodProviderStatus = {
  provider: ExternalFoodProvider;
  status: "ok" | "unavailable" | "rate_limited";
  resultCount: number;
  message: string | null;
  retryAfterSeconds?: number | null;
};

export type NormalizedExternalFood = {
  provider: ExternalFoodProvider;
  externalId: string;
  food: {
    slug: string;
    english_name: string;
    food_kind: "generic" | "branded_product";
    brand_name: string | null;
    product_name: string | null;
    variant_name: string | null;
    manufacturer_name: string | null;
    gtin: string | null;
    package_description: string | null;
    country_codes: string[];
    ingredients_text: string | null;
    allergen_statement: string | null;
    category_slugs: string[];
  };
  nutrition: Omit<FoodNutritionFacts, "id" | "verification_status"> & {
    verification_status?: never;
  };
  sourceMetadata: {
    source_name: string;
    source_reference: string;
    source_url: string;
    source_version: string;
    license_code: string;
    attribution_text: string;
    source_modified_at: string | null;
    parser_version: string;
    payload_sha256: string;
  };
  snapshot: Record<string, unknown>;
};

export class ExternalFoodError extends Error {
  constructor(
    readonly code:
      | "provider_unavailable"
      | "not_found"
      | "incomplete_nutrition"
      | "unsupported_reference_unit"
      | "ambiguous_reference_unit"
      | "invalid_response"
      | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "ExternalFoodError";
  }
}

export function normalizedExternalSlug(
  value: string,
  provider: ExternalFoodProvider,
  externalId: string,
) {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
    .replace(/-$/g, "");
  const source = provider === "usda_fdc" ? "fdc" : "off";
  const suffix = externalId.replace(/[^a-zA-Z0-9]/g, "").slice(-18);
  return `${base || "food"}-${source}-${suffix}`.slice(0, 100);
}

export function digitsOnly(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function inferCategorySlugs(text: string): string[] {
  const normalized = text.toLocaleLowerCase("en-US");
  const result = new Set<string>();
  if (/\b(protein|whey|beef|chicken|pork|fish|shrimp|egg|tofu)\b/.test(normalized)) {
    result.add("protein");
  }
  if (/\b(whey|powder|supplement|vitamin|protein mix)\b/.test(normalized)) {
    result.add("supplement");
  }
  if (/\b(milk|yogurt|cheese|dairy)\b/.test(normalized)) result.add("dairy");
  if (
    /\b(vegetables?|asparagus|artichokes?|beets?|broccoli|brussels? sprouts?|cabbage|carrots?|cauliflower|celery|chard|collard greens?|cucumbers?|eggplants?|green beans?|kale|leeks?|lettuce|mushrooms?|okra|onions?|peas?|peppers?|radishes?|spinach|squash|tomatoes?|turnips?|zucchini)\b/.test(
      normalized,
    )
  ) {
    result.add("vegetable");
  }
  if (/\b(fruit|berry|banana|apple|orange)\b/.test(normalized)) result.add("fruit");
  if (/\b(oat|rice|bread|potato|pasta|cereal|carbohydrate)\b/.test(normalized)) {
    result.add("carbohydrate");
  }
  if (/\b(oil|butter|fat|nuts?)\b/.test(normalized)) result.add("fat");
  return [...result];
}
