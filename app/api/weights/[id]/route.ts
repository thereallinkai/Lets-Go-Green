import { z } from "zod";
import { convertWeight } from "@/src/lib/domain";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import {
  isProtectedBaselineError,
  weightAuthUnavailable,
} from "@/src/lib/weight-entry-errors";

const updateSchema = z.object({
  weight: z.number().positive(),
  unit: z.enum(["kg", "lb"]),
});

async function userClient() {
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  return { supabase, user: data.user, authError };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsedId = z.string().uuid().safeParse(id);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsed.success) return apiError("INVALID_WEIGHT", "The weight update was not valid.", 422);
  const weightKg = convertWeight(parsed.data.weight, parsed.data.unit, "kg");
  if (weightKg < 20 || weightKg > 500) return apiError("WEIGHT_OUT_OF_RANGE", "The weight is outside the supported range.", 422);
  if (isDevelopmentDemo()) return apiSuccess({ id, weightKg });
  try {
    const { supabase, user, authError } = await userClient();
    if (authError && !isAuthSessionMissing(authError)) {
      return publicError(weightAuthUnavailable());
    }
    if (!user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to edit weight entries.", 401);
    }
    const { data, error } = await supabase.rpc("update_weight_entry", {
      target_entry_id: id,
      entry_weight_kg: weightKg,
      entry_source_display_unit: parsed.data.unit,
    });
    if (isProtectedBaselineError(error)) {
      return baselineProtectedError();
    }
    if (error) return apiError("WEIGHT_UPDATE_FAILED", "The weight entry could not be updated.", 500);
    if (!data) return apiError("WEIGHT_NOT_FOUND", "That weight entry was not found.", 404);
    return apiSuccess(data);
  } catch {
    return apiError("SERVICE_UNAVAILABLE", "Weight services are temporarily unavailable.", 503);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return apiError("INVALID_WEIGHT_ID", "The weight entry identifier is invalid.", 422);
  if (isDevelopmentDemo()) return apiSuccess({ deleted: true });
  try {
    const { supabase, user, authError } = await userClient();
    if (authError && !isAuthSessionMissing(authError)) {
      return publicError(weightAuthUnavailable());
    }
    if (!user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to delete weight entries.", 401);
    }
    const { data, error } = await supabase.rpc("delete_weight_entry", {
      target_entry_id: id,
    });
    if (isProtectedBaselineError(error)) {
      return baselineProtectedError();
    }
    if (error) return apiError("WEIGHT_DELETE_FAILED", "The weight entry could not be deleted.", 500);
    if (!data) return apiError("WEIGHT_NOT_FOUND", "That weight entry was not found.", 404);
    return apiSuccess({ deleted: true });
  } catch {
    return apiError("SERVICE_UNAVAILABLE", "Weight services are temporarily unavailable.", 503);
  }
}

function baselineProtectedError() {
  return apiError(
    "BASELINE_WEIGHT_IMMUTABLE",
    "Your onboarding starting weight is protected.",
    409,
    {
      details:
        "The starting weight anchors plan history and progress. Add or edit a later reading instead.",
      retryable: false,
      action: { kind: "edit", label: "Choose another entry" },
    },
  );
}
