import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  authResult: {
    data: {
      user: { id: "11111111-1111-4111-8111-111111111111" } as {
        id: string;
      } | null,
    },
    error: null as {
      code?: string;
      message?: string;
      name?: string;
      status?: number;
    } | null,
  },
  rpc: vi.fn(),
  searchOpenFoodFactsProducts: vi.fn(),
  searchUsdaFoods: vi.fn(),
  loadOpenFoodFactsProduct: vi.fn(),
  loadUsdaFood: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/env", () => ({
  getServerEnv: () => ({
    FOOD_LOOKUP_USER_AGENT: "LetsGoGreen tests@example.invalid",
    USDA_FDC_API_KEY: "fixture-key",
  }),
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/external", () => ({
  ExternalFoodError: class ExternalFoodError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  searchOpenFoodFactsProducts: routeState.searchOpenFoodFactsProducts,
  searchUsdaFoods: routeState.searchUsdaFoods,
  loadOpenFoodFactsProduct: routeState.loadOpenFoodFactsProduct,
  loadUsdaFood: routeState.loadUsdaFood,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => routeState.authResult,
    },
  }),
}));

vi.mock("@/src/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(async () => ({
        data: {
          id: "22222222-2222-4222-8222-222222222222",
          slug: "optimum-nutrition-whey",
          english_name: "Optimum Nutrition — Gold Standard Whey",
          catalog_status: "pending_review",
        },
        error: null,
      })),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    return {
      clientKind: "admin",
      rpc(
        this: { clientKind: string },
        name: string,
        args: Record<string, unknown>,
      ) {
        if (this.clientKind !== "admin") {
          throw new Error("Supabase RPC lost its client context.");
        }
        return routeState.rpc(name, args);
      },
      from: vi.fn(() => builder),
    };
  },
}));

import { POST } from "../../app/api/foods/lookup/route";
import { ExternalFoodError } from "../../src/lib/external/food-data-types";

const offCandidate = {
  provider: "open_food_facts" as const,
  externalId: "748927022650",
  displayName:
    "Optimum Nutrition — Gold Standard 100% Whey Double Rich Chocolate",
  brandName: "Optimum Nutrition",
  productName: "Gold Standard 100% Whey Double Rich Chocolate",
  variantName: null,
  gtin: "748927022650",
  dataType: "Open Food Facts product",
  imageUrl: null,
  nutritionImageUrl: null,
  nutritionReferenceUnit: "g" as const,
  nutritionPreview: {
    calories: 375,
    proteinGrams: 75,
    carbohydrateGrams: 9.4,
    fatGrams: 3.1,
  },
};

const normalizedOffFood = {
  provider: "open_food_facts" as const,
  externalId: "748927022650",
  food: {
    slug: "gold-standard-whey-off-748927022650",
    english_name: "Optimum Nutrition — Gold Standard Whey",
    food_kind: "branded_product" as const,
    brand_name: "Optimum Nutrition",
    product_name: "Gold Standard Whey",
    variant_name: null,
    manufacturer_name: null,
    gtin: "748927022650",
    package_description: "2 lb",
    country_codes: [],
    ingredients_text: "Whey protein",
    allergen_statement: "Milk",
    category_slugs: ["protein", "supplement"],
  },
  nutrition: {
    measurement_basis: "as_sold" as const,
    reference_quantity: 100,
    reference_unit: "g" as const,
    serving_weight_grams: null,
    serving_description: "31 g",
    calories: 375,
    energy_kj: null,
    protein_g: 75,
    carbohydrate_g: 9.4,
    fat_g: 3.1,
    fiber_g: null,
    sodium_mg: null,
    saturated_fat_g: null,
    trans_fat_g: null,
    total_sugars_g: null,
    added_sugars_g: null,
    cholesterol_mg: null,
    potassium_mg: null,
    calcium_mg: null,
    iron_mg: null,
    vitamin_d_mcg: null,
    nutrients: [],
  },
  sourceMetadata: {
    source_name: "Open Food Facts",
    source_reference: "Open Food Facts barcode 748927022650",
    source_url: "https://world.openfoodfacts.org/product/748927022650",
    source_version: "Open Food Facts product API v3",
    license_code: "ODbL-1.0",
    attribution_text: "Product data from Open Food Facts.",
    source_modified_at: null,
    parser_version: "test",
    payload_sha256: "a".repeat(64),
  },
  snapshot: { product: { code: "748927022650" } },
};

