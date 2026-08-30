import type {
  FoodNutritionFacts,
  FoodSourceSummary,
} from "@/src/lib/domain/food-catalog";
import {
  measurementBasisLabel,
  verificationLabel,
} from "@/src/lib/food-catalog-labels";

function value(
  amount: number | null | undefined,
  unit: string,
): string | null {
  return typeof amount === "number"
    ? `${Number.isInteger(amount) ? amount : amount.toFixed(1)} ${unit}`
    : null;
}

export function NutritionFactsCard({
  nutrition,
  source,
  compact = false,
}: {
  nutrition: FoodNutritionFacts | null;
  source?: FoodSourceSummary | null;
  compact?: boolean;
}) {
  if (!nutrition) {
    return (
      <p className="field-help">
        No usable nutrition record is available. Look up the exact product or
        upload its package label instead of guessing.
      </p>
    );
  }
  const facts = [
    ["Protein", value(nutrition.protein_g, "g")],
    ["Carbohydrate", value(nutrition.carbohydrate_g, "g")],
    ["Total fat", value(nutrition.fat_g, "g")],
    ["Saturated fat", value(nutrition.saturated_fat_g, "g")],
    ["Trans fat", value(nutrition.trans_fat_g, "g")],
    ["Fiber", value(nutrition.fiber_g, "g")],
    ["Total sugars", value(nutrition.total_sugars_g, "g")],
    ["Added sugars", value(nutrition.added_sugars_g, "g")],
    ["Sodium", value(nutrition.sodium_mg, "mg")],
    ["Cholesterol", value(nutrition.cholesterol_mg, "mg")],
    ["Potassium", value(nutrition.potassium_mg, "mg")],
    ["Calcium", value(nutrition.calcium_mg, "mg")],
    ["Iron", value(nutrition.iron_mg, "mg")],
    ["Vitamin D", value(nutrition.vitamin_d_mcg, "mcg")],
  ].filter((fact): fact is [string, string] => fact[1] !== null);
  const reference =
    nutrition.reference_unit === "serving"
      ? `${nutrition.serving_description ?? "1 serving"}${
          nutrition.serving_weight_grams
            ? ` (${value(nutrition.serving_weight_grams, "g")})`
            : ""
        }`
      : `${nutrition.reference_quantity} ${nutrition.reference_unit}, ${measurementBasisLabel(nutrition.measurement_basis)}`;

  return (
    <details
      className="message-box"
      open={!compact}
      style={{ marginTop: ".65rem" }}
    >
      <summary>
        <strong>Nutrition facts</strong> · {reference}
      </summary>
      <div style={{ marginTop: ".65rem" }}>
        <p style={{ fontSize: "1.45rem", margin: "0 0 .45rem" }}>
          <strong>{value(nutrition.calories, "kcal") ?? "Energy pending"}</strong>
          {nutrition.energy_kj != null
            ? ` · ${value(nutrition.energy_kj, "kJ")}`
            : ""}
        </p>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(8rem, 1fr) auto",
            gap: ".25rem .8rem",
            margin: 0,
          }}
        >
          {facts.map(([label, amount]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd style={{ margin: 0, textAlign: "right" }}>{amount}</dd>
            </div>
          ))}
        </dl>
        {nutrition.nutrients.length ? (
          <details style={{ marginTop: ".65rem" }}>
            <summary>All reported nutrients ({nutrition.nutrients.length})</summary>
            <ul>
              {nutrition.nutrients.map((nutrient) => (
                <li key={nutrient.code}>
                  {nutrient.name}: {value(nutrient.amount, nutrient.unit)}
                  {nutrient.daily_value_percent != null
                    ? ` · ${nutrient.daily_value_percent}% daily value`
                    : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="field-help" style={{ marginTop: ".7rem" }}>
          {verificationLabel(nutrition.verification_status)}.
          {source?.attribution_text ? ` ${source.attribution_text}` : ""}
          {source?.source_url ? (
            <>
              {" "}
              <a href={source.source_url} target="_blank" rel="noreferrer">
                View source
              </a>
              .
            </>
          ) : null}
        </p>
      </div>
    </details>
  );
}
