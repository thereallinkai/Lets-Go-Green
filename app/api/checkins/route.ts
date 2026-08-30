import { z } from "zod";
import {
  daysBetweenLocalDates,
  parseLocalDate,
} from "@/src/lib/domain";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { loadCheckinRange } from "@/src/lib/checkin-loader";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const querySchema = z.object({
  from: z.string(),
  to: z.string(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  if (!parsed.success) {
    return apiError(
      "INVALID_DATE_RANGE",
      "Provide a valid local-date range.",
      422,
    );
  }
  try {
    parseLocalDate(parsed.data.from);
    parseLocalDate(parsed.data.to);
    const span = daysBetweenLocalDates(parsed.data.from, parsed.data.to);
    if (span < 0 || span > 62) throw new RangeError();
  } catch {
    return apiError(
      "INVALID_DATE_RANGE",
      "The date range must be valid and no longer than 63 days.",
      422,
    );
  }

  if (isDevelopmentDemo()) return apiSuccess([]);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "CHECKIN_AUTH_UNAVAILABLE",
        "Your session could not be checked before loading check-ins.",
        503,
        {
          details: "No check-in data was changed. Check the connection and try again.",
          retryable: true,
          action: { kind: "retry", label: "Try loading again" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to view check-ins.", 401);
    }
    const result = await loadCheckinRange(
      supabase,
      auth.user.id,
      parsed.data.from,
      parsed.data.to,
    );
    if (result.error) {
      return apiError(
        "CHECKINS_LOAD_FAILED",
        "The calendar check-ins could not be loaded.",
        500,
      );
    }
    return apiSuccess(result.data);
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Calendar services are temporarily unavailable.",
      503,
    );
  }
}
