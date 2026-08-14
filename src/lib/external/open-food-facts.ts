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

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return null;
}

function openFoodFactsImageUrl(...values: unknown[]): string | null {
  const candidate = firstText(...values);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    return url.protocol === "https:" &&
      (hostname === "openfoodfacts.org" ||
        hostname.endsWith(".openfoodfacts.org"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function nutrient(nutriments: UnknownRecord, key: string): number | null {
  return finiteNumber(nutriments[`${key}_100g`]);
}

function modifiedVersion(value: unknown): string | null {
  const timestamp = finiteNumber(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const NORMALIZED_WEIGHT_NUTRIENT_CODES = new Set([
  "added-sugars",
  "alpha-linolenic-acid",
  "beta-carotene",
  "bicarbonate",
  "biotin",
  "caffeine",
  "calcium",
  "carbohydrates",
  "casein",
  "chloride",
  "cholesterol",
  "chromium",
  "copper",
  "dha",
  "epa",
  "erythritol",
  "fat",
  "fiber",
  "fluoride",
  "fructose",
  "glucose",
  "insoluble-fiber",
  "iodine",
  "iron",
  "lactose",
  "magnesium",
  "maltodextrins",
  "manganese",
  "molybdenum",
  "monounsaturated-fat",
  "nucleotides",
  "omega-3-fat",
  "omega-6-fat",
  "omega-9-fat",
  "pantothenic-acid",
  "phosphorus",
  "polyols",
  "polyunsaturated-fat",
  "potassium",
  "proteins",
  "salt",
  "saturated-fat",
  "selenium",
  "serum-proteins",
  "silica",
  "sodium",
  "soluble-fiber",
  "starch",
  "sucrose",
  "sugars",
  "taurine",
  "trans-fat",
  "vitamin-a",
  "vitamin-b1",
  "vitamin-b2",
  "vitamin-b6",
  "vitamin-b9",
  "vitamin-b12",
  "vitamin-c",
  "vitamin-d",
  "vitamin-e",
  "vitamin-k",
  "vitamin-pp",
  "zinc",
]);

function canonicalNutrientUnit(
  key: string,
  contributorUnit: unknown,
): string | null {
  if (key === "energy-kcal") return "kcal";
  if (key === "energy" || key === "energy-kj") return "kJ";
  if (key === "alcohol") return "% vol";
  if (NORMALIZED_WEIGHT_NUTRIENT_CODES.has(key)) return "g";
  const rawUnit = text(contributorUnit)
    ?.toLocaleLowerCase("en-US")
    .replace(/[µμ]/g, "u")
    .replace(/[._\s-]/g, "");
  if (rawUnit) {
    return /^(?:g|gram|grams|mg|milligram|milligrams|ug|mcg|microgram|micrograms|ng|nanogram|nanograms)$/.test(
      rawUnit,
    )
      ? "g"
      : null;
  }
  return null;
}

function convertedNutrient(
  nutriments: UnknownRecord,
  key: string,
  target: "mg" | "mcg",
): number | null {
  const value = nutrient(nutriments, key);
  if (value === null) return null;
  // Open Food Facts normalizes every weight-based `<nutrient>_100g` value to
  // grams. `<nutrient>_unit` describes the contributor's raw entry and must
  // not be applied to the already-normalized value.
  return target === "mg" ? value * 1_000 : value * 1_000_000;
}

function quantityReferenceUnit(value: unknown): "g" | "ml" | null {
  const normalized = text(value)
    ?.toLocaleLowerCase("en-US")
    .replace(/µ/g, "u")
    .replace(/\./g, "");
  if (!normalized) return null;
  if (
    /^(?:ml|milliliters?|millilitres?|cl|centiliters?|centilitres?|l|liters?|litres?)$/.test(
      normalized,
    ) ||
    /\b(?:ml|milliliters?|millilitres?|cl|centiliters?|centilitres?|l|liters?|litres?|fl\s*oz|fluid\s+ounces?)\b/.test(
      normalized,
    )
  ) {
    return "ml";
  }
  if (
    /^(?:g|grams?|kg|kilograms?|oz|ounces?|lb|lbs|pounds?)$/.test(normalized) ||
    /\b(?:g|grams?|kg|kilograms?|oz|ounces?|lb|lbs|pounds?)\b/.test(normalized)
  ) {
    return "g";
  }
  return null;
}

function nutritionReferenceUnit(
  product: UnknownRecord,
): "g" | "ml" | "unknown" {
  // Open Food Facts uses the historical `100g` nutrition_data_per token for
  // both 100 g solids and 100 mL liquids, so it cannot disambiguate the basis.
  // Require all recognized package/serving hints to agree and fail closed when
  // no dimensional hint exists.
  const hints = new Set(
    [
      product.product_quantity_unit,
      product.serving_quantity_unit,
      product.quantity,
      product.serving_size,
    ].flatMap((value) => {
      const unit = quantityReferenceUnit(value);
      return unit ? [unit] : [];
    }),
  );
  return hints.size === 1 ? [...hints][0]! : "unknown";
}

function ensureCoreNutrition(nutriments: UnknownRecord) {
  const energyKilojoules = nutrient(nutriments, "energy-kj");
  const calories =
    nutrient(nutriments, "energy-kcal") ??
    (energyKilojoules === null ? null : energyKilojoules / 4.184);
  const protein = nutrient(nutriments, "proteins");
  const carbohydrate = nutrient(nutriments, "carbohydrates");
  const fat = nutrient(nutriments, "fat");
  if ([calories, protein, carbohydrate, fat].some((value) => value === null)) {
    throw new ExternalFoodError(
      "incomplete_nutrition",
      "Open Food Facts does not provide all four core nutrition values for this product.",
    );
  }
  return {
    calories: calories!,
    protein: protein!,
    carbohydrate: carbohydrate!,
    fat: fat!,
  };
}

function dynamicNutrients(nutriments: UnknownRecord) {
  const seen = new Set<string>();
  return Object.entries(nutriments).flatMap(([key, raw], index) => {
    if (!key.endsWith("_100g") || key.includes("_prepared_")) return [];
    const amount = finiteNumber(raw);
    if (amount === null) return [];
    const code = key.slice(0, -5).replace(/_/g, "-");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || seen.has(code)) return [];
    const unit = canonicalNutrientUnit(
      code,
      nutriments[`${key.slice(0, -5)}_unit`],
    );
    if (!unit) return [];
    seen.add(code);
    return [
      {
        code: `off-${code}`,
        name: code
          .split("-")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        amount,
        unit,
        daily_value_percent: null,
        display_order: index,
      },
    ];
  });
}

export function openFoodFactsCandidateFromProduct(
  barcode: string,
  rawProduct: unknown,
): ExternalFoodCandidate {
  const product = record(rawProduct);
  const productName =
    firstText(
      product.product_name_en,
      product.product_name,
      product.generic_name_en,
      product.generic_name,
    ) ??
    "Unnamed packaged food";
  const brandName = firstText(product.brands, product.brand_owner);
  const nutriments = record(product.nutriments);
  return {
    provider: "open_food_facts",
    externalId: barcode,
    displayName: brandName ? `${brandName} — ${productName}` : productName,
    brandName,
    productName,
    variantName: null,
    gtin: barcode,
    dataType: "Open Food Facts product",
    packageDescription: text(product.quantity),
    sourceVersion: modifiedVersion(product.last_modified_t),
    imageUrl: openFoodFactsImageUrl(
      product.image_front_small_url,
      product.image_front_url,
    ),
    nutritionImageUrl: openFoodFactsImageUrl(
      product.image_nutrition_small_url,
      product.image_nutrition_url,
    ),
    nutritionReferenceUnit: nutritionReferenceUnit(product),
    nutritionPreview: {
      calories:
        nutrient(nutriments, "energy-kcal") ??
        (() => {
          const energyKilojoules = nutrient(nutriments, "energy-kj");
          return energyKilojoules === null ? null : energyKilojoules / 4.184;
        })(),
      proteinGrams: nutrient(nutriments, "proteins"),
      carbohydrateGrams: nutrient(nutriments, "carbohydrates"),
      fatGrams: nutrient(nutriments, "fat"),
    },
  };
}

export async function searchOpenFoodFactsProducts(
  query: string,
  options: {
    userAgent: string;
    fetcher?: typeof fetch;
  },
): Promise<ExternalFoodCandidate[]> {
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  if (normalizedQuery.length < 2 || normalizedQuery.length > 120) {
    throw new ExternalFoodError(
      "not_found",
      "Enter between 2 and 120 characters to search packaged products.",
    );
  }

  // Open Food Facts documents full-text search through its legacy CGI search
  // route. The caller must gate this behind an explicit user action and cache
  // repeated queries because the provider rate-limits search traffic.
  const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  url.searchParams.set("search_terms", normalizedQuery);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", "10");
  url.searchParams.set(
    "fields",
    [
      "code",
      "product_name",
      "product_name_en",
      "generic_name",
      "generic_name_en",
      "brands",
      "brand_owner",
      "quantity",
      "product_quantity_unit",
      "serving_size",
      "serving_quantity_unit",
      "nutrition_data_per",
      "last_modified_t",
      "image_front_small_url",
      "image_front_url",
      "image_nutrition_small_url",
      "image_nutrition_url",
      "nutriments",
    ].join(","),
  );

  const payload = await fetchProviderJson(url, options);
  const products = Array.isArray(payload.products) ? payload.products : [];
  const byBarcode = new Map<string, ExternalFoodCandidate>();
  for (const raw of products) {
    const product = record(raw);
    const barcode = digitsOnly(product.code);
    const productName = firstText(
      product.product_name_en,
      product.product_name,
      product.generic_name_en,
      product.generic_name,
    );
    if (!barcode || !productName) {
      continue;
    }
    const candidate = openFoodFactsCandidateFromProduct(barcode, product);
    const identity = [
      normalizedExternalSlug(candidate.displayName, "open_food_facts", "compare"),
      text(product.quantity) ?? "",
      candidate.nutritionReferenceUnit,
      candidate.nutritionPreview.calories ?? "",
      candidate.nutritionPreview.proteinGrams ?? "",
      candidate.nutritionPreview.carbohydrateGrams ?? "",
      candidate.nutritionPreview.fatGrams ?? "",
    ].join(":");
    if (!byBarcode.has(identity)) byBarcode.set(identity, candidate);
  }
  return [...byBarcode.values()];
}

export async function loadOpenFoodFactsProduct(
  barcodeInput: string,
  options: {
    userAgent: string;
    fetcher?: typeof fetch;
  },
): Promise<NormalizedExternalFood> {
  const requestedBarcode = digitsOnly(barcodeInput);
  if (!requestedBarcode) {
    throw new ExternalFoodError(
      "not_found",
      "Enter an 8- to 14-digit product barcode.",
    );
  }
  const url = new URL(
    `https://world.openfoodfacts.org/api/v3/product/${requestedBarcode}`,
  );
  url.searchParams.set(
    "fields",
    [
      "code",
      "product_name",
      "product_name_en",
      "generic_name_en",
      "brands",
      "brand_owner",
      "quantity",
      "product_quantity_unit",
      "serving_size",
      "serving_quantity",
      "serving_quantity_unit",
      "nutrition_data_per",
      "nutriments",
      "ingredients_text",
      "ingredients_text_en",
      "allergens",
      "allergens_tags",
      "countries_tags",
      "categories_tags",
      "last_modified_t",
    ].join(","),
  );
  const payload = await fetchProviderJson(url, options);
  const product = record(payload.product);
  if (!Object.keys(product).length) {
    throw new ExternalFoodError("not_found", "No product uses that barcode.");
  }
  const barcode = digitsOnly(product.code) ?? requestedBarcode;
  if (barcode !== requestedBarcode) {
    throw new ExternalFoodError(
      "invalid_response",
      "Open Food Facts returned a different product identifier.",
    );
  }
  const candidate = openFoodFactsCandidateFromProduct(barcode, product);
  if (candidate.nutritionReferenceUnit === "ml") {
    throw new ExternalFoodError(
      "unsupported_reference_unit",
      "This liquid product is reported per 100 mL, which cannot be imported into gram-based plan math safely.",
    );
  }
  if (candidate.nutritionReferenceUnit === "unknown") {
    throw new ExternalFoodError(
      "ambiguous_reference_unit",
      "Open Food Facts does not identify whether this product's normalized nutrition is per 100 g or per 100 mL.",
    );
  }
  const nutriments = record(product.nutriments);
  const core = ensureCoreNutrition(nutriments);
  const brandName = candidate.brandName ?? "Brand not provided";
  const productName = candidate.productName;
  const sourceUrl = `https://world.openfoodfacts.org/product/${barcode}`;
  const lastModified = finiteNumber(product.last_modified_t);
  const sourceModifiedAt =
    lastModified === null
      ? null
      : new Date(lastModified * 1_000).toISOString();
  const categorySlugs = inferCategorySlugs(
    `${productName} ${stringArray(product.categories_tags).join(" ")}`,
  );
  const allergenTags = stringArray(product.allergens_tags);
  const allergenStatement =
    text(product.allergens) ??
    (allergenTags.length
      ? allergenTags.join(", ")
      : "Open Food Facts did not provide a complete package allergen statement.");

  return {
    provider: "open_food_facts",
    externalId: barcode,
    food: {
      slug: normalizedExternalSlug(productName, "open_food_facts", barcode),
      english_name: `${brandName} — ${productName}`.slice(0, 160),
      food_kind: "branded_product",
      brand_name: brandName,
      product_name: productName,
      variant_name: null,
      manufacturer_name: text(product.brand_owner),
      gtin: candidate.gtin,
      package_description: text(product.quantity),
      country_codes: stringArray(product.countries_tags)
        .map((country) => country.replace(/^[a-z]{2}:/, ""))
        .slice(0, 40),
      ingredients_text: firstText(
        product.ingredients_text_en,
        product.ingredients_text,
      ),
      allergen_statement: allergenStatement,
      category_slugs: categorySlugs,
    },
    nutrition: {
      measurement_basis: "as_sold",
      reference_quantity: 100,
      reference_unit: "g",
      serving_weight_grams: null,
      serving_description: text(product.serving_size),
      calories: core.calories,
      energy_kj: nutrient(nutriments, "energy-kj"),
      protein_g: core.protein,
      carbohydrate_g: core.carbohydrate,
      fat_g: core.fat,
      fiber_g: nutrient(nutriments, "fiber"),
      sodium_mg: convertedNutrient(nutriments, "sodium", "mg"),
      saturated_fat_g: nutrient(nutriments, "saturated-fat"),
      trans_fat_g: nutrient(nutriments, "trans-fat"),
      total_sugars_g: nutrient(nutriments, "sugars"),
      added_sugars_g: nutrient(nutriments, "added-sugars"),
      cholesterol_mg: convertedNutrient(nutriments, "cholesterol", "mg"),
      potassium_mg: convertedNutrient(nutriments, "potassium", "mg"),
      calcium_mg: convertedNutrient(nutriments, "calcium", "mg"),
      iron_mg: convertedNutrient(nutriments, "iron", "mg"),
      vitamin_d_mcg: convertedNutrient(nutriments, "vitamin-d", "mcg"),
      nutrients: dynamicNutrients(nutriments),
    },
    sourceMetadata: {
      source_name: "Open Food Facts",
      source_reference: `Open Food Facts barcode ${barcode}: ${productName}`,
      source_url: sourceUrl,
      source_version: "Open Food Facts product API v3",
      license_code: "ODbL-1.0",
      attribution_text:
        "Product data from Open Food Facts, available under the Open Database License.",
      source_modified_at: sourceModifiedAt,
      parser_version: EXTERNAL_FOOD_PARSER_VERSION,
      payload_sha256: payloadSha256(payload),
    },
    snapshot: payload,
  };
}
