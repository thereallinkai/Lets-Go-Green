import { z } from "zod";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import { classifyAuthError } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const schema = z.object({
  email: z.string().trim().email(),
  token: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("INVALID_CODE", "Enter a valid six-digit code.", 422, {
      details: "Use only the newest code sent to the registration email address.",
      retryable: false,
      action: { kind: "edit", label: "Enter the code" },
    });
  }
  if (isDevelopmentDemo()) {
    return parsed.data.token === "123456"
      ? apiSuccess({ verified: true, redirectTo: "/onboarding?step=3" })
      : apiError("INVALID_OR_EXPIRED_CODE", "That code is invalid or expired.", 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
      email: parsed.data.email,
      token: parsed.data.token,
      type: "email",
    });
    if (error || !data.user) {
      return publicError(
        classifyAuthError(
          error ?? { code: "invalid_credentials" },
          "verify_email",
        ),
      );
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("user_id", data.user.id)
      .single();
    if (profileError) {
      return apiError(
        "PROFILE_SETUP_FAILED",
        "Email was verified, but the account profile was not created.",
        500,
        {
          details: "Return to registration for a disposable test account, or contact the site administrator.",
          retryable: false,
          action: { kind: "navigate", label: "Return to registration", href: "/register" },
        },
      );
    }
    return apiSuccess({ verified: true, redirectTo: "/onboarding?step=3" });
  } catch (error) {
    return publicError(classifyAuthError(error, "verify_email"));
  }
}
