import { z } from "zod";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import {
  classifyAuthError,
  isIdentityConcealingAuthError,
} from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const schema = z.object({ email: z.string().trim().email() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("INVALID_EMAIL", "Enter a valid email address.", 422, {
      details: "Check the address for typing mistakes before requesting another code.",
      retryable: false,
      action: { kind: "edit", label: "Edit email" },
    });
  }
  if (isDevelopmentDemo()) return apiSuccess({ sent: true });
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resend({
      email: parsed.data.email,
      type: "signup",
    });
    if (error) {
      if (isIdentityConcealingAuthError(error)) {
        return apiSuccess({ sent: true });
      }
      return publicError(classifyAuthError(error, "resend_verification"));
    }
    return apiSuccess({ sent: true });
  } catch (error) {
    return publicError(classifyAuthError(error, "resend_verification"));
  }
}
