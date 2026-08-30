import {
  PRIMARY_MEAL_TYPES,
  type PrimaryMealType,
} from "./meal-slots";

export type MealType = PrimaryMealType;

export interface CategorizedFood {
  categories: readonly string[];
}

export interface MealCategoryWarning {
  mealType: MealType;
  missingCategory: "carbohydrate" | "protein" | "vegetable";
  code: string;
}

const REQUIRED_MEAL_CATEGORIES: Readonly<
  Record<MealType, readonly MealCategoryWarning["missingCategory"][]>
> = {
  breakfast: ["carbohydrate", "protein"],
  lunch: ["carbohydrate", "protein", "vegetable"],
  dinner: ["carbohydrate", "protein", "vegetable"],
};

export function validateMealCategories(
  meals: Readonly<Record<MealType, readonly CategorizedFood[]>>,
): MealCategoryWarning[] {
  return PRIMARY_MEAL_TYPES.flatMap((mealType) => {
    const present = new Set(
      meals[mealType].flatMap((food) =>
        food.categories.map((category) => category.trim().toLowerCase()),
      ),
    );
    return REQUIRED_MEAL_CATEGORIES[mealType]
      .filter((category) => !present.has(category))
      .map((missingCategory) => ({
        mealType,
        missingCategory,
        code: `missing_${missingCategory}`,
      }));
  });
}
