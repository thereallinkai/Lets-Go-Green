import { apiError, apiSuccess } from "@/src/lib/api-response";
import { foodLabelDataSchema } from "@/src/lib/domain/food-label";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

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

export async function GET() {
  if (isDevelopmentDemo()) return apiSuccess([]);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) {
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
    if (!auth.user) {
      return apiError("SESSION_EXPIRED", "Log in to view label uploads.", 401, {
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      });
    }
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
  const parsed = foodLabelDataSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError(
      "INVALID_LABEL",
      "Enter the brand, product, serving nutrition, ingredients, and allergen statement exactly as printed.",
      422,
      {
        details: validationDetails(parsed.error.issues),
        retryable: false,
        action: { kind: "edit", label: "Review package-label fields" },
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
    if (authError) {
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
    if (!auth.user) {
      return apiError("SESSION_EXPIRED", "Log in before uploading a label.", 401, {
        details: "No draft was created. Your current form remains in this browser.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      });
    }
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const [activeDrafts, recentDrafts] = await Promise.all([
      supabase
        .from("food_label_submissions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.user.id)
        .in("status", ["draft", "needs_changes"]),
      supabase
        .from("food_label_submissions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.user.id)
        .gte("created_at", dayAgo),
    ]);
    if (activeDrafts.error || recentDrafts.error) {
      return apiError(
        "LABEL_QUOTA_CHECK_FAILED",
        "The label-upload allowance could not be checked.",
        503,
        {
          details: "No draft was created. Check the connection and retry.",
          retryable: true,
          action: { kind: "retry", label: "Retry saving" },
        },
      );
    }
    if ((activeDrafts.count ?? 0) >= 8 || (recentDrafts.count ?? 0) >= 20) {
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
    const labelData = {
      ...parsed.data,
      // Owner-entered free text must never flow into the reusable shared
      // catalog record. Provenance is generated from fixed server text.
      sourceNote: "",
      confirmedAccurate: false,
    };
    const { data, error } = await supabase
      .from("food_label_submissions")
      .insert({
        user_id: auth.user.id,
        status: "draft",
        brand_name: labelData.brandName,
        product_name: labelData.productName,
        variant_name: labelData.variantName || null,
        gtin: labelData.gtin || null,
        package_description: labelData.packageDescription || null,
        label_data: labelData,
      })
      .select("id,status")
      .single();
    if (error || !data) {
      console.error("food label draft insert failed", { code: error?.code });
      return apiError(
        "LABEL_CREATE_FAILED",
        "The label draft could not be created.",
        500,
        {
          details:
            "No photo was uploaded. Your current photo and transcription remain in this browser.",
          retryable: true,
          action: { kind: "retry", label: "Retry saving" },
        },
      );
    }
    return apiSuccess(data, 201);
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
