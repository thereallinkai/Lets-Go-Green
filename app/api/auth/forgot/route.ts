import { z } from "zod";
import { apiSuccess, publicError } from "@/src/lib/api-response";
import { classifyAuthError } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const schema = z.object({ email: z.string().trim().email() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (parsed.success && !isDevelopmentDemo()) {
    try {
      const supabase = await createSupabaseServerClient();
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${origin}/auth/callback?purpose=recovery&next=/reset-password`,
      });
      if (error) {
        const code = typeof error.code === "string" ? error.code : "";
        if (
          code === "user_not_found" ||
          code === "invalid_credentials" ||
          code === "email_address_invalid"
        ) {
          return apiSuccess({ sent: true });
        }
        return publicError(classifyAuthError(error, "request_recovery"));
      }
    } catch (error) {
      return publicError(classifyAuthError(error, "request_recovery"));
    }
  }
  // Invalid input and identity-specific provider errors deliberately look like
  // success so recovery cannot reveal whether an email address has an account.
  return apiSuccess({ sent: true });
}
