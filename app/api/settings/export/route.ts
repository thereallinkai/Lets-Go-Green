import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Disposition": 'attachment; filename="lets-go-green-demo-data.json"',
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function downloadResponse(data: unknown, filename: string) {
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      ...noStoreHeaders,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET() {
  const generatedAt = new Date().toISOString();
  if (isDevelopmentDemo()) {
    return downloadResponse(
      {
        formatVersion: 3,
        generatedAt,
        demo: true,
        notice:
          "Supabase is not configured. This file contains sample data only and is not an account export.",
        account: {
          email: "demo@letsgogreen.local",
        },
        profile: {
          full_name: "Jamie Rivera",
          preferred_weight_unit: "kg",
          time_zone: "America/New_York",
          allergies: ["Peanuts"],
          dietary_restrictions: [],
          disliked_foods: ["Mushrooms"],
          training_days_per_week: 3,
          safety_context: null,
        },
        goal: {
          goal_type: "fat_loss",
        },
      },
      "lets-go-green-demo-data.json",
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "EXPORT_AUTH_UNAVAILABLE",
        "Your session could not be checked before exporting account data.",
        503,
        {
          details: "No export was created. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try exporting again" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError(
        "SESSION_EXPIRED",
        "Log in again before exporting account data.",
        401,
      );
    }

    const userId = auth.user.id;
    const [
      profileResult,
      legalResult,
      onboardingDraftResult,
      goalsResult,
      weightsResult,
      privateFoodsResult,
      mealPreferencesResult,
      warningsResult,
      plansResult,
      checkinsResult,
      mealCheckinsResult,
      mealItemsResult,
      aiRequestsResult,
      labelSubmissionsResult,
      labelImagesResult,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("legal_acceptances")
        .select("*")
        .eq("user_id", userId)
        .order("accepted_at"),
      supabase
        .from("onboarding_drafts")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("goals")
        .select("*")
        .eq("user_id", userId)
        .order("created_at"),
      supabase
        .from("weight_entries")
        .select("*")
        .eq("user_id", userId)
        .order("local_date"),
      supabase
        .from("foods")
        .select("*")
        .eq("owner_user_id", userId)
        .eq("ownership_type", "private")
        .order("created_at"),
      supabase
        .from("meal_preferences")
        .select(
          "*,food:foods(id,slug,english_name,ownership_type,verification_status)",
        )
        .eq("user_id", userId)
        .order("meal_type")
        .order("sort_order"),
      supabase
        .from("onboarding_warnings")
        .select("*")
        .eq("user_id", userId)
        .order("acknowledged_at"),
      supabase
        .from("plans")
        .select("*")
        .eq("user_id", userId)
        .order("version"),
      supabase
        .from("daily_checkins")
        .select("*")
        .eq("user_id", userId)
        .order("local_date"),
      supabase
        .from("daily_meal_checkins")
        .select("*")
        .eq("user_id", userId)
        .order("local_date")
        .order("meal_type"),
      supabase
        .from("daily_meal_items")
        .select("*,food:foods(id,slug,english_name,verification_status)")
        .eq("user_id", userId)
        .order("created_at"),
      supabase
        .from("ai_generation_requests")
        .select("*")
        .eq("user_id", userId)
        .order("created_at"),
      supabase
        .from("food_label_submissions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at"),
      supabase
        .from("food_label_images")
        .select(
          "id,submission_id,user_id,image_kind,mime_type,byte_size,pixel_width,pixel_height,sha256,created_at",
        )
        .eq("user_id", userId)
        .order("created_at"),
    ]);

    const topLevelResults = [
      profileResult,
      legalResult,
      onboardingDraftResult,
      goalsResult,
      weightsResult,
      privateFoodsResult,
      mealPreferencesResult,
      warningsResult,
      plansResult,
      checkinsResult,
      mealCheckinsResult,
      mealItemsResult,
      aiRequestsResult,
      labelSubmissionsResult,
      labelImagesResult,
    ];
    if (topLevelResults.some((result) => result.error)) {
      return apiError(
        "EXPORT_FAILED",
        "Account data could not be collected for export.",
        500,
      );
    }

    const privateFoodIds = (privateFoodsResult.data ?? []).map(
      (food) => food.id,
    );
    const planIds = (plansResult.data ?? []).map((plan) => plan.id);

    const [
      foodNutritionResult,
      foodCategoriesResult,
      foodAllergensResult,
      foodRestrictionsResult,
      foodProductsResult,
      foodSourcesResult,
      foodSafetyResult,
      planDaysResult,
    ] = await Promise.all([
      privateFoodIds.length
        ? supabase
            .from("food_nutrition")
            .select("*")
            .in("food_id", privateFoodIds)
        : Promise.resolve({ data: [], error: null }),
      privateFoodIds.length
        ? supabase
            .from("food_category_links")
            .select("*,category:food_categories(*)")
            .in("food_id", privateFoodIds)
        : Promise.resolve({ data: [], error: null }),
      privateFoodIds.length
        ? supabase
            .from("food_allergens")
            .select("*,allergen:allergens(*)")
            .in("food_id", privateFoodIds)
        : Promise.resolve({ data: [], error: null }),
      privateFoodIds.length
        ? supabase
            .from("food_dietary_restrictions")
            .select("*,restriction:dietary_restriction_types(*)")
            .in("food_id", privateFoodIds)
        : Promise.resolve({ data: [], error: null }),
      privateFoodIds.length
        ? supabase
            .from("food_products")
            .select("*")
            .in("food_id", privateFoodIds)
        : Promise.resolve({ data: [], error: null }),
      privateFoodIds.length
        ? supabase
            .from("food_sources")
            .select("*")
            .in("food_id", privateFoodIds)
            .order("retrieved_at")
        : Promise.resolve({ data: [], error: null }),
      privateFoodIds.length
        ? supabase
            .from("food_safety_metadata")
            .select("*")
            .in("food_id", privateFoodIds)
        : Promise.resolve({ data: [], error: null }),
      planIds.length
        ? supabase
            .from("plan_days")
            .select("*")
            .in("plan_id", planIds)
            .order("day_index")
        : Promise.resolve({ data: [], error: null }),
    ]);

    const nutritionIds = (foodNutritionResult.data ?? []).map(
      (nutrition) => nutrition.id,
    );
    const foodNutrientAmountsResult = nutritionIds.length
      ? await supabase
          .from("food_nutrient_amounts")
          .select("*")
          .in("nutrition_id", nutritionIds)
          .order("display_order")
      : { data: [], error: null };

    const planDayIds = (planDaysResult.data ?? []).map((day) => day.id);
    const planMealsResult = planDayIds.length
      ? await supabase
          .from("plan_meals")
          .select("*")
          .in("plan_day_id", planDayIds)
          .order("sort_order")
      : { data: [], error: null };
    const planMealIds = (planMealsResult.data ?? []).map((meal) => meal.id);
    const planItemsResult = planMealIds.length
      ? await supabase
          .from("plan_items")
          .select(
            "*,food:foods(id,slug,english_name,ownership_type,verification_status)",
          )
          .in("plan_meal_id", planMealIds)
          .order("sort_order")
      : { data: [], error: null };

    const relatedResults = [
      foodNutritionResult,
      foodCategoriesResult,
      foodAllergensResult,
      foodRestrictionsResult,
      foodProductsResult,
      foodSourcesResult,
      foodSafetyResult,
      foodNutrientAmountsResult,
      planDaysResult,
      planMealsResult,
      planItemsResult,
    ];
    if (relatedResults.some((result) => result.error)) {
      return apiError(
        "EXPORT_FAILED",
        "Related plan or food data could not be collected for export.",
        500,
      );
    }

    const localDate = generatedAt.slice(0, 10);
    return downloadResponse(
      {
        formatVersion: 3,
        generatedAt,
        demo: false,
        account: {
          id: userId,
          email: auth.user.email ?? null,
          createdAt: auth.user.created_at,
          lastSignInAt: auth.user.last_sign_in_at ?? null,
        },
        profile: profileResult.data,
        legalAcceptances: legalResult.data ?? [],
        onboardingDraft: onboardingDraftResult.data,
        goals: goalsResult.data ?? [],
        weightEntries: weightsResult.data ?? [],
        mealPreferences: mealPreferencesResult.data ?? [],
        onboardingWarnings: warningsResult.data ?? [],
        privateFoods: {
          foods: privateFoodsResult.data ?? [],
          nutrition: foodNutritionResult.data ?? [],
          nutrientAmounts: foodNutrientAmountsResult.data ?? [],
          products: foodProductsResult.data ?? [],
          sources: foodSourcesResult.data ?? [],
          safetyMetadata: foodSafetyResult.data ?? [],
          categories: foodCategoriesResult.data ?? [],
          allergens: foodAllergensResult.data ?? [],
          dietaryRestrictions: foodRestrictionsResult.data ?? [],
        },
        foodLabelSubmissions: {
          submissions: labelSubmissionsResult.data ?? [],
          imageMetadata: labelImagesResult.data ?? [],
          notice:
            "Image metadata is included, but raw private label-photo bytes and download URLs are not embedded in this JSON export.",
        },
        plans: {
          versions: plansResult.data ?? [],
          days: planDaysResult.data ?? [],
          meals: planMealsResult.data ?? [],
          items: planItemsResult.data ?? [],
          generationRequests: aiRequestsResult.data ?? [],
        },
        dailyCheckins: checkinsResult.data ?? [],
        dailyMealCheckins: mealCheckinsResult.data ?? [],
        dailyMealItems: mealItemsResult.data ?? [],
      },
      `lets-go-green-data-${localDate}.json`,
    );
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Account export is temporarily unavailable.",
      503,
    );
  }
}
