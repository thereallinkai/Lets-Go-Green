import { describe, expect, it, vi } from "vitest";
import offFixture from "../fixtures/open-food-facts-product.json";
import offSearchFixture from "../fixtures/open-food-facts-search.json";
import usdaFixture from "../fixtures/usda-whey-product.json";

vi.mock("server-only", () => ({}));

import {
  loadOpenFoodFactsProduct,
  loadUsdaFood,
  searchOpenFoodFactsProducts,
} from "../../src/lib/external";

function fixtureFetch(payload: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("external food normalization", () => {
  it("normalizes an exact branded USDA whey product with full provenance", async () => {
    const result = await loadUsdaFood("2464134", {
      apiKey: "fixture-key",
      userAgent: "LetsGoGreen tests@example.invalid",
      fetcher: fixtureFetch(usdaFixture),
    });

    expect(result.food).toMatchObject({
      brand_name: "OPTIMUM NUTRITION",
      gtin: "748927028669",
      food_kind: "branded_product",
      category_slugs: expect.arrayContaining(["protein", "supplement"]),
    });
    expect(result.nutrition).toMatchObject({
      reference_quantity: 100,
      calories: 395,
      protein_g: 79,
      sodium_mg: 164,
    });
    expect(result.sourceMetadata).toMatchObject({
      license_code: "CC0-1.0",
      source_reference: expect.stringContaining("2464134"),
    });
  });

  it("uses the stable Open Food Facts v3 product route and converts sodium", async () => {
    const fetcher = fixtureFetch(offFixture);
    const result = await loadOpenFoodFactsProduct("1234567890123", {
      userAgent: "LetsGoGreen tests@example.invalid",
      fetcher,
    });

    expect(String(vi.mocked(fetcher).mock.calls[0]?.[0])).toContain(
      "/api/v3/product/1234567890123",
    );
    expect(result.food.category_slugs).toEqual(
      expect.arrayContaining(["vegetable", "supplement"]),
    );
    expect(result.nutrition.sodium_mg).toBe(200);
    expect(result.sourceMetadata.source_version).toBe(
      "Open Food Facts product API v3",
    );
  });

  it("searches Open Food Facts by product name without importing a candidate", async () => {
    const fetcher = fixtureFetch(offSearchFixture);
    const candidates = await searchOpenFoodFactsProducts(
      "Optimum Nutrition double rich chocolate",
      {
        userAgent: "LetsGoGreen tests@example.invalid",
        fetcher,
      },
    );

    const requestedUrl = new URL(
      String(vi.mocked(fetcher).mock.calls[0]?.[0]),
    );
    expect(requestedUrl.pathname).toBe("/cgi/search.pl");
    expect(requestedUrl.searchParams.get("search_terms")).toBe(
      "Optimum Nutrition double rich chocolate",
    );
    expect(requestedUrl.searchParams.get("page_size")).toBe("10");
    expect(requestedUrl.searchParams.get("fields")).toContain("nutriments");
    expect(candidates[0]).toMatchObject({
      provider: "open_food_facts",
      externalId: "748927022650",
      brandName: "Optimum Nutrition",
      gtin: "748927022650",
      imageUrl: null,
      nutritionImageUrl: null,
      nutritionPreview: {
        calories: 375,
        proteinGrams: 75,
        carbohydrateGrams: 9.4,
        fatGrams: 3.1,
      },
    });
    expect(candidates[1]?.nutritionPreview.calories).toBeCloseTo(375, 0);
  });

  it("keeps only HTTPS Open Food Facts package-photo URLs", async () => {
    const product = {
      code: "1234567890123",
      product_name: "Chocolate protein powder",
      brands: "Example Brand",
      image_front_small_url:
        "https://images.openfoodfacts.org/images/products/123/front.200.jpg",
      image_nutrition_small_url:
        "https://images.openfoodfacts.org/images/products/123/nutrition.200.jpg",
      nutriments: {
        "energy-kcal_100g": 380,
        proteins_100g: 72,
        carbohydrates_100g: 12,
        fat_100g: 4,
      },
    };
    const trusted = await searchOpenFoodFactsProducts("chocolate protein", {
      userAgent: "LetsGoGreen tests@example.invalid",
      fetcher: fixtureFetch({ products: [product] }),
    });
    expect(trusted[0]?.imageUrl).toBe(product.image_front_small_url);
    expect(trusted[0]?.nutritionImageUrl).toBe(
      product.image_nutrition_small_url,
    );

    const untrusted = await searchOpenFoodFactsProducts("chocolate protein", {
      userAgent: "LetsGoGreen tests@example.invalid",
      fetcher: fixtureFetch({
        products: [
          {
            ...product,
            code: "1234567890124",
            image_front_small_url: "https://tracker.example.invalid/front.jpg",
          },
        ],
      }),
    });
    expect(untrusted[0]?.imageUrl).toBeNull();
  });

  it("keeps USDA kilocalorie and kilojoule rows distinct", async () => {
    const result = await loadUsdaFood("170379", {
      apiKey: "fixture-key",
      userAgent: "LetsGoGreen tests@example.invalid",
      fetcher: fixtureFetch({
        description: "Broccoli, raw",
        dataType: "SR Legacy",
        foodNutrients: [
          {
            nutrient: { number: "208", name: "Energy", unitName: "kcal" },
            amount: 34,
          },
          {
            nutrient: { number: "268", name: "Energy", unitName: "kJ" },
            amount: 141,
          },
          {
            nutrient: { number: "203", name: "Protein", unitName: "g" },
            amount: 2.82,
          },
          {
            nutrient: {
              number: "205",
              name: "Carbohydrate, by difference",
              unitName: "g",
            },
            amount: 6.64,
          },
          {
            nutrient: {
              number: "204",
              name: "Total lipid (fat)",
              unitName: "g",
            },
            amount: 0.37,
          },
        ],
      }),
    });

    expect(result.nutrition.calories).toBe(34);
    expect(result.nutrition.energy_kj).toBe(141);
  });
});
