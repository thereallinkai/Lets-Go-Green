import { z } from "zod";
import { after } from "next/server";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { foodLabelDataSchema } from "@/src/lib/domain/food-label";
import { isDevelopmentDemo } from "@/src/lib/env";
import { retryPendingFoodLabelObjectCleanup } from "@/src/lib/food-label-object-cleanup";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const createDraftRequestSchema = z
  .object({
    draftId: z.string().uuid(),
    labelData: foodLabelDataSchema,
  })
  .strict();

const labelFieldNames: Record<string, string> = {
  brandName: "brand",
  productName: "product",
  servingWeightGrams: "serving weight",
  calories: "calories",
  proteinGrams: "protein",
  carbohydrateGrams: "carbohydrate",
  fatGrams: "total fat",
  ingredientsText: "ingredients",
  allergenStatement: "package allergen statement",
  categorySlugs: "food categories",
  allergenSlugs: "allergen selections",
  allergensReviewed: "allergen review",
  restrictionsReviewed: "diet review",
};

function validationDetails(issues: Array<{ path: PropertyKey[] }>) {
  const fields = [
    ...new Set(
      issues.map((issue) => {
        const field = String(issue.path[0] ?? "");
        return labelFieldNames[field] ?? "a package-label field";
      }),
    ),
  ].slice(0, 6);
  return `Complete or correct: ${fields.join(", ")}. Copy only values printed on this exact package.`;
}

function draftMutationError(message?: string) {
  if (message === "LABEL_DRAFT_REPLAY_MISMATCH") {
    return apiError(
      "LABEL_DRAFT_REPLAY_MISMATCH",
      "This draft ID is already attached to different package facts.",
      409,
      {
        details:
          "The existing draft was not changed and no second draft was created. Retry only the unchanged submission that originally used this draft ID.",
        retryable: false,
        action: { kind: "edit", label: "Review the unchanged label facts" },
      },
    );
  }
  if (message === "LABEL_DRAFT_ALREADY_PROCESSED") {
    return apiError(
      "LABEL_DRAFT_ALREADY_PROCESSED",
      "This label draft has already moved past draft status.",
      409,
      {
        details:
          "No second draft was created. Refresh your saved foods before starting another package-label submission.",
        retryable: false,
        action: { kind: "edit", label: "Refresh saved foods" },
      },
    );
  }
  if (message === "LABEL_DRAFT_ID_CONFLICT") {
    return apiError(
      "LABEL_DRAFT_ID_CONFLICT",
      "This one-use draft ID is unavailable.",
      409,
      {
        details:
          "No draft was changed and no account information was exposed. Refresh the form to create a new one-use ID.",
        retryable: false,
        action: { kind: "edit", label: "Refresh the label form" },
      },
    );
  }
  if (message === "LABEL_UPLOAD_RATE_LIMITED") {
    return apiError(
      "LABEL_UPLOAD_RATE_LIMITED",
      "Finish an existing draft or wait before creating another label upload.",
      429,
      {
        details:
          "No new draft was created. Up to 8 active drafts and 20 new drafts per 24 hours are supported.",
        retryable: true,
        action: { kind: "wait", label: "Finish a draft or wait, then retry" },
      },
    );
  }
  if (
    message === "FOOD_LABEL_DRAFT_INVALID_ID" ||
    message === "FOOD_LABEL_DRAFT_INVALID_DATA"
  ) {
    return apiError(
      "INVALID_LABEL",
      "The package-label draft was not valid.",
      422,
      {
        details:
          "No draft was created. Refresh the form and review the package facts before retrying.",
        retryable: false,
        action: { kind: "edit", label: "Review package-label fields" },
      },
    );
  }
  return null;
}

