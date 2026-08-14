import "server-only";

import {
  ExternalFoodError,
  digitsOnly,
  finiteNumber,
  inferCategorySlugs,
  normalizedExternalSlug,
  type ExternalFoodCandidate,
  type NormalizedExternalFood,
} from "./food-data-types";
import {
  EXTERNAL_FOOD_PARSER_VERSION,
  fetchProviderJson,
  payloadSha256,
} from "./provider-utils";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nutrientRows(food: UnknownRecord) {
  const rows = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  return rows.map((raw) => {
    const row = record(raw);
    const nutrient = record(row.nutrient);
    return {
      id: String(row.nutrientId ?? nutrient.id ?? ""),
      number: String(row.nutrientNumber ?? nutrient.number ?? ""),
      name: text(row.nutrientName ?? nutrient.name) ?? "Nutrient",
      unit: text(row.unitName ?? nutrient.unitName) ?? "unit",
      amount: finiteNumber(row.value ?? row.amount),
    };
  });
}

function nutrientAmount(
  rows: ReturnType<typeof nutrientRows>,
  numbers: readonly string[],
  names: readonly string[] = [],
  units: readonly string[] = [],
) {
  const normalizedNames = names.map((name) => name.toLocaleLowerCase("en-US"));
  const normalizedUnits = units.map((unit) => unit.toLocaleLowerCase("en-US"));
  return (
    rows.find(
      (row) =>
        (!normalizedUnits.length ||
          normalizedUnits.includes(row.unit.toLocaleLowerCase("en-US"))) &&
        (numbers.includes(row.number) ||
          normalizedNames.includes(row.name.toLocaleLowerCase("en-US"))),
    )?.amount ?? null
  );
}

function energyCalories(rows: ReturnType<typeof nutrientRows>) {
  return nutrientAmount(rows, ["1008", "208"], ["Energy"], [
    "kcal",
    "KCAL",
  ]);
}

function energyKilojoules(rows: ReturnType<typeof nutrientRows>) {
  return nutrientAmount(rows, ["1062", "268"], ["Energy"], ["kJ", "KJ"]);
}

function nutrientPreview(food: UnknownRecord) {
  const rows = nutrientRows(food);
  return {
    calories: energyCalories(rows),
    proteinGrams: nutrientAmount(rows, ["1003"], ["Protein"]),
    carbohydrateGrams: nutrientAmount(rows, ["1005"], [
      "Carbohydrate, by difference",
    ]),
    fatGrams: nutrientAmount(rows, ["1004"], ["Total lipid (fat)"]),
  };
}

function normalizedSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function candidateFromSearchFood(raw: unknown): ExternalFoodCandidate | null {
  const food = record(raw);
  const externalId = String(food.fdcId ?? "");
  const productName = text(food.description);
  if (!/^\d+$/.test(externalId) || !productName) return null;
  const brandName = text(food.brandName ?? food.brandOwner);
  return {
    provider: "usda_fdc",
    externalId,
    displayName: brandName ? `${brandName} — ${productName}` : productName,
    brandName,
    productName,
    variantName: null,
    gtin: digitsOnly(food.gtinUpc),
    dataType: text(food.dataType),
    packageDescription: text(food.packageWeight),
    sourceVersion: text(food.publishedDate ?? food.publicationDate),
    imageUrl: null,
    nutritionImageUrl: null,
    nutritionReferenceUnit: "g",
    nutritionPreview: nutrientPreview(food),
  };
}

function nutritionCompleteness(candidate: ExternalFoodCandidate) {
  return Object.values(candidate.nutritionPreview).filter(
    (value) => value !== null,
  ).length;
}

function candidateScore(candidate: ExternalFoodCandidate, query: string) {
  const normalizedQuery = normalizedSearchText(query);
  const product = normalizedSearchText(candidate.productName);
  const searchableName = normalizedSearchText(candidate.displayName);
  const queryTokens = new Set(normalizedQuery.split(" ").filter(Boolean));
  const productTokens = new Set(searchableName.split(" ").filter(Boolean));
  const matchingTokens = [...queryTokens].filter((token) =>
    productTokens.has(token),
  ).length;
  const isGeneric = candidate.brandName === null;
  const firstDescriptionPart = normalizedSearchText(
    candidate.productName.split(",")[0] ?? candidate.productName,
  );

  let score = matchingTokens * 20 + nutritionCompleteness(candidate) * 3;
  if (searchableName === normalizedQuery) score += 120;
  else if (searchableName.startsWith(`${normalizedQuery} `)) score += 70;
  if (product === normalizedQuery) score += 100;
  else if (firstDescriptionPart === normalizedQuery) score += 90;
  else if (product.startsWith(`${normalizedQuery} `)) score += 55;
  else if (product.includes(normalizedQuery)) score += 35;
  if (isGeneric) score += 60;
  if (candidate.dataType === "Foundation") score += 12;
  else if (candidate.dataType === "SR Legacy") score += 8;
  return score;
}

