import { describe, expect, it } from "vitest";
import {
  confirmedFoodLabelDataSchema,
  foodLabelDataSchema,
} from "../../src/lib/domain/food-label";

const whey = {
  brandName: "Optimum Nutrition",
  productName: "Gold Standard 100% Whey",
  variantName: "Double Rich Chocolate",
  gtin: "748927028669",
  packageDescription: "2 lb tub",
  servingWeightGrams: 30.4,
  servingDescription: "1 scoop",
  calories: 120,
  proteinGrams: 24,
  carbohydrateGrams: 3,
  fatGrams: 1.5,
  ingredientsText: "Whey protein blend, cocoa, lecithin, flavor.",
  allergenStatement: "Contains milk and soy.",
  categorySlugs: ["protein", "supplement"],
  allergenSlugs: ["milk", "soy"],
  restrictionSlugs: ["vegan", "dairy-free"],
  sourceNote: "Fixture transcription",
  allergensReviewed: true,
  restrictionsReviewed: true,
  confirmedAccurate: false,
};

describe("food label input", () => {
  it("requires at least one balance category and preserves whey categories", () => {
    const parsed = foodLabelDataSchema.parse(whey);
    expect(parsed.categorySlugs).toEqual(["protein", "supplement"]);
    expect(parsed.shareNormalizedProduct).toBe(false);
  });

  it("accepts an explicit normalized-product sharing choice without making it the default", () => {
    expect(
      foodLabelDataSchema.parse({
        ...whey,
        shareNormalizedProduct: true,
      }).shareNormalizedProduct,
    ).toBe(true);
  });

  it("requires explicit confirmation at the final boundary", () => {
    expect(confirmedFoodLabelDataSchema.safeParse(whey).success).toBe(false);
    expect(
      confirmedFoodLabelDataSchema.safeParse({
        ...whey,
        confirmedAccurate: true,
      }).success,
    ).toBe(true);
  });

  it("rejects values that exceed database serving bounds", () => {
    expect(
      foodLabelDataSchema.safeParse({
        ...whey,
        servingDescription: "x".repeat(161),
      }).success,
    ).toBe(false);
  });

  it("requires every allergen named by the package statement to be mapped", () => {
    expect(
      foodLabelDataSchema.safeParse({
        ...whey,
        allergenSlugs: ["soy"],
      }).success,
    ).toBe(false);
  });

  it("requires explicit allergen and restriction review at confirmation", () => {
    expect(
      confirmedFoodLabelDataSchema.safeParse({
        ...whey,
        allergensReviewed: false,
        confirmedAccurate: true,
      }).success,
    ).toBe(false);
  });
});
