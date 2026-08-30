import { describe, expect, it } from "vitest";

import {
  validateMealCategories,
} from "../../src/lib/domain/meal-guidance";

describe("meal composition guidance", () => {
  it("finds the required categories for each meal", () => {
    const warnings = validateMealCategories({
      breakfast: [{ categories: ["carbohydrate", "protein"] }],
      lunch: [
        { categories: ["protein"] },
        { categories: ["vegetable"] },
      ],
      dinner: [{ categories: ["carbohydrate", "vegetable"] }],
    });
    expect(warnings).toEqual([
      {
        mealType: "lunch",
        missingCategory: "carbohydrate",
        code: "missing_carbohydrate",
      },
      {
        mealType: "dinner",
        missingCategory: "protein",
        code: "missing_protein",
      },
    ]);
  });

  it("normalizes persisted category case and whitespace", () => {
    expect(
      validateMealCategories({
        breakfast: [{ categories: [" Carbohydrate", "PROTEIN", "Dairy"] }],
        lunch: [{ categories: ["Carbohydrate", "Protein", "Vegetable"] }],
        dinner: [{ categories: ["carbohydrate", "protein", "vegetable"] }],
      }),
    ).toEqual([]);
  });
});