function candidateVersion(candidate: ExternalFoodCandidate) {
  const version = candidate.sourceVersion;
  const timestamp = version
    ? Date.parse(
        /^\d{4}-\d{2}-\d{2}$/.test(version)
          ? `${version}T00:00:00.000Z`
          : version,
      )
    : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function nutritionIdentity(candidate: ExternalFoodCandidate) {
  return Object.values(candidate.nutritionPreview)
    .map((value) => (value === null ? "?" : String(Math.round(value * 1_000))))
    .join(":");
}

function candidateIdentity(candidate: ExternalFoodCandidate) {
  return [
    normalizedSearchText(candidate.brandName ?? "generic"),
    normalizedSearchText(candidate.productName),
    normalizedSearchText(candidate.packageDescription ?? ""),
    nutritionIdentity(candidate),
  ].join("|");
}

function dedupeCandidates(candidates: ExternalFoodCandidate[]) {
  const byIdentity = new Map<string, ExternalFoodCandidate>();
  for (const candidate of candidates) {
    const identity = candidateIdentity(candidate);
    const previous = byIdentity.get(identity);
    if (
      !previous ||
      candidateVersion(candidate) > candidateVersion(previous) ||
      (candidateVersion(candidate) === candidateVersion(previous) &&
        nutritionCompleteness(candidate) > nutritionCompleteness(previous))
    ) {
      byIdentity.set(identity, candidate);
    }
  }
  return [...byIdentity.values()];
}

async function searchUsdaDataTypes(
  query: string,
  dataType: string,
  options: {
    apiKey: string;
    userAgent: string;
    fetcher?: typeof fetch;
  },
) {
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", options.apiKey);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", "15");
  url.searchParams.set("dataType", dataType);
  const payload = await fetchProviderJson(url, options);
  const foods = Array.isArray(payload.foods) ? payload.foods : [];
  return foods.flatMap((raw) => {
    const candidate = candidateFromSearchFood(raw);
    return candidate ? [candidate] : [];
  });
}

function ensureCoreNutrition(
  calories: number | null,
  protein: number | null,
  carbohydrate: number | null,
  fat: number | null,
) {
  if ([calories, protein, carbohydrate, fat].some((value) => value === null)) {
    throw new ExternalFoodError(
      "incomplete_nutrition",
      "USDA does not provide all four core nutrition values for this item.",
    );
  }
  return {
    calories: calories!,
    protein,
    carbohydrate,
    fat,
  };
}

export async function searchUsdaFoods(
  query: string,
  options: {
    apiKey: string;
    userAgent: string;
    fetcher?: typeof fetch;
  },
): Promise<ExternalFoodCandidate[]> {
  // USDA relevance can fill a mixed request with branded records before a
  // canonical generic food appears. Keep the two documented data-type groups
  // separate, then return a small balanced set for comparison.
  const [genericFoods, brandedFoods] = await Promise.all([
    searchUsdaDataTypes(query, "Foundation,SR Legacy", options),
    searchUsdaDataTypes(query, "Branded", options),
  ]);
  const byScore = (left: ExternalFoodCandidate, right: ExternalFoodCandidate) =>
    candidateScore(right, query) - candidateScore(left, query) ||
    right.externalId.localeCompare(left.externalId, "en-US", {
      numeric: true,
    });
  const generic = dedupeCandidates(genericFoods).sort(byScore).slice(0, 4);
  const branded = dedupeCandidates(brandedFoods).sort(byScore).slice(0, 6);
  return dedupeCandidates([...generic, ...branded]).sort(byScore).slice(0, 10);
}

