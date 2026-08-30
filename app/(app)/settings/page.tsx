import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  SettingsView,
  type SettingsInitialData,
} from "@/components/settings-view";
import {
  getAIProviderMode,
  isDevelopmentDemo,
} from "@/src/lib/env";
import { APP_RELEASE } from "@/src/lib/app-release";
import { loadMealPreferenceSummaries } from "@/src/lib/meal-preference-loader";
import {
  createSupabaseServerClient,
  getCurrentProfile,
  getCurrentUser,
} from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

const demoSettings: SettingsInitialData = {
  mode: "demo",
  release: {
    channelLabel: APP_RELEASE.channelLabel,
    displayVersion: APP_RELEASE.displayVersion,
  },
  account: {
    email: "demo@letsgogreen.local",
    createdAt: null,
  },
  profile: {
    fullName: "Jamie Rivera",
    preferredWeightUnit: "kg",
    timeZone: "America/New_York",
    allergies: ["Peanuts"],
    dietaryRestrictions: [],
    dislikedFoods: ["Mushrooms"],
    trainingDaysPerWeek: 3,
    safetyContext: "",
  },
  goal: {
    id: "demo-goal",
    goalType: "fat_loss",
    targetWeightKg: 72,
    targetDate: "2026-10-16",
  },
  mealPreferences: [
    {
      mealType: "breakfast",
      foodId: "demo-oats",
      foodName: "Oats",
      sortOrder: 0,
    },
    {
      mealType: "lunch",
      foodId: "demo-chicken",
      foodName: "Chicken Breast",
      sortOrder: 0,
    },
    {
      mealType: "dinner",
      foodId: "demo-salmon",
      foodName: "Salmon",
      sortOrder: 0,
    },
  ],
  privateLabelFoods: [],
  activeLabelDrafts: [],
  aiProviderMode: "mock",
  loadErrors: {
    profile: null,
    goal: null,
    mealPreferences: null,
    privateLabelFoods: null,
    activeLabelDrafts: null,
  },
};

export default async function SettingsPage() {
  if (isDevelopmentDemo()) {
    return <SettingsView initialData={demoSettings} />;
  }

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createSupabaseServerClient();

  const userId = user.id;
  const [
    profileResult,
    goalResult,
    mealPreferencesResult,
    privateFoodsResult,
    activeLabelDraftsResult,
  ] = await Promise.all([
    getCurrentProfile(userId),
    supabase
      .from("goals")
      .select("id,goal_type,target_weight_kg,target_date")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadMealPreferenceSummaries(supabase, userId),
    supabase
      .from("foods")
      .select(
        `
          id,
          english_name,
          verification_status,
          created_at,
          food_nutrition (
            measurement_basis,
            serving_weight_grams,
            calories,
            protein_g,
            carbohydrate_g,
            fat_g,
            fiber_g,
            sodium_mg,
            source_reference
          )
        `,
      )
      .eq("owner_user_id", userId)
      .eq("ownership_type", "private")
      .order("created_at"),
    supabase
      .from("food_label_submissions")
      .select("id,status,brand_name,product_name,variant_name,created_at")
      .eq("user_id", userId)
      .in("status", ["draft", "needs_changes"])
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const profile = profileResult.data;
  const goal = goalResult.data;
  const initialData: SettingsInitialData = {
    mode: "authenticated",
    release: {
      channelLabel: APP_RELEASE.channelLabel,
      displayVersion: APP_RELEASE.displayVersion,
    },
    account: {
      email: user.email ?? "Email unavailable",
      createdAt: user.created_at,
    },
    profile: {
      fullName:
        profile?.full_name ??
        String(user.user_metadata.full_name ?? "Member"),
      preferredWeightUnit: profile?.preferred_weight_unit ?? "kg",
      timeZone: profile?.time_zone ?? "UTC",
      allergies: profile?.allergies ?? [],
      dietaryRestrictions: profile?.dietary_restrictions ?? [],
      dislikedFoods: profile?.disliked_foods ?? [],
      trainingDaysPerWeek: profile?.training_days_per_week ?? null,
      safetyContext: profile?.safety_context ?? "",
    },
    goal: goal
      ? {
          id: goal.id,
          goalType: goal.goal_type,
          targetWeightKg: goal.target_weight_kg,
          targetDate: goal.target_date,
        }
      : null,
    mealPreferences: mealPreferencesResult.data,
    privateLabelFoods: (privateFoodsResult.data ?? []).map((food) => {
      const nutrition = food.food_nutrition.find(
        (row) => row.measurement_basis === "label_serving",
      );
      const hasCoreNutrition =
        nutrition?.serving_weight_grams != null &&
        nutrition.calories != null &&
        nutrition.protein_g != null &&
        nutrition.carbohydrate_g != null &&
        nutrition.fat_g != null;
      return {
        id: food.id,
        name: food.english_name,
        verificationStatus: food.verification_status,
        createdAt: food.created_at,
        nutrition:
          nutrition && hasCoreNutrition
            ? {
                servingWeightGrams: nutrition.serving_weight_grams!,
                calories: nutrition.calories!,
                proteinGrams: nutrition.protein_g!,
                carbohydrateGrams: nutrition.carbohydrate_g!,
                fatGrams: nutrition.fat_g!,
                fiberGrams: nutrition.fiber_g,
                sodiumMilligrams: nutrition.sodium_mg,
                sourceNote: nutrition.source_reference ?? "",
              }
            : null,
      };
    }),
    activeLabelDrafts: (activeLabelDraftsResult.data ?? []).flatMap((draft) =>
      draft.status === "draft" || draft.status === "needs_changes"
        ? [
            {
              id: draft.id,
              status: draft.status,
              brandName: draft.brand_name,
              productName: draft.product_name,
              variantName: draft.variant_name,
              createdAt: draft.created_at,
            },
          ]
        : [],
    ),
    aiProviderMode: getAIProviderMode(),
    loadErrors: {
      profile: profileResult.error
        ? "Profile settings could not be loaded. Reload before editing profile or preference values."
        : null,
      goal: goalResult.error
        ? "The active goal could not be loaded. Reload before changing its type."
        : null,
      mealPreferences: mealPreferencesResult.error
        ? "Meal preferences could not be loaded. Reload before editing saved meal foods."
        : null,
      privateLabelFoods: privateFoodsResult.error
        ? "Saved private label foods could not be loaded. Their current state is unavailable; reload to try again."
        : null,
      activeLabelDrafts: activeLabelDraftsResult.error
        ? "Private label drafts could not be loaded. Their current state is unavailable; reload before discarding a draft."
        : null,
    },
  };

  return <SettingsView initialData={initialData} />;
}