describe("external food lookup route", () => {
  beforeEach(() => {
    routeState.authResult = {
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      error: null,
    };
    routeState.rpc.mockReset();
    routeState.searchOpenFoodFactsProducts.mockReset();
    routeState.searchUsdaFoods.mockReset();
    routeState.loadOpenFoodFactsProduct.mockReset();
    routeState.loadUsdaFood.mockReset();
    routeState.rpc.mockImplementation(async (name: string) => {
      if (name === "record_external_food_lookup") {
        return {
          data: { allowed: true, retryAfterSeconds: 0 },
          error: null,
        };
      }
      if (name === "cache_external_food") {
        return {
          data: "22222222-2222-4222-8222-222222222222",
          error: null,
        };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    });
  });

  it("classifies auth-js AuthSessionMissingError as a signed-out request", async () => {
    routeState.authResult = {
      data: { user: null },
      error: {
        name: "AuthSessionMissingError",
        status: 400,
        message: "Auth session missing!",
      },
    };

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "search", query: "oats" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("SESSION_EXPIRED");
    expect(routeState.searchUsdaFoods).not.toHaveBeenCalled();
    expect(routeState.searchOpenFoodFactsProducts).not.toHaveBeenCalled();
  });

  it("fans one smart search out to both providers and keeps partial results", async () => {
    const usdaCandidate = {
      ...offCandidate,
      provider: "usda_fdc" as const,
      externalId: "168390",
      displayName: "Asparagus, raw",
      productName: "Asparagus, raw",
      brandName: null,
      gtin: null,
      dataType: "Foundation",
    };
    routeState.searchUsdaFoods.mockResolvedValue([usdaCandidate]);
    routeState.searchOpenFoodFactsProducts.mockRejectedValue(
      new Error("provider timeout"),
    );

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "search", query: "asparagus" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      kind: "candidates",
      candidates: [usdaCandidate],
      cacheable: false,
      providers: expect.arrayContaining([
        expect.objectContaining({
          provider: "usda_fdc",
          status: "ok",
          resultCount: 1,
        }),
        expect.objectContaining({
          provider: "open_food_facts",
          status: "unavailable",
          resultCount: 0,
        }),
      ]),
    });
    expect(
      body.data.providers.find(
        (provider: { provider: string }) =>
          provider.provider === "open_food_facts",
      ).message,
    ).toMatch(/^Open Food Facts /);
    expect(JSON.stringify(body)).not.toContain("provider timeout");
    expect(routeState.searchUsdaFoods).toHaveBeenCalledWith(
      "asparagus",
      expect.objectContaining({ apiKey: "fixture-key" }),
    );
    expect(routeState.searchOpenFoodFactsProducts).toHaveBeenCalledWith(
      "asparagus",
      expect.objectContaining({
        userAgent: "LetsGoGreen tests@example.invalid",
      }),
    );
    expect(routeState.rpc).toHaveBeenCalledWith(
      "record_external_food_lookup",
      expect.objectContaining({
        lookup_provider: "usda_fdc",
        lookup_kind: "search",
      }),
    );
    expect(routeState.rpc).toHaveBeenCalledWith(
      "record_external_food_lookup",
      expect.objectContaining({
        lookup_provider: "open_food_facts",
        lookup_kind: "search",
      }),
    );
  });

  it("runs branded-product name search only after an explicit API request", async () => {
    routeState.searchOpenFoodFactsProducts.mockResolvedValue([offCandidate]);

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "search_open_food_facts",
          query: "Optimum Nutrition double rich chocolate",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      kind: "candidates",
      candidates: [offCandidate],
    });
    expect(routeState.searchOpenFoodFactsProducts).toHaveBeenCalledWith(
      "Optimum Nutrition double rich chocolate",
      expect.objectContaining({
        userAgent: "LetsGoGreen tests@example.invalid",
      }),
    );
    expect(routeState.rpc).toHaveBeenCalledWith(
      "record_external_food_lookup",
      expect.objectContaining({
        lookup_provider: "open_food_facts",
        lookup_kind: "search",
      }),
    );
    expect(routeState.loadOpenFoodFactsProduct).not.toHaveBeenCalled();
  });

  it("stops name search when server-side lookup accounting rejects the request", async () => {
    routeState.rpc.mockResolvedValueOnce({
      data: { allowed: false, retryAfterSeconds: 83 },
      error: null,
    });

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "search_open_food_facts",
          query: "chocolate whey protein",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("83");
    expect(body.error).toMatchObject({
      code: "FOOD_SEARCH_RATE_LIMITED",
      retryAfterSeconds: 83,
      message: "Search this source again in 83 seconds.",
    });
    expect(body.error.action).toEqual({
      kind: "wait",
      label: "Wait, then try again",
    });
    expect(routeState.searchOpenFoodFactsProducts).not.toHaveBeenCalled();
  });

  it("reserves import capacity separately and identifies import cooldowns precisely", async () => {
    routeState.rpc.mockResolvedValueOnce({
      data: { allowed: false, retryAfterSeconds: 19 },
      error: null,
    });

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          provider: "open_food_facts",
          externalId: "748927022650",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("19");
    expect(body.error).toMatchObject({
      code: "FOOD_IMPORT_RATE_LIMITED",
      retryAfterSeconds: 19,
      message: "This food can be imported in 19 seconds.",
    });
    expect(routeState.rpc).toHaveBeenCalledWith(
      "record_external_food_lookup",
      expect.objectContaining({ lookup_kind: "import" }),
    );
    expect(routeState.loadOpenFoodFactsProduct).not.toHaveBeenCalled();
  });

  it("uses a conservative structured delay when the provider itself returns a rate limit", async () => {
    routeState.loadOpenFoodFactsProduct.mockRejectedValue(
      new ExternalFoodError(
        "rate_limited",
        "unsafe provider diagnostic with internal_table_name",
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          provider: "open_food_facts",
          externalId: "748927022650",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(body.error).toMatchObject({
      code: "FOOD_SOURCE_RATE_LIMITED",
      retryAfterSeconds: 300,
    });
    expect(JSON.stringify(body)).not.toContain("internal_table_name");
  });

  it("uses a search-specific safe envelope for an unexpected direct search failure", async () => {
    routeState.searchOpenFoodFactsProducts.mockRejectedValue(
      new Error("unsafe upstream diagnostic"),
    );

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "search_open_food_facts",
          query: "asparagus",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatchObject({
      code: "FOOD_SEARCH_FAILED",
      action: { kind: "retry", label: "Retry food search" },
    });
    expect(JSON.stringify(body)).not.toContain("unsafe upstream diagnostic");
    expect(JSON.stringify(body)).not.toContain("Retry import");
  });

  it("keeps combined partial results usable but marks a limited provider response non-cacheable", async () => {
    routeState.rpc.mockImplementation(
      async (name: string, args: { lookup_provider?: string }) => {
        if (name !== "record_external_food_lookup") {
          return { data: null, error: { code: "unexpected_rpc" } };
        }
        return args.lookup_provider === "usda_fdc"
          ? {
              data: { allowed: false, retryAfterSeconds: 41 },
              error: null,
            }
          : {
              data: { allowed: true, retryAfterSeconds: 0 },
              error: null,
            };
      },
    );
    routeState.searchOpenFoodFactsProducts.mockResolvedValue([offCandidate]);

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "search", query: "asparagus" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(body.data).toMatchObject({
      kind: "candidates",
      candidates: [offCandidate],
      cacheable: false,
      providers: expect.arrayContaining([
        expect.objectContaining({
          provider: "usda_fdc",
          status: "rate_limited",
          retryAfterSeconds: 41,
        }),
        expect.objectContaining({
          provider: "open_food_facts",
          status: "ok",
          retryAfterSeconds: null,
        }),
      ]),
    });
    expect(routeState.searchUsdaFoods).not.toHaveBeenCalled();
    expect(routeState.searchOpenFoodFactsProducts).toHaveBeenCalledOnce();
  });

  it("returns a stable safe reason when a source record lacks required nutrition", async () => {
    routeState.loadOpenFoodFactsProduct.mockRejectedValue(
      new ExternalFoodError(
        "incomplete_nutrition",
        "unsafe provider diagnostic with internal_table_name",
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          provider: "open_food_facts",
          externalId: "748927022650",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: "FOOD_SOURCE_NUTRITION_INCOMPLETE",
      retryable: false,
      action: { kind: "edit" },
    });
    expect(JSON.stringify(body)).not.toContain("internal_table_name");
  });

  it("explains why a per-100 mL source record cannot enter gram-based plan math", async () => {
    routeState.loadOpenFoodFactsProduct.mockRejectedValue(
      new ExternalFoodError(
        "unsupported_reference_unit",
        "unsafe provider diagnostic with internal_table_name",
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          provider: "open_food_facts",
          externalId: "748927022650",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: "FOOD_SOURCE_REFERENCE_UNIT_UNSUPPORTED",
      message: "This liquid product is reported per 100 mL.",
      retryable: false,
      action: { kind: "edit" },
    });
    expect(body.error.details).toContain("per 100 g");
    expect(JSON.stringify(body)).not.toContain("internal_table_name");
    expect(routeState.rpc).not.toHaveBeenCalledWith(
      "cache_external_food",
      expect.anything(),
    );
  });

  it("refetches an exact Open Food Facts record before caching an import", async () => {
    routeState.loadOpenFoodFactsProduct.mockResolvedValue(normalizedOffFood);

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          provider: "open_food_facts",
          externalId: "748927022650",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(routeState.loadOpenFoodFactsProduct).toHaveBeenCalledWith(
      "748927022650",
      expect.objectContaining({
        userAgent: "LetsGoGreen tests@example.invalid",
      }),
    );
    expect(routeState.rpc).toHaveBeenCalledWith(
      "record_external_food_lookup",
      expect.objectContaining({
        lookup_provider: "open_food_facts",
        lookup_kind: "import",
      }),
    );
    expect(routeState.rpc).toHaveBeenCalledWith(
      "cache_external_food",
      expect.objectContaining({
        source_provider: "open_food_facts",
        source_external_id: "748927022650",
        source_snapshot: normalizedOffFood.snapshot,
      }),
    );
    expect(body.data).toMatchObject({
      kind: "imported",
      reviewStatus: "pending_review",
      planEligible: false,
    });
  });

  it("describes an unknown import result as safely retryable and idempotent", async () => {
    routeState.loadOpenFoodFactsProduct.mockResolvedValue(normalizedOffFood);
    routeState.rpc.mockImplementation(async (name: string) => {
      if (name === "record_external_food_lookup") {
        return { data: { allowed: true, retryAfterSeconds: 0 }, error: null };
      }
      throw new Error("lost cache response");
    });

    const response = await POST(
      new Request("http://localhost/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          provider: "open_food_facts",
          externalId: "748927022650",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({
      code: "FOOD_IMPORT_FAILED",
      message: "The catalog save result could not be confirmed.",
      action: { kind: "retry", label: "Retry catalog save" },
    });
    expect(body.error.details).toMatch(/idempotent provider save may already exist/i);
  });
});
