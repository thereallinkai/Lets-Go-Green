import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

export async function POST() {
  if (isDevelopmentDemo()) return apiSuccess({ loggedOut: true });
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      return apiError(
        "LOGOUT_FAILED",
        "Logout could not be completed.",
        503,
        {
          details:
            "Your session may still be active. Check the connection and try logging out again.",
          retryable: true,
          action: { kind: "retry", label: "Try logging out again" },
        },
      );
    }
    return apiSuccess({ loggedOut: true });
  } catch {
    return apiError("AUTH_UNAVAILABLE", "Logout could not be completed.", 503, {
      details:
        "Your session may still be active. Check the connection and try logging out again.",
      retryable: true,
      action: { kind: "retry", label: "Try logging out again" },
    });
  }
}