export async function loadUsdaFood(
  fdcId: string,
  options: {
    apiKey: string;
    userAgent: string;
    fetcher?: typeof fetch;
  },
): Promise<NormalizedExternalFood> {
  if (!/^\d{1,18}$/.test(fdcId)) {
    throw new ExternalFoodError("not_found", "The USDA food ID is invalid.");
  }
  const url = new URL(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}`);
  url.searchParams.set("api_key", options.apiKey);
  const payload = await fetchProviderJson(url, options);
  const description = text(payload.description);
  if (!description) {
    throw new ExternalFoodError(
      "invalid_response",
      "USDA returned a food without a description.",
    );
  }

  const rows = nutrientRows(payload);
  const core = ensureCoreNutrition(
    energyCalories(rows),
    nutrientAmount(rows, ["1003"], ["Protein"]),
    nutrientAmount(rows, ["1005"], ["Carbohydrate, by difference"]),
    nutrientAmount(rows, ["1004"], ["Total lipid (fat)"]),
  );
  const brandName = text(payload.brandName ?? payload.brandOwner);
  const dataType = text(payload.dataType);
  const branded = dataType === "Branded" || brandName !== null;
  const sourceUrl = `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${fdcId}/nutrients`;
  const gtin = digitsOnly(payload.gtinUpc);
  const servingSize = finiteNumber(payload.servingSize);
  const servingUnit = text(payload.servingSizeUnit);
  const servingDescription =
    servingSize !== null && servingUnit
      ? `${servingSize} ${servingUnit}`
      : null;
  const displayBrand =
    brandName ?? (branded ? "Brand not provided by USDA" : null);
  const englishName = displayBrand
    ? `${displayBrand} — ${description}`
    : description;
  const publicationDate = text(payload.publicationDate);

  return {
    provider: "usda_fdc",
    externalId: fdcId,
    food: {
      slug: normalizedExternalSlug(description, "usda_fdc", fdcId),
      english_name: englishName.slice(0, 160),
      food_kind: branded ? "branded_product" : "generic",
      brand_name: displayBrand,
      product_name: branded ? description : null,
      variant_name: null,
      manufacturer_name: text(payload.brandOwner),
      gtin,
      package_description: text(payload.packageWeight),
      country_codes: [],
      ingredients_text: text(payload.ingredients),
      allergen_statement:
        text(payload.allergenStatement) ??
        "USDA did not provide a complete package allergen statement.",
      category_slugs: inferCategorySlugs(description),
    },
    nutrition: {
      measurement_basis: "as_sold",
      reference_quantity: 100,
      reference_unit: "g",
      serving_weight_grams: null,
      serving_description: servingDescription,
      calories: core.calories,
      energy_kj: energyKilojoules(rows),
      protein_g: core.protein,
      carbohydrate_g: core.carbohydrate,
      fat_g: core.fat,
      fiber_g: nutrientAmount(rows, ["1079"], [
        "Fiber, total dietary",
      ]),
      sodium_mg: nutrientAmount(rows, ["1093"], ["Sodium, Na"]),
      saturated_fat_g: nutrientAmount(rows, ["1258"], [
        "Fatty acids, total saturated",
      ]),
      trans_fat_g: nutrientAmount(rows, ["1257"], [
        "Fatty acids, total trans",
      ]),
      total_sugars_g: nutrientAmount(rows, ["2000"], [
        "Sugars, total including NLEA",
      ]),
      added_sugars_g: nutrientAmount(rows, ["1235"], [
        "Sugars, added",
      ]),
      cholesterol_mg: nutrientAmount(rows, ["1253"], ["Cholesterol"]),
      potassium_mg: nutrientAmount(rows, ["1092"], ["Potassium, K"]),
      calcium_mg: nutrientAmount(rows, ["1087"], ["Calcium, Ca"]),
      iron_mg: nutrientAmount(rows, ["1089"], ["Iron, Fe"]),
      vitamin_d_mcg: nutrientAmount(rows, ["1114"], [
        "Vitamin D (D2 + D3)",
      ]),
      nutrients: rows.flatMap((row, index) =>
        row.amount === null
          ? []
          : [
              {
                code: `usda-${row.number || row.id || index}`,
                name: row.name,
                amount: row.amount,
                unit: row.unit,
                daily_value_percent: null,
              },
            ],
      ),
    },
    sourceMetadata: {
      source_name: "USDA FoodData Central",
      source_reference: `USDA FDC ID ${fdcId}: ${description}`,
      source_url: sourceUrl,
      source_version: publicationDate
        ? `FoodData Central publication ${publicationDate}`
        : "FoodData Central",
      license_code: "CC0-1.0",
      attribution_text:
        "U.S. Department of Agriculture, Agricultural Research Service, FoodData Central.",
      source_modified_at: publicationDate
        ? new Date(`${publicationDate}T00:00:00.000Z`).toISOString()
        : null,
      parser_version: EXTERNAL_FOOD_PARSER_VERSION,
      payload_sha256: payloadSha256(payload),
    },
    snapshot: payload,
  };
}
