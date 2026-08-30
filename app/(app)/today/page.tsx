import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageLoadError } from "@/components/page-load-error";
import {
  TodayDashboard,
  type TodayWeightPoint,
} from "@/components/today-dashboard";
import { loadDayMealCheckins } from "@/src/lib/checkin-loader";
import {
  PRIMARY_MEAL_TYPES,
  addLocalDays,
  assessGoalAwareNutrition,
  formatLocalDate,
  localDateInTimeZone,
  remainingDays,
  resolveProfileAge,
  resolvePlanDay,
  type MealSlot,
} from "@/src/lib/domain";
import { isDevelopmentDemo } from "@/src/lib/env";
import {
  createSupabaseServerClient,
  getCurrentProfile,
  getCurrentUser,
} from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "Today" };

type TodaySupabaseClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

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

async function loadPlanMealDetails(
  supabase: TodaySupabaseClient,
  planId: string,
  dayIndex: number,
) {
  const result = await supabase
    .from("plan_days")
    .select(
      "plan_meals(id,meal_type,sort_order,plan_items(sort_order,food:foods(english_name)))",
    )
    .eq("plan_id", planId)
    .eq("day_index", dayIndex)
    .maybeSingle();
  if (result.error) {
    return {
      data: undefined as Partial<Record<MealSlot, string>> | undefined,
      error: result.error,
    };
  }

  const planMeals = [...(result.data?.plan_meals ?? [])].sort(
    (left, right) => left.sort_order - right.sort_order,
  );
  return {
    data: result.data
      ? (Object.fromEntries(
          planMeals.map((meal) => [
            meal.meal_type,
            [...(meal.plan_items ?? [])]
              .sort((left, right) => left.sort_order - right.sort_order)
              .flatMap((item) =>
                item.food ? [item.food.english_name] : [],
              )
              .join(", ") || "No items in this meal.",
          ]),
        ) as Partial<Record<MealSlot, string>>)
      : undefined,
    error: null,
  };
}

export default async function TodayPage() {
  if (isDevelopmentDemo()) return <TodayDashboard />;

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createSupabaseServerClient();

  const [
    profileResult,
    goalResult,
    weightsResult,
    baselineWeightResult,
    planResult,
  ] =
    await Promise.all([
      getCurrentProfile(user.id),
      supabase
        .from("goals")
        .select("goal_type,target_weight_kg,target_date,plan_start_date")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
      supabase
        .from("weight_entries")
        .select("local_date,weight_kg")
        .eq("user_id", user.id)
        .order("local_date", { ascending: false })
        .limit(30),
      supabase
        .from("weight_entries")
        .select("weight_kg")
        .eq("user_id", user.id)
        .eq("is_onboarding_baseline", true)
        .maybeSingle(),
      supabase
        .from("plans")
        .select("id,provider,model")
        .eq("user_id", user.id)
        .eq("status", "accepted")
        .order("accepted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  if (
    profileResult.error ||
    !profileResult.data ||
    goalResult.error ||
    weightsResult.error ||
    baselineWeightResult.error ||
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
  const resolvedPlanDay =
    planResult.data && goal
      ? resolvePlanDay(today, goal.plan_start_date)
      : null;
  const mealDetailsPromise =
    planResult.data && resolvedPlanDay
      ? loadPlanMealDetails(
          supabase,
          planResult.data.id,
          resolvedPlanDay.dayIndex,
        )
      : Promise.resolve({
          data: undefined as
            | Partial<Record<MealSlot, string>>
            | undefined,
          error: null,
        });
  const [checkinResult, weekResult, mealDetailsResult] = await Promise.all([
    loadDayMealCheckins(supabase, user.id, today),
    supabase
      .from("daily_meal_checkins")
      .select(
        "local_date,meal_type,status",
      )
      .eq("user_id", user.id)
      .gte("local_date", weekStart)
      .lte("local_date", today),
    mealDetailsPromise,
  ]);
  if (checkinResult.error || weekResult.error || mealDetailsResult.error) {
    return todayLoadError();
  }
  const mealDetails = mealDetailsResult.data;

  const weights = weightsResult.data ?? [];
  const latestWeight = weights[0]?.weight_kg ?? null;
  const baseline = baselineWeightResult.data?.weight_kg ?? null;
  const profileAge = profile
    ? resolveProfileAge(profile.date_of_birth, profile.age, today)
    : null;
  const nutritionAssessment =
    goal && profile
      ? assessGoalAwareNutrition({
          currentWeightKg: latestWeight,
          startingWeightKg: baseline,
          targetWeightKg: goal.target_weight_kg,
          planStartDate: goal.plan_start_date,
          targetDate: goal.target_date,
          goalType: goal.goal_type,
          heightCm: profile.height_cm,
          ageYears: profileAge,
          gender: profile.gender,
          profileActivityLevel: profile.activity_level,
          relevantMedicalConcerns: Boolean(profile.safety_context),
        })
      : null;
  const estimate = nutritionAssessment?.estimate ?? null;
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
      day: formatLocalDate(entry.local_date, "weekday-short"),
      weight: entry.weight_kg,
    }));
  return (
    <TodayDashboard
      demoMode={false}
      name={(profile?.full_name ?? "Member").split(/\s+/)[0]}
      timeZone={timeZone}
      renderedLocalDay={today}
      initialCheckins={checkinResult.data}
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
              targetDate: formatLocalDate(goal.target_date, "month-day"),
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
