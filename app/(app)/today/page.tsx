import type { Metadata } from "next";
import { format, parseISO } from "date-fns";
import { redirect } from "next/navigation";
import { PageLoadError } from "@/components/page-load-error";
import {
  TodayDashboard,
  type TodayMealCheckin,
  type TodayMealItem,
  type TodayWeightPoint,
} from "@/components/today-dashboard";
import {
  PRIMARY_MEAL_TYPES,
  addLocalDays,
  calculateNutritionEstimate,
  localDateInTimeZone,
  normalizeMealSlotCheckins,
  remainingDays,
  resolveProfileAge,
  resolvePlanDay,
  type MealCheckinStatus,
  type MealSlot,
} from "@/src/lib/domain";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "Today" };

function todayLoadError() {
  return (
    <PageLoadError
      title="Today could not be loaded."
      message="Your profile, plan, or check-ins could not be loaded safely. Reload this page before recording changes."
      retryHref="/today"
      retryLabel="Reload Today"
    />
  );
}

export default async function TodayPage() {
  if (isDevelopmentDemo()) return <TodayDashboard />;

  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const [profileResult, goalResult, weightsResult, planResult] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "full_name,time_zone,age,date_of_birth,height_cm,gender,activity_level,safety_context",
        )
        .eq("user_id", auth.user.id)
        .single(),
      supabase
        .from("goals")
        .select("goal_type,target_weight_kg,target_date,plan_start_date")
        .eq("user_id", auth.user.id)
        .eq("status", "active")
        .maybeSingle(),
      supabase
        .from("weight_entries")
        .select("local_date,weight_kg,is_onboarding_baseline")
        .eq("user_id", auth.user.id)
        .order("local_date", { ascending: false })
        .limit(30),
      supabase
        .from("plans")
        .select("id,provider,model")
        .eq("user_id", auth.user.id)
        .eq("status", "accepted")
        .order("accepted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  if (
    profileResult.error ||
    goalResult.error ||
    weightsResult.error ||
    planResult.error
  ) {
    return todayLoadError();
  }

  const profile = profileResult.data;
  const goal = goalResult.data;
  const timeZone = profile?.time_zone ?? "UTC";
  let today: string;
  try {
    today = localDateInTimeZone(new Date(), timeZone);
  } catch {
    return todayLoadError();
  }
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = addLocalDays(today, -((weekday + 6) % 7));
  const [checkinResult, weekResult] = await Promise.all([
    supabase
      .from("daily_meal_checkins")
      .select(
        "id,meal_type,status,skip_reason",
      )
      .eq("user_id", auth.user.id)
      .eq("local_date", today),
    supabase
      .from("daily_meal_checkins")
      .select(
        "local_date,meal_type,status",
      )
      .eq("user_id", auth.user.id)
      .gte("local_date", weekStart)
      .lte("local_date", today),
  ]);
  if (checkinResult.error || weekResult.error) {
    return todayLoadError();
  }

  let mealDetails: Partial<Record<MealSlot, string>> | undefined;
  if (planResult.data && goal) {
    const resolved = resolvePlanDay(today, goal.plan_start_date);
    if (resolved) {
      const planDayResult = await supabase
        .from("plan_days")
        .select("id")
        .eq("plan_id", planResult.data.id)
        .eq("day_index", resolved.dayIndex)
        .maybeSingle();
      if (planDayResult.error) return todayLoadError();
      const planDay = planDayResult.data;
      if (planDay) {
        const planMealsResult = await supabase
          .from("plan_meals")
          .select("id,meal_type")
          .eq("plan_day_id", planDay.id)
          .order("sort_order");
        if (planMealsResult.error) return todayLoadError();
        const planMeals = planMealsResult.data;
        const mealIds = (planMeals ?? []).map((meal) => meal.id);
        const planItemsResult = mealIds.length
          ? await supabase
              .from("plan_items")
              .select("plan_meal_id,sort_order,food:foods(english_name)")
              .in("plan_meal_id", mealIds)
              .order("sort_order")
          : { data: [], error: null };
        if (planItemsResult.error) return todayLoadError();
        const planItems = planItemsResult.data;
        mealDetails = Object.fromEntries(
          (planMeals ?? []).map((meal) => [
            meal.meal_type,
            (planItems ?? [])
              .filter((item) => item.plan_meal_id === meal.id)
              .flatMap((item) =>
                item.food ? [item.food.english_name] : [],
              )
              .join(", ") || "No items in this meal.",
          ]),
        );
      }
    }
  }

  const weights = weightsResult.data ?? [];
  const latestWeight = weights[0]?.weight_kg ?? null;
  const baseline =
    weights.find((entry) => entry.is_onboarding_baseline)?.weight_kg ?? null;
  const activityMap = {
    sedentary: "sedentary",
    lightly_active: "light",
    moderately_active: "moderate",
    very_active: "very_active",
    extremely_active: "very_active",
  } as const;
  const profileAge = profile
    ? resolveProfileAge(profile.date_of_birth, profile.age, today)
    : null;
  const estimate =
    goal && profile
      ? calculateNutritionEstimate({
          weightKg: latestWeight,
          heightCm: profile.height_cm,
          ageYears: profileAge,
          sexForEstimate:
            profile.gender === "male" || profile.gender === "female"
              ? profile.gender
              : "unspecified",
          activityLevel: profile.activity_level
            ? activityMap[profile.activity_level]
            : null,
          goalType: goal.goal_type,
          relevantMedicalConcerns: Boolean(profile.safety_context),
        })
      : null;
  const weeklyPrimary = (weekResult.data ?? []).filter((checkin) =>
    PRIMARY_MEAL_TYPES.includes(
      checkin.meal_type as (typeof PRIMARY_MEAL_TYPES)[number],
    ),
  );
  const weeklyMarked = weeklyPrimary.filter(
    (checkin) => checkin.status !== "not_marked",
  ).length;
  const weeklySkipped = weeklyPrimary.filter(
    (checkin) => checkin.status === "skipped",
  ).length;
  const elapsedWeekDays =
    Math.max(1, Math.round((Date.parse(`${today}T12:00:00Z`) -
      Date.parse(`${weekStart}T12:00:00Z`)) / 86_400_000) + 1);
  const weightPoints: TodayWeightPoint[] = weights
    .slice(0, 7)
    .reverse()
    .map((entry) => ({
      day: format(parseISO(entry.local_date), "EEE"),
      weight: entry.weight_kg,
    }));
  const todayRows = (checkinResult.data ?? []) as Array<{
    id: string;
    meal_type: MealSlot;
    skip_reason: string | null;
    status: MealCheckinStatus;
  }>;
  const todayMealIds = todayRows.map((meal) => meal.id);
  const mealItemsResult = todayMealIds.length
    ? await supabase
        .from("daily_meal_items")
        .select(
          "id,meal_checkin_id,food:foods(id,english_name,verification_status)",
        )
        .eq("user_id", auth.user.id)
        .in("meal_checkin_id", todayMealIds)
        .order("sort_order")
    : { data: [], error: null };
  if (mealItemsResult.error) return todayLoadError();
  const mealItemRows = mealItemsResult.data;
  const initialCheckins: TodayMealCheckin[] = normalizeMealSlotCheckins(
    todayRows.map((row) => ({
      mealType: row.meal_type,
      status: row.status,
      skipReason: row.skip_reason,
    })),
  ).map((checkin) => {
    const storedMeal = todayRows.find(
      (row) => row.meal_type === checkin.mealType,
    );
    const items: TodayMealItem[] = storedMeal
      ? (mealItemRows ?? [])
          .filter((item) => item.meal_checkin_id === storedMeal.id)
          .flatMap((item) =>
            item.food
              ? [
                  {
                    id: item.id,
                    foodId: item.food.id,
                    name: item.food.english_name,
                    verificationStatus: item.food.verification_status,
                  },
                ]
              : [],
          )
      : [];
    return { ...checkin, items };
  });

  return (
    <TodayDashboard
      demoMode={false}
      name={(profile?.full_name ?? "Member").split(/\s+/)[0]}
      timeZone={timeZone}
      renderedLocalDay={today}
      initialCheckins={initialCheckins}
      mealDetails={mealDetails}
      weightPoints={weightPoints}
      providerLabel={
        planResult.data
          ? planResult.data.provider === "mock"
            ? "Mock AI plan — development only"
            : `Suggested by AI · ${planResult.data.model}`
          : "No accepted plan yet"
      }
      weeklyMarked={weeklyMarked}
      weeklyPossible={elapsedWeekDays * 3}
      weeklySkipped={weeklySkipped}
      energyRange={
        estimate?.calorieRange
          ? {
              minimum: estimate.calorieRange.minimum,
              maximum: estimate.calorieRange.maximum,
            }
          : null
      }
      proteinRange={
        estimate?.proteinRange
          ? {
              minimum: estimate.proteinRange.minimum,
              maximum: estimate.proteinRange.maximum,
            }
          : null
      }
      goalContext={
        goal
          ? {
              type: goal.goal_type,
              targetDate: format(parseISO(goal.target_date), "MMM d"),
              currentKg: latestWeight,
              targetKg: goal.target_weight_kg,
              startKg: baseline,
              remainingDays: remainingDays(goal.target_date, {
                timeZone,
              }),
            }
          : null
      }
    />
  );
}
