import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { confirmedFoodLabelDataSchema } from "@/src/lib/domain/food-label";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const requestSchema = z
  .object({
    action: z.literal("confirm"),
    labelData: confirmedFoodLabelDataSchema,
  })
  .strict();

type RpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

function confirmationError(error: NonNullable<RpcResult["error"]>) {
  const code = (error.code ?? "").toUpperCase();
  const message = (error.message ?? "").toLocaleLowerCase("en-US");
  if (code === "42501") {
    return apiError(
      "SESSION_EXPIRED",
      "Log in again before confirming this label.",
      401,
      {
        details: "The draft and private photo were not changed.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      },
    );
  }
  if (code === "23514" && message.includes("allergen")) {
    return apiError(
      "LABEL_ALLERGEN_SELECTIONS_INCOMPLETE",
      "The package allergen statement and selected allergens do not match.",
      422,
      {
        details:
          "Select every allergen named in the printed statement, including any may-contain warning, then confirm again.",
        retryable: false,
        action: { kind: "edit", label: "Review allergen selections" },
      },
    );
  }
  if (code === "23514" && message.includes("match")) {
    return apiError(
      "LABEL_CONFIRMATION_CHANGED",
      "The final confirmation does not match the saved label draft.",
      409,
      {
        details:
          "Review the current fields. If any printed fact changed, start a fresh draft with the corrected transcription.",
        retryable: false,
        action: { kind: "edit", label: "Review package-label fields" },
      },
    );
  }
  if (code === "23514" && message.includes("image")) {
    return apiError(
      "LABEL_IMAGE_REQUIRED",
      "A readable nutrition-label photo is required before confirmation.",
      409,
      {
        details:
          "Choose a clear JPEG or PNG showing the full printed panel, upload it, and confirm again.",
        retryable: false,
        action: { kind: "edit", label: "Choose another label photo" },
      },
    );
  }
  if (code === "23514") {
    return apiError(
      "LABEL_REVIEW_REQUIRED",
      "The required package-label review is incomplete.",
      422,
      {
        details:
          "Confirm the transcription, complete the allergen and diet reviews, and try again.",
        retryable: false,
        action: { kind: "edit", label: "Review confirmations" },
      },
    );
  }
  if (code === "22023") {
    return apiError(
      "LABEL_VALUES_UNSUPPORTED",
      "One or more confirmed package values cannot be used safely.",
      422,
      {
        details:
          "Review the serving values, safety selections, and required text against the package; do not estimate missing facts.",
        retryable: false,
        action: { kind: "edit", label: "Review package-label fields" },
      },
    );
  }
  if (code === "40001" || code === "40P01") {
    return apiError(
      "LABEL_CONFIRM_CONFLICT",
      "The label changed while confirmation was being saved.",
      409,
      {
        details: "The draft and private photo remain saved. Review once and retry.",
        retryable: true,
        action: { kind: "retry", label: "Retry confirmation" },
      },
    );
  }
  return apiError(
    "LABEL_CONFIRM_FAILED",
    "The confirmed product could not be saved.",
    500,
    {
      details:
        "The draft and private photo remain saved. Check the connection and retry once.",
      retryable: true,
      action: { kind: "retry", label: "Retry confirmation" },
    },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("INVALID_LABEL_ID", "The label draft ID is invalid.", 422, {
      details: "Return to the package-label form and start a new submission.",
      retryable: false,
      action: { kind: "edit", label: "Start a new label submission" },
    });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(
      "INVALID_LABEL_CONFIRMATION",
      "Review every required label field and confirm the transcription.",
      422,
      {
        details:
          "The final request must match the saved draft and include explicit nutrition, allergen, and diet-review confirmations.",
        retryable: false,
        action: { kind: "edit", label: "Review confirmations" },
      },
    );
  }
  if (isDevelopmentDemo()) {
    return apiError(
      "LABEL_UPLOAD_REQUIRES_LOCAL_STACK",
      "Start the local Supabase stack before confirming a label.",
      503,
      {
        details:
          "Run npm run dev:all, wait for the readiness message, then retry; the draft and photo remain unchanged.",
        retryable: true,
        action: { kind: "restart", label: "Start local services, then retry" },
      },
    );
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "LABEL_AUTH_UNAVAILABLE",
        "Your session could not be checked for label confirmation.",
        503,
        {
          details: "The draft and private photo were not changed. Retry shortly.",
          retryable: true,
          action: { kind: "retry", label: "Retry confirmation" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in before confirming a label.", 401, {
        details: "The draft and private photo were not changed.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      });
    }
    const call = supabase.rpc.bind(supabase) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<RpcResult>;
    const { data, error } = await call("create_confirmed_label_food", {
      label_data: {
        ...parsed.data.labelData,
        sourceNote: "",
      },
      label_submission_id: id,
    });
    if (error || typeof data !== "string") {
      console.error("create_confirmed_label_food failed", { code: error?.code });
      return confirmationError(error ?? {});
    }
    return apiSuccess(
      {
        foodId: data,
        planEligible: true,
        verificationStatus: "user_label" as const,
      },
      201,
    );
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Label-confirmation services are temporarily unavailable.",
      503,
      {
        details:
          "The draft and private photo remain saved. Check the connection and retry confirmation.",
        retryable: true,
        action: { kind: "retry", label: "Retry confirmation" },
      },
    );
  }
}
