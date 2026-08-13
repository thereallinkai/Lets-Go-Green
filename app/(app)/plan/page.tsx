import type { Metadata } from "next";
import { format, parseISO } from "date-fns";
import {
  PlanLoadError,
  PlanView,
  type PlanDayDisplay,
  type PlanHistoryDisplay,
} from "@/components/plan-view";
import {
  aggregateNutrition,
  aiPlanSchema,
  type MeasurementBasis,
  type NutritionItem,
  type NutritionRecord,
  type NutritionUnit,
  type NutritionVerificationStatus,
} from "@/src/lib/domain";
import { isDevelopmentDemo } from "@/src/lib/env";
import { readPlanSnapshotWeight } from "@/src/lib/plan-snapshot";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import type { Json, Tables } from "@/src/types/database";

export const metadata: Metadata = { title: "My Plan" };

type PlanRow = Tables<"plans">;
type PlanItemRow = Tables<"plan_items">;
type NutritionRow = Pick<
  Tables<"food_nutrition">,
  | "calories"
  | "carbohydrate_g"
  | "fat_g"
  | "fiber_g"
  | "food_id"
  | "measurement_basis"
  | "protein_g"
  | "reference_quantity"
  | "reference_unit"
  | "sodium_mg"
  | "source_name"
  | "source_reference"
  | "verification_status"
>;

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayDate(value: string) {
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return "Date unavailable";
  }
}

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRange(
  snapshot: Json,
  key: "energyKcal" | "proteinGrams",
): { minimum: number; maximum: number } | null {
  if (!isJsonObject(snapshot)) return null;
  const ranges = snapshot.deterministicRanges;
  if (!ranges || !isJsonObject(ranges)) return null;
  const candidate = ranges[key];
  if (!candidate || !isJsonObject(candidate)) return null;
  const minimum = candidate.minimum;
  const maximum = candidate.maximum;
  return typeof minimum === "number" &&
    Number.isFinite(minimum) &&
    minimum >= 0 &&
    typeof maximum === "number" &&
    Number.isFinite(maximum) &&
    maximum >= minimum
    ? { minimum, maximum }
    : null;
}

function approvedStatus(status: NutritionVerificationStatus) {
  return status === "verified" || status === "user_label";
}

function displayVerification(
  item: PlanItemRow,
  nutrition: NutritionRow | undefined,
) {
  const statuses = [item.verification_status, nutrition?.verification_status];
  if (statuses.includes("unavailable")) return "Unavailable";
  if (statuses.includes("pending_verification") || !nutrition) {
    return "Pending verification";
  }
  if (statuses.includes("user_label")) return "User label";
  return "Verified";
}

function buildMealSummary(
  items: PlanItemRow[],
  nutritionByKey: Map<string, NutritionRow>,
) {
  if (items.length === 0) return "No foods are stored for this meal.";
  const nutritionRows = items.map((item) =>
    nutritionByKey.get(`${item.food_id}:${item.measurement_basis}`),
  );
  const hasUnsupportedUnit = items.some(
    (item) => item.unit !== "g" && item.unit !== "serving",
  );
  const hasUnverifiedRecord = items.some((item, index) => {
    const nutrition = nutritionRows[index];
    return (
      !nutrition ||
      !approvedStatus(item.verification_status) ||
      !approvedStatus(nutrition.verification_status)
    );
  });
  if (hasUnsupportedUnit || hasUnverifiedRecord) {
    return "Nutrition pending verification.";
  }
  const includesUserLabel = items.some(
    (item, index) =>
      item.verification_status === "user_label" ||
      nutritionRows[index]?.verification_status === "user_label",
  );

  const nutritionItems: NutritionItem[] = items.map((item) => ({
    foodId: item.food_id,
    quantity: item.quantity,
    unit: item.unit as NutritionUnit,
    measurementBasis: item.measurement_basis as MeasurementBasis,
  }));
  const records: NutritionRecord[] = nutritionRows.flatMap((row) =>
    row
      ? [
          {
            foodId: row.food_id,
            measurementBasis: row.measurement_basis,
            referenceQuantity: row.reference_quantity,
            referenceUnit: row.reference_unit,
            calories: row.calories,
            proteinGrams: row.protein_g,
            carbohydrateGrams: row.carbohydrate_g,
            fatGrams: row.fat_g,
            fiberGrams: row.fiber_g,
            sodiumMilligrams: row.sodium_mg,
            verificationStatus: row.verification_status,
            sourceName: row.source_name ?? undefined,
            sourceReference: row.source_reference ?? undefined,
          },
        ]
      : [],
  );

  try {
    const result = aggregateNutrition(nutritionItems, records);
    if (
      result.totals.calories === null ||
      result.totals.proteinGrams === null
    ) {
      return "Nutrition pending verification.";
    }
    return `Calculated by the app from ${
      includesUserLabel ? "verified or user-label records" : "verified records"
    } · ${Math.round(
      result.totals.calories,
    ).toLocaleString()} kcal · ${Math.round(
      result.totals.proteinGrams,
    )} g protein`;
  } catch {
    return "Nutrition pending verification.";
  }
}

