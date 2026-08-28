import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/src/types/database";
import { getPublicEnv, isSupabaseConfigured } from "@/src/lib/env";

const CURRENT_PROFILE_FIELDS =
  "activity_level,age,allergies,date_of_birth,dietary_restrictions,disliked_foods,full_name,gender,height_cm,onboarding_completed_at,onboarding_status,preferred_weight_unit,product_tour_completed_version,safety_context,time_zone,training_days_per_week";

export async function createSupabaseServerClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Local Supabase is not configured. Run npm run bootstrap.");
  }

  const env = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot write cookies. Proxy refreshes sessions.
          }
        },
      },
    },
  );
}

export const getCurrentUser = cache(async function getCurrentUser() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
});

export const getCurrentProfile = cache(async function getCurrentProfile(
  userId: string,
) {
  const supabase = await createSupabaseServerClient();
  return supabase
    .from("profiles")
    .select(CURRENT_PROFILE_FIELDS)
    .eq("user_id", userId)
    .maybeSingle();
});
