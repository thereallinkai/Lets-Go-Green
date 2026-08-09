import { z } from "zod";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import { classifyAuthError } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const schema = z.object({ password: z.string().min(10).max(128) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("WEAK_PASSWORD", "Use at least 10 characters.", 422, {
      details: "Use a unique password with a less predictable mix of words or character types.",
      retryable: false,
      action: { kind: "edit", label: "Choose another password" },
    });
  }
  if (isDevelopmentDemo()) return apiSuccess({ updated: true });
  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return publicError(
        classifyAuthError(
          userError ?? { code: "session_expired" },
          "update_password",
        ),
      );
    }
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      return publicError(classifyAuthError(error, "update_password"));
    }
    return apiSuccess({ updated: true });
  } catch (error) {
    return publicError(classifyAuthError(error, "update_password"));
  }
}
