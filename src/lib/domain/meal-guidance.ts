import {
  PRIMARY_MEAL_TYPES,
  type PrimaryMealType,
} from "./meal-slots";

export type MealType = PrimaryMealType;

export const FOOD_CATEGORIES = [
  "carbohydrate",
  "protein",
  "vegetable",
  "fruit",
  "fat",
  "dairy",
  "supplement",
] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

export interface CategorizedFood {
  categories: readonly FoodCategory[];
}

export interface MealCategoryWarning {
  mealType: MealType;
  missingCategory: "carbohydrate" | "protein" | "vegetable";
  code: string;
}

export const REQUIRED_MEAL_CATEGORIES: Readonly<
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
      meals[mealType].flatMap((food) => [...food.categories]),
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

function joinEnglish(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function categoryPhrase(
  category: MealCategoryWarning["missingCategory"],
): string {
  return category === "vegetable"
    ? "no vegetable"
    : `no ${category} source`;
}

/**
 * Groups warnings by missing category so repeated meal names read naturally.
 * The result is neutral guidance, not a blocking validation error.
 */
export function formatMealCategoryWarnings(
  warnings: readonly MealCategoryWarning[],
): string {
  if (warnings.length === 0) return "";
  const categoryOrder: readonly MealCategoryWarning["missingCategory"][] = [
    "carbohydrate",
    "protein",
    "vegetable",
  ];
  const unique = new Map<string, MealCategoryWarning>();
  for (const warning of warnings) {
    unique.set(`${warning.mealType}:${warning.missingCategory}`, warning);
  }

  const clauses = categoryOrder.flatMap((category) => {
    const meals = PRIMARY_MEAL_TYPES.filter((mealType) =>
      unique.has(`${mealType}:${category}`),
    );
    if (meals.length === 0) return [];
    const subject =
      meals.length === 1 ? meals[0] : joinEnglish(meals);
    return [
      `${subject} ${meals.length === 1 ? "has" : "have"} ${categoryPhrase(category)}`,
    ];
  });
  const sentence = clauses
    .map((clause, index) => `${index === 0 ? "Your" : "your"} ${clause}`)
    .reduce((result, clause, index) => {
      if (index === 0) return clause;
      if (index === clauses.length - 1) return `${result}, and ${clause}`;
      return `${result}, ${clause}`;
    }, "");
  return `${sentence}.`;
}
