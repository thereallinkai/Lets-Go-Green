import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { CURRENT_PRODUCT_TOUR_VERSION } from "@/src/lib/product-tour";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const schema = z
  .object({
    version: z.literal(CURRENT_PRODUCT_TOUR_VERSION),
  })
  .strict();

export async function PATCH(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(
      "INVALID_TUTORIAL_VERSION",
      "Refresh the page before saving tutorial progress.",
      422,
    );
  }

  if (isDevelopmentDemo()) {
    return apiSuccess({
      saved: true,
      persisted: false,
      version: parsed.data.version,
    });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "TUTORIAL_AUTH_UNAVAILABLE",
        "Your session could not be checked before saving tutorial progress.",
        503,
        {
          details: "Tutorial progress was not changed. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try saving again" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError(
        "SESSION_EXPIRED",
        "Log in again before saving tutorial progress.",
        401,
      );
    }

    const update = {
      product_tour_completed_version: parsed.data.version,
      product_tour_completed_at: new Date().toISOString(),
    };
    const { data: profile, error } = await supabase
      .from("profiles")
      .update(update)
      .eq("user_id", auth.user.id)
      .select("user_id")
      .maybeSingle();

    if (error) {
      return apiError(
        "TUTORIAL_SAVE_FAILED",
        "Tutorial progress could not be saved.",
        500,
      );
    }
    if (!profile) {
      return apiError(
        "PROFILE_REQUIRED",
        "Complete your profile before saving tutorial progress.",
        409,
      );
    }

    return apiSuccess({
      saved: true,
      persisted: true,
      version: parsed.data.version,
    });
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Tutorial services are temporarily unavailable.",
      503,
    );
  }
}
