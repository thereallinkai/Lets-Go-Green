import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageLoadError } from "@/components/page-load-error";
import {
  ProfileView,
  type ProfileViewData,
} from "@/components/profile-view";
import { isDevelopmentDemo } from "@/src/lib/env";
import {
  localDateInTimeZone,
  resolveProfileAge,
} from "@/src/lib/domain";
import {
  createSupabaseServerClient,
  getCurrentProfile,
  getCurrentUser,
} from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };

function profileLoadError() {
  return (
    <PageLoadError
      title="Your profile could not be loaded."
      message="Some stored profile details are unavailable. Reload before relying on or editing this information."
      retryHref="/profile"
      retryLabel="Reload Profile"
    />
  );
}

const demoProfile: ProfileViewData = {
  mode: "demo",
  account: {
    email: "demo@letsgogreen.local",
    createdAt: "2026-07-24T12:00:00Z",
  },
  profile: {
    fullName: "Jamie Rivera",
    dateOfBirth: "1995-04-12",
    age: 31,
    gender: "prefer_not_to_say",
    heightCm: 172,
    preferredWeightUnit: "kg",
    timeZone: "America/New_York",
    activityLevel: "moderately_active",
    trainingDaysPerWeek: 3,
    allergies: ["Peanuts"],
    dietaryRestrictions: [],
    dislikedFoods: ["Mushrooms"],
    hasSafetyContext: false,
    onboardingCompletedAt: "2026-07-24T12:00:00Z",
  },
  goal: {
    goalType: "fat_loss",
    targetWeightKg: 72,
    targetDate: "2026-10-16",
  },
  latestWeightKg: 80.7,
  mealPreferenceCount: 9,
  preferredFoods: [
    "Rolled oats",
    "Greek yogurt",
    "Blueberries",
    "Brown rice",
  ],
};

export default async function ProfilePage() {
  if (isDevelopmentDemo()) {
    const dateOfBirth = demoProfile.profile.dateOfBirth;
    const currentAge = dateOfBirth
      ? resolveProfileAge(
          dateOfBirth,
          demoProfile.profile.age,
          localDateInTimeZone(new Date(), demoProfile.profile.timeZone),
        )
      : demoProfile.profile.age;
    return (
      <ProfileView
        data={{
          ...demoProfile,
          profile: { ...demoProfile.profile, age: currentAge },
        }}
      />
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createSupabaseServerClient();

  const [profileResult, goalResult, latestWeightResult, preferenceCountResult] =
    await Promise.all([
      getCurrentProfile(user.id),
      supabase
        .from("goals")
        .select("goal_type,target_weight_kg,target_date")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("weight_entries")
        .select("weight_kg")
        .eq("user_id", user.id)
        .order("local_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("meal_preferences")
        .select("food:foods(english_name)", { count: "exact" })
        .eq("user_id", user.id)
        .order("meal_type")
        .order("sort_order")
        .limit(12),
    ]);
  if (
    profileResult.error ||
    goalResult.error ||
    latestWeightResult.error ||
    preferenceCountResult.error
  ) {
    return profileLoadError();
  }

  const profile = profileResult.data;
  const goal = goalResult.data;
  let profileAge = profile?.age ?? null;
  if (profile?.date_of_birth) {
    try {
      profileAge = resolveProfileAge(
        profile.date_of_birth,
        profile.age,
        localDateInTimeZone(new Date(), profile.time_zone),
      );
    } catch {
      return profileLoadError();
    }
  }
  const data: ProfileViewData = {
    mode: "authenticated",
    account: {
      email: user.email ?? "Email unavailable",
      createdAt: user.created_at,
    },
    profile: {
      fullName:
        profile?.full_name ??
        String(user.user_metadata.full_name ?? "Member"),
      dateOfBirth: profile?.date_of_birth ?? null,
      age: profileAge,
      gender: profile?.gender ?? null,
      heightCm: profile?.height_cm ?? null,
      preferredWeightUnit: profile?.preferred_weight_unit ?? "kg",
      timeZone: profile?.time_zone ?? "UTC",
      activityLevel: profile?.activity_level ?? null,
      trainingDaysPerWeek: profile?.training_days_per_week ?? null,
      allergies: profile?.allergies ?? [],
      dietaryRestrictions: profile?.dietary_restrictions ?? [],
      dislikedFoods: profile?.disliked_foods ?? [],
      hasSafetyContext: Boolean(profile?.safety_context),
      onboardingCompletedAt: profile?.onboarding_completed_at ?? null,
    },
    goal: goal
      ? {
          goalType: goal.goal_type,
          targetWeightKg: goal.target_weight_kg,
          targetDate: goal.target_date,
        }
      : null,
    latestWeightKg: latestWeightResult.data?.weight_kg ?? null,
    mealPreferenceCount: preferenceCountResult.count ?? 0,
    preferredFoods: [
      ...new Set(
        (preferenceCountResult.data ?? []).flatMap((preference) =>
          preference.food?.english_name
            ? [preference.food.english_name]
            : [],
        ),
      ),
    ],
  };

  return <ProfileView data={data} />;
}
