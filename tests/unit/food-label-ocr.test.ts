import { describe, expect, it } from "vitest";
import {
  parseFoodLabelOcr,
  type FoodLabelOcrLine,
} from "../../src/lib/food-label-ocr";

function line(
  text: string,
  confidence = 92,
  wordOverrides: Record<string, number> = {},
): FoodLabelOcrLine {
  return {
    text,
    confidence,
    words: text.split(/\s+/).map((word) => ({
      text: word,
      confidence: wordOverrides[word] ?? confidence,
    })),
  };
}

describe("parseFoodLabelOcr", () => {
  it("extracts only explicitly labeled, high-confidence package facts", () => {
    const result = parseFoodLabelOcr(
      [
        line("Brand: Example Nutrition"),
        line("Product name: Plant Protein"),
        line("Flavor: Chocolate"),
        line("NET WT 2 LB (907g)"),
        line("Serving size 1 scoop (30g)"),
        line("Calories 120"),
        line("Total Fat 2g 3%"),
        line("Saturated Fat 0.5g 3%"),
        line("Trans Fat 0g"),
        line("Cholesterol 10mg 3%"),
        line("Sodium 0.12g 5%"),
        line("Total Carbohydrate 4g 1%"),
        line("Dietary Fiber 1g 4%"),
        line("Total Sugars 1g"),
        line("Includes 0g Added Sugars 0%"),
        line("Protein 24g"),
        line("Vitamin D 0mcg 0%"),
        line("Calcium 120mg 10%"),
        line("Iron 1.5mg 8%"),
        line("Potassium 180mg 4%"),
        line("Ingredients: Pea protein, cocoa,"),
        line("natural flavor and stevia."),
        line("Contains: Milk and soy."),
      ],
      91,
    );

    expect(result.values).toMatchObject({
      brandName: "Example Nutrition",
      productName: "Plant Protein",
      variantName: "Chocolate",
      packageDescription: "2 LB (907g)",
      servingDescription: "1 scoop",
      servingWeightGrams: 30,
      calories: 120,
      fatGrams: 2,
      saturatedFatGrams: 0.5,
      transFatGrams: 0,
      cholesterolMilligrams: 10,
      sodiumMilligrams: 120,
      carbohydrateGrams: 4,
      fiberGrams: 1,
      totalSugarsGrams: 1,
      addedSugarsGrams: 0,
      proteinGrams: 24,
      vitaminDMicrograms: 0,
      calciumMilligrams: 120,
      ironMilligrams: 1.5,
      potassiumMilligrams: 180,
      ingredientsText: "Pea protein, cocoa, natural flavor and stevia.",
      allergenStatement: "Contains: Milk and soy.",
    });
    expect(result.allergenSuggestions).toEqual(["milk", "soy"]);
    expect(result.unreadableRequiredFields).toEqual([]);
    expect(result.quality).toBe("strong");
  });

  it("leaves low-confidence number words and unlabeled product identity blank", () => {
    const result = parseFoodLabelOcr(
      [
        line("ACME CHOCOLATE SHAKE"),
        line("Serving size 1 bottle (330g)"),
        line("Calories 280", 90, { "280": 41 }),
        line("Protein 20g"),
        line("Total Carbohydrate 35g"),
        line("Total Fat 7g"),
        line("Ingredients: Milk, cocoa."),
        line("Contains: Milk."),
      ],
      75,
    );

    expect(result.values.brandName).toBeUndefined();
    expect(result.values.productName).toBeUndefined();
    expect(result.values.calories).toBeUndefined();
    expect(result.unreadableRequiredFields).toEqual(
      expect.arrayContaining(["Brand", "Product", "Calories"]),
    );
  });

  it("does not turn inequalities or trace amounts into exact nutrition values", () => {
    const result = parseFoodLabelOcr(
      [
        line("Serving size 1 piece (12g)"),
        line("Calories less than 5"),
        line("Total Fat <1g"),
        line("Protein trace"),
        line("Total Carbohydrate 2g"),
      ],
      88,
    );

    expect(result.values.calories).toBeUndefined();
    expect(result.values.fatGrams).toBeUndefined();
    expect(result.values.proteinGrams).toBeUndefined();
    expect(result.values.carbohydrateGrams).toBe(2);
  });

  it("omits ambiguous multi-column values instead of choosing one", () => {
    const result = parseFoodLabelOcr(
      [
        line("Serving size 50g"),
        line("Total Carbohydrate 10g 20g"),
        line("Protein 5g"),
        line("Protein 10g"),
      ],
      90,
    );

    expect(result.values.carbohydrateGrams).toBeUndefined();
    expect(result.values.proteinGrams).toBeUndefined();
    expect(result.warnings.join(" ")).toMatch(/Multiple protein values/i);
  });

  it("removes physically impossible readings relative to the printed serving", () => {
    const result = parseFoodLabelOcr(
      [
        line("Serving size 1 scoop (10g)"),
        line("Calories 900"),
        line("Protein 80g"),
        line("Total Carbohydrate 3g"),
        line("Total Fat 1g"),
      ],
      90,
    );

    expect(result.values.calories).toBeUndefined();
    expect(result.values.proteinGrams).toBeUndefined();
    expect(result.values.carbohydrateGrams).toBe(3);
    expect(result.warnings.join(" ")).toMatch(/conflicts with the printed serving weight/i);
  });

  it("accepts only an explicit allergen statement and never treats an ingredient percentage as one", () => {
    const result = parseFoodLabelOcr(
      [
        line("Ingredients: Pea protein, contains 2% or less of cocoa."),
        line("Contains 2% or less of natural flavor."),
      ],
      90,
    );

    expect(result.values.allergenStatement).toBeUndefined();
    expect(result.allergenSuggestions).toEqual([]);
  });

  it("accepts common allergen statements without a colon and keeps them out of ingredients", () => {
    const result = parseFoodLabelOcr(
      [
        line("Ingredients: Pea protein, cocoa."),
        line("CONTAINS MILK, SOY"),
        line("May contain peanuts"),
      ],
      92,
    );

    expect(result.values.ingredientsText).toBe("Pea protein, cocoa.");
    expect(result.values.allergenStatement).toBe(
      "CONTAINS: MILK, SOY May contain: peanuts",
    );
    expect(result.allergenSuggestions).toEqual(["milk", "peanuts", "soy"]);
  });

  it("does not suggest named allergens that the package explicitly negates", () => {
    const result = parseFoodLabelOcr(
      [
        line("Contains no milk"),
        line("Allergens: free from egg and wheat"),
        line("May contain soy"),
      ],
      92,
    );

    expect(result.allergenSuggestions).toEqual(["soy"]);
  });

  it("stops ingredient continuation before sparse-text nutrition and identity lines", () => {
    const result = parseFoodLabelOcr(
      [
        line("Ingredients: Pea protein, cocoa."),
        line("Calories 120"),
        line("Protein 24g"),
        line("Brand: Fixture Foods"),
      ],
      93,
    );

    expect(result.values.ingredientsText).toBe("Pea protein, cocoa.");
    expect(result.values.ingredientsText).not.toMatch(
      /Calories 120|Protein 24g|Brand:/i,
    );
    expect(result.values.calories).toBe(120);
    expect(result.values.proteinGrams).toBe(24);
    expect(result.values.brandName).toBe("Fixture Foods");
  });

  it("does not misread percentage disclosures without a colon as allergens", () => {
    const result = parseFoodLabelOcr(
      [
        line("Contains less than 2% cocoa."),
        line("May contain 2% natural flavor."),
      ],
      91,
    );

    expect(result.values.allergenStatement).toBeUndefined();
    expect(result.allergenSuggestions).toEqual([]);
  });
});
