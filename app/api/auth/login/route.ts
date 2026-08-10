import { z } from "zod";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import { classifyAuthError } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicError(
      classifyAuthError({ code: "invalid_credentials" }, "login"),
    );
  }
  if (isDevelopmentDemo()) return apiSuccess({ redirectTo: "/today" });
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return publicError(classifyAuthError(error, "login"));
    if (!data.user) {
      return publicError(
        classifyAuthError({ code: "invalid_credentials" }, "login"),
      );
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("onboarding_status")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (profileError) {
      return apiError(
        "PROFILE_STATUS_UNAVAILABLE",
        "Your account was accepted, but its onboarding status could not be loaded.",
        503,
        {
          details: "No profile changes were made. Try logging in again.",
          retryable: true,
          action: { kind: "retry", label: "Try logging in again" },
        },
      );
    }
    const redirectTo =
      profile?.onboarding_status === "completed"
        ? "/today"
        : "/onboarding?step=3";
    return apiSuccess({ redirectTo });
  } catch (error) {
    return publicError(classifyAuthError(error, "login"));
  }
}
