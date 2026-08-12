import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (isDevelopmentDemo() && id === "mock-plan-draft") return apiSuccess({ planId: id, status: "accepted" });
  if (!z.string().uuid().safeParse(id).success) return apiError("INVALID_PLAN_ID", "The plan identifier is invalid.", 422);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "PLAN_AUTH_UNAVAILABLE",
        "Your session could not be checked before accepting the plan.",
        503,
        {
          details: "Your current accepted plan is unchanged. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try accepting again" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to accept a plan.", 401);
    }
    const { data, error } = await supabase.rpc("accept_plan", { target_plan_id: id });
    if (error) return apiError("PLAN_ACCEPT_FAILED", "The plan could not be accepted. Your current plan is unchanged.", 409);
    return apiSuccess({ planId: data, status: "accepted" });
  } catch {
    return apiError("SERVICE_UNAVAILABLE", "Plan services are temporarily unavailable.", 503);
  }
}