function emptyPlan() {
  return (
    <PlanView
      acceptedLabel="Accepted"
      acceptedVersion={null}
      assumptions={["No generated plan data is available yet."]}
      days={[]}
      energyRange={null}
      goalAssessment="Complete onboarding, then generate a draft to see a validated goal assessment."
      history={[]}
      hydrationGuidance="Guidance will appear after a plan is generated."
      initialPlanId={null}
      initialStatus="accepted"
      majorReasons={[]}
      proteinRange={null}
      providerLabel="No generated plan yet"
      safetyNotes={[]}
      startWeightKg={null}
      serverBacked
      targetWeightKg={null}
      version={0}
      weeklyReviewRules={[]}
    />
  );
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    version?: string | string[];
    view?: string | string[];
  }>;
}) {
  if (isDevelopmentDemo()) return <PlanView />;

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return emptyPlan();

  const { data: plans, error: plansError } = await supabase
    .from("plans")
    .select(
      "id,accepted_at,created_at,goal_id,input_snapshot,model,prompt_version,provider,status,updated_at,user_id,validated_output_snapshot,version",
    )
    .eq("user_id", auth.user.id)
    .order("version", { ascending: false })
    .limit(50);
  if (plansError) return <PlanLoadError />;

  const availablePlans = plans ?? [];
  const activePlans = availablePlans.filter(
    (plan) => plan.status === "generated" || plan.status === "accepted",
  );
  const acceptedPlan = activePlans.find((plan) => plan.status === "accepted");
  const requestedParams = await searchParams;
  const requestedView = requestedParams.view;
  const requestedVersionValue = requestedParams.version;
  const requestedVersion =
    typeof requestedVersionValue === "string" &&
    /^[1-9]\d*$/.test(requestedVersionValue)
      ? Number(requestedVersionValue)
      : null;
  const requestedPlan =
    requestedVersion === null
      ? undefined
      : availablePlans.find(
          (plan) =>
            plan.version === requestedVersion &&
            (plan.status === "generated" ||
              plan.status === "accepted" ||
              plan.status === "superseded"),
        );
  const selectedPlan =
    requestedView === "accepted" && acceptedPlan
      ? acceptedPlan
      : requestedPlan ?? activePlans[0];
  if (!selectedPlan) return emptyPlan();

  const [daysResult, goalResult, weightsResult] = await Promise.all([
    supabase
      .from("plan_days")
      .select("id,plan_id,day_index,title")
      .eq("plan_id", selectedPlan.id)
      .order("day_index"),
    supabase
      .from("goals")
      .select("id,target_weight_kg")
      .eq("id", selectedPlan.goal_id)
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    supabase
      .from("weight_entries")
      .select("weight_kg")
      .eq("user_id", auth.user.id)
      .eq("is_onboarding_baseline", true)
      .maybeSingle(),
  ]);
  if (daysResult.error || goalResult.error || weightsResult.error) {
    return <PlanLoadError />;
  }

  const planDays = daysResult.data ?? [];
  if (planDays.length !== 7) return <PlanLoadError />;
  const dayIds = planDays.map((day) => day.id);
  const mealsResult = dayIds.length
    ? await supabase
        .from("plan_meals")
        .select("id,meal_type,plan_day_id,sort_order")
        .in("plan_day_id", dayIds)
        .order("sort_order")
    : null;
  if (mealsResult?.error) return <PlanLoadError />;
  const meals = mealsResult?.data ?? [];
  if (meals.length !== 21) return <PlanLoadError />;
  const mealIds = meals.map((meal) => meal.id);
  const itemsResult = mealIds.length
    ? await supabase
        .from("plan_items")
        .select(
          "id,food_id,measurement_basis,plan_meal_id,preparation_note,quantity,sort_order,substitution_group,unit,verification_status",
        )
        .in("plan_meal_id", mealIds)
        .order("sort_order")
    : null;
  if (itemsResult?.error) return <PlanLoadError />;
  const items = itemsResult?.data ?? [];
  if (
    meals.some(
      (meal) => !items.some((item) => item.plan_meal_id === meal.id),
    )
  ) {
    return <PlanLoadError />;
  }
  const foodIds = [...new Set(items.map((item) => item.food_id))];
  const [foodsResult, nutritionResult] = await Promise.all([
    foodIds.length
      ? supabase
          .from("foods")
          .select("id,english_name")
          .in("id", foodIds)
      : Promise.resolve(null),
    foodIds.length
      ? supabase
          .from("food_nutrition")
          .select(
            "calories,carbohydrate_g,fat_g,fiber_g,food_id,id,measurement_basis,protein_g,reference_quantity,reference_unit,serving_weight_grams,sodium_mg,source_name,source_reference,source_version,verification_status,verified_at,created_at,updated_at",
          )
          .in("food_id", foodIds)
      : Promise.resolve(null),
  ]);
  if (foodsResult?.error || nutritionResult?.error) {
    return <PlanLoadError />;
  }

  const foodsById = new Map(
    (foodsResult?.data ?? []).map((food) => [food.id, food.english_name]),
  );
  const nutritionByKey = new Map(
    (nutritionResult?.data ?? []).map((record) => [
      `${record.food_id}:${record.measurement_basis}`,
      record,
    ]),
  );
  if (
    foodsById.size !== foodIds.length ||
    items.some(
      (item) =>
        !nutritionByKey.has(`${item.food_id}:${item.measurement_basis}`),
    )
  ) {
    return <PlanLoadError />;
  }
  const displayDays: PlanDayDisplay[] = planDays.map((planDay) => ({
    label: planDay.title?.trim() || `Day ${planDay.day_index}`,
    meals: meals
      .filter((meal) => meal.plan_day_id === planDay.id)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((meal) => {
        const mealItems = items
          .filter((item) => item.plan_meal_id === meal.id)
          .sort((left, right) => left.sort_order - right.sort_order);
        return {
          title: titleCase(meal.meal_type),
          summary: buildMealSummary(mealItems, nutritionByKey),
          foods: mealItems.map((item) => {
            const nutrition = nutritionByKey.get(
              `${item.food_id}:${item.measurement_basis}`,
            );
            return [
              foodsById.get(item.food_id) ?? "Unknown catalog food",
              `${Number(item.quantity).toLocaleString()} ${item.unit}`,
              item.measurement_basis,
              displayVerification(item, nutrition),
              item.preparation_note,
              item.substitution_group,
            ];
          }),
        };
      }),
  }));

  const parsedPlan = aiPlanSchema.safeParse(
    selectedPlan.validated_output_snapshot,
  );
  const startWeight =
    readPlanSnapshotWeight(selectedPlan.input_snapshot, "startWeightKg") ??
    weightsResult.data?.weight_kg ??
    null;
  const targetWeight =
    readPlanSnapshotWeight(selectedPlan.input_snapshot, "targetWeightKg") ??
    goalResult.data?.target_weight_kg ??
    null;
  const history: PlanHistoryDisplay[] = availablePlans.map((plan: PlanRow) => ({
    id: plan.id,
    version: plan.version,
    status: titleCase(plan.status),
    date: displayDate(plan.accepted_at ?? plan.created_at),
    reviewable:
      plan.status === "generated" ||
      plan.status === "accepted" ||
      plan.status === "superseded",
  }));

  return (
    <PlanView
      key={selectedPlan.id}
      acceptedLabel={
        selectedPlan.status === "accepted" && selectedPlan.accepted_at
          ? `Accepted ${displayDate(selectedPlan.accepted_at)}`
          : "Accepted"
      }
      acceptedVersion={acceptedPlan?.version ?? null}
      assumptions={
        parsedPlan.success
          ? parsedPlan.data.assumptions
          : ["The stored plan assessment could not be validated for display."]
      }
      days={displayDays}
      energyRange={readRange(selectedPlan.input_snapshot, "energyKcal")}
      goalAssessment={
        parsedPlan.success
          ? parsedPlan.data.goalAssessment
          : "The stored goal assessment is unavailable."
      }
      history={history}
      hydrationGuidance={
        parsedPlan.success
          ? parsedPlan.data.hydrationGuidance
          : "Hydration guidance is unavailable."
      }
      initialPlanId={selectedPlan.id}
      initialStatus={
        selectedPlan.status === "generated"
          ? "draft"
          : selectedPlan.status === "accepted"
            ? "accepted"
            : "historical"
      }
      majorReasons={parsedPlan.success ? parsedPlan.data.majorReasons : []}
      proteinRange={readRange(
        selectedPlan.input_snapshot,
        "proteinGrams",
      )}
      providerLabel={
        selectedPlan.provider === "mock"
          ? "Mock AI plan — development only"
          : `Suggested by AI · ${selectedPlan.model}`
      }
      safetyNotes={parsedPlan.success ? parsedPlan.data.safetyNotes : []}
      serverBacked
      startWeightKg={startWeight}
      targetWeightKg={targetWeight}
      version={selectedPlan.version}
      weeklyReviewRules={
        parsedPlan.success ? parsedPlan.data.weeklyReviewRules : []
      }
    />
  );
}