export async function GET() {
  if (isDevelopmentDemo()) return apiSuccess([]);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "LABEL_AUTH_UNAVAILABLE",
        "Your session could not be checked for label uploads.",
        503,
        {
          details: "No label was changed. Check the connection and retry.",
          retryable: true,
          action: { kind: "retry", label: "Retry loading labels" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in to view label uploads.", 401, {
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      });
    }
    after(async () => {
      try {
        const admin = createSupabaseAdminClient();
        await retryPendingFoodLabelObjectCleanup(admin, auth.user.id);
      } catch {
        console.error("food label cleanup retry could not start");
      }
    });
    const { data, error } = await supabase
      .from("food_label_submissions")
      .select(
        "id,status,brand_name,product_name,variant_name,gtin,private_food_id,review_note,submitted_at,created_at",
      )
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      return apiError(
        "LABELS_LOAD_FAILED",
        "Your label uploads could not be loaded.",
        500,
        {
          details: "No label was changed. Check the connection and retry.",
          retryable: true,
          action: { kind: "retry", label: "Retry loading labels" },
        },
      );
    }
    return apiSuccess(data ?? []);
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Label-upload services are temporarily unavailable.",
      503,
      {
        details: "No label was changed. Check the connection and retry later.",
        retryable: true,
        action: { kind: "retry", label: "Retry loading labels" },
      },
    );
  }
}

export async function POST(request: Request) {
  const requestBody = await request.json().catch(() => null);
  const labelCandidate =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>).labelData ?? requestBody
      : requestBody;
  const parsedLabel = foodLabelDataSchema.safeParse(labelCandidate);
  if (!parsedLabel.success) {
    return apiError(
      "INVALID_LABEL",
      "Enter the brand, product, serving nutrition, ingredients, and allergen statement exactly as printed.",
      422,
      {
        details: validationDetails(parsedLabel.error.issues),
        retryable: false,
        action: { kind: "edit", label: "Review package-label fields" },
      },
    );
  }
  const parsed = createDraftRequestSchema.safeParse(requestBody);
  if (!parsed.success) {
    return apiError(
      "INVALID_LABEL_DRAFT_ID",
      "A valid one-use label draft ID is required.",
      422,
      {
        details:
          "Refresh the package-label form before retrying. No draft or photo was changed.",
        retryable: false,
        action: { kind: "edit", label: "Refresh the label form" },
      },
    );
  }
  if (isDevelopmentDemo()) {
    return apiError(
      "LABEL_UPLOAD_REQUIRES_LOCAL_STACK",
      "Start the local Supabase stack before uploading a label.",
      503,
      {
        details:
          "Run npm run dev:all, wait for the readiness message, then retry this unchanged form.",
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
        "Your session could not be checked for label upload.",
        503,
        {
          details:
            "No draft was created. Check the connection and retry this unchanged form.",
          retryable: true,
          action: { kind: "retry", label: "Retry saving" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in before uploading a label.", 401, {
        details: "No draft was created. Your current form remains in this browser.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      });
    }
    const labelData = {
      ...parsed.data.labelData,
      // Owner-entered free text must never flow into the reusable shared
      // catalog record. Provenance is generated from fixed server text.
      sourceNote: "",
      confirmedAccurate: false,
    };
    const { data, error } = await supabase
      .rpc("create_food_label_draft", {
        target_draft_id: parsed.data.draftId,
        target_label_data: labelData,
      })
      .single();
    if (error || !data) {
      const mappedError = draftMutationError(error?.message);
      if (mappedError) return mappedError;
      console.error("food label draft RPC failed", { code: error?.code });
      return apiError(
        "LABEL_CREATE_FAILED",
        "The label draft could not be created.",
        503,
        {
          details:
            "No photo was uploaded. Your current photo and transcription remain in this browser.",
          retryable: true,
          action: { kind: "retry", label: "Retry saving" },
        },
      );
    }
    return apiSuccess(data, data.replayed ? 200 : 201);
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Label-upload services are temporarily unavailable.",
      503,
      {
        details:
          "No draft was confirmed. Your current photo and transcription remain in this browser.",
        retryable: true,
        action: { kind: "retry", label: "Retry saving" },
      },
    );
  }
}
