import type {
  FoodNutritionFacts,
  FoodVerificationStatus,
} from "@/src/lib/domain/food-catalog";

export function verificationLabel(status: FoodVerificationStatus): string {
  switch (status) {
    case "verified":
      return "Source reviewed";
    case "user_label":
      return "Confirmed from your label";
    case "source_reported":
      return "Reported by external source";
    case "pending_verification":
      return "Pending verification";
    case "unavailable":
      return "Nutrition unavailable";
  }
}

export function measurementBasisLabel(
  basis: FoodNutritionFacts["measurement_basis"],
): string {
  return basis.replaceAll("_", " ");
}
