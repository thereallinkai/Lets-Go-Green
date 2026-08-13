import { apiSuccess } from "@/src/lib/api-response";
import {
  getAIProviderMode,
  isDevelopmentDemo,
  isSupabaseConfigured,
} from "@/src/lib/env";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";

const EXPECTED_MIGRATION =
  "20260810050000_make_label_uploads_crash_recoverable";

export async function GET() {
  let database: "reachable" | "unavailable" | "not_configured" = "not_configured";
  let migration: "compatible" | "unknown" = "unknown";

  if (isSupabaseConfigured()) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc("application_health", {
        expected_migration: EXPECTED_MIGRATION,
      });
      const result =
        data && typeof data === "object" && !Array.isArray(data)
          ? data
          : null;
      database =
        !error && result?.databaseReachable === true
          ? "reachable"
          : "unavailable";
      migration =
        !error && result?.migrationCompatible === true
          ? "compatible"
          : "unknown";
    } catch {
      database = "unavailable";
    }
  }

  const ready =
    (isDevelopmentDemo() && database === "not_configured") ||
    (database === "reachable" && migration === "compatible");

  return apiSuccess({
    application: "available",
    readiness: ready ? "ready" : "degraded",
    database,
    migration: { status: migration, expected: EXPECTED_MIGRATION },
    aiProvider: getAIProviderMode(),
  }, ready ? 200 : 503);
}
