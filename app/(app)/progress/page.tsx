import type { Metadata } from "next";
import { format, parseISO } from "date-fns";
import {
  ProgressView,
  type ProgressEntry,
} from "@/components/progress-view";
import { isDevelopmentDemo } from "@/src/lib/env";
import {
  createSupabaseServerClient,
  getCurrentProfile,
  getCurrentUser,
} from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "Progress" };

export default async function ProgressPage() {
  if (isDevelopmentDemo()) return <ProgressView />;

  const user = await getCurrentUser();
  if (!user) return <ProgressView initialEntries={[]} />;
  const supabase = await createSupabaseServerClient();

  const [weights, profile, goal] = await Promise.all([
    supabase
      .from("weight_entries")
      .select("id,local_date,weight_kg,is_onboarding_baseline")
      .eq("user_id", user.id)
      .order("local_date", { ascending: false }),
    getCurrentProfile(user.id),
    supabase
      .from("goals")
      .select("target_weight_kg")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  const entries: ProgressEntry[] = (weights.data ?? []).map((entry) => ({
    id: entry.id,
    date: format(parseISO(entry.local_date), "MMM d"),
    isoDate: entry.local_date,
    kg: entry.weight_kg,
    isBaseline: entry.is_onboarding_baseline,
  }));
  const baseline =
    (weights.data ?? []).find((entry) => entry.is_onboarding_baseline)
      ?.weight_kg ?? null;

  return (
    <ProgressView
      initialEntries={entries}
      baselineKg={baseline}
      targetKg={goal.data?.target_weight_kg ?? null}
      preferredUnit={profile.data?.preferred_weight_unit ?? "kg"}
      timeZone={profile.data?.time_zone ?? "UTC"}
    />
  );
}
