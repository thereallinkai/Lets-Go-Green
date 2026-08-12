import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { DEMO_CATALOG } from "@/src/lib/demo-catalog";
import { isDevelopmentDemo } from "@/src/lib/env";
import {
  foodCatalogItemSchema,
  type FoodCatalogItem,
} from "@/src/lib/domain/food-catalog";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const querySchema = z.object({
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const demoFoods: FoodCatalogItem[] = DEMO_CATALOG.map((food) => ({
  id: food.slug,
  slug: food.slug,
  english_name: food.englishName,
  icon_ref: null,
  verification_status: food.verificationStatus,
  ownership_type: "catalog",
  food_kind: "generic",
  catalog_status: "active",
  brand_name: null,
  product_name: null,
  variant_name: null,
  gtin: null,
  package_description: null,
  categories: food.categories,
  nutrition: null,
  source: null,
  plan_eligible: true,
}));

type RpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

function authServiceUnavailable() {
  return apiError(
    "AUTH_SERVICE_UNAVAILABLE",
    "Your account session could not be checked right now.",
    503,
    {
      details:
        "The catalog was not searched because the account service was unavailable. Check the connection and try again.",
      retryable: true,
      action: { kind: "retry", label: "Try search again" },
    },
  );
}

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return apiError(
      "INVALID_FOOD_SEARCH",
      "Use a search of at most 120 characters and a page size from 1 to 100.",
      422,
      {
        details:
          "Shorten the search or choose a supported page size before trying again.",
        retryable: false,
        action: { kind: "edit", label: "Edit food search" },
      },
    );
  }
  const { q, limit, offset } = parsed.data;

  if (isDevelopmentDemo()) {
    const matches = demoFoods.filter((food) =>
      `${food.english_name} ${food.categories.join(" ")}`
        .toLocaleLowerCase("en-US")
        .includes(q.toLocaleLowerCase("en-US")),
    );
    const response = apiSuccess(matches.slice(offset, offset + limit));
    response.headers.set("X-Total-Count", String(matches.length));
    return response;
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  let userId: string | null;
  try {
    supabase = await createSupabaseServerClient();
    const authResult = await supabase.auth.getUser();
    userId = authResult.data.user?.id ?? null;
    const authError = authResult.error;
    if (authError && !isAuthSessionMissing(authError)) {
      return authServiceUnavailable();
    }
  } catch {
    return authServiceUnavailable();
  }
  if (!userId) {
    return apiError("SESSION_EXPIRED", "Log in to view the food catalog.", 401, {
      details: "The app could not find an active account session.",
      retryable: false,
      action: { kind: "navigate", label: "Log in", href: "/login" },
    });
  }

  try {
    const callSearch = supabase.rpc.bind(supabase) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<RpcResult>;
    const { data, error } = await callSearch("search_food_catalog", {
      search_query: q,
      result_limit: limit,
      result_offset: offset,
    });
    if (error) {
      console.error("search_food_catalog failed", { code: error.code });
      return apiError(
        "FOODS_LOAD_FAILED",
        "The food catalog could not be loaded.",
        503,
        {
          details:
            "The saved catalog search did not finish. No food preferences were changed.",
          retryable: true,
          action: { kind: "retry", label: "Try search again" },
        },
      );
    }

    if (!Array.isArray(data)) {
      console.error("search_food_catalog returned a non-array payload");
      return apiError(
        "FOOD_CATALOG_RESPONSE_INVALID",
        "Saved food data could not be read safely.",
        503,
        {
          details:
            "The catalog returned an unexpected format, so no incomplete results were shown and no food preferences were changed. Retry after the service refreshes.",
          retryable: true,
          action: { kind: "retry", label: "Try search again" },
        },
      );
    }

    const rows = data;
    const parsedRows = rows.map((row) => {
      if (!row || typeof row !== "object") return null;
      const candidate = { ...(row as Record<string, unknown>) };
      delete candidate.total_count;
      const checked = foodCatalogItemSchema.safeParse(candidate);
      return checked.success ? checked.data : null;
    });
    const invalidRowCount = parsedRows.filter((row) => row === null).length;
    if (invalidRowCount > 0) {
      console.error("search_food_catalog returned invalid rows", {
        invalidRowCount,
      });
      return apiError(
        "FOOD_CATALOG_RESPONSE_INVALID",
        "Saved food data could not be read safely.",
        503,
        {
          details:
            "The catalog returned incomplete food records, so no partial results were shown and no food preferences were changed. Retry after the service refreshes.",
          retryable: true,
          action: { kind: "retry", label: "Try search again" },
        },
      );
    }
    const items = parsedRows as FoodCatalogItem[];
    const totalCounts = rows.map((row) =>
      row && typeof row === "object"
        ? (row as Record<string, unknown>).total_count
        : undefined,
    );
    const total = totalCounts[0] ?? 0;
    const invalidTotal = rows.length > 0 && (
      typeof total !== "number" ||
      !Number.isSafeInteger(total) ||
      total < offset + items.length ||
      totalCounts.some((rowTotal) => rowTotal !== total)
    );
    if (invalidTotal) {
      console.error("search_food_catalog returned an invalid total count");
      return apiError(
        "FOOD_CATALOG_RESPONSE_INVALID",
        "Saved food data could not be read safely.",
        503,
        {
          details:
            "The catalog returned inconsistent paging information, so no incomplete results were shown and no food preferences were changed. Retry after the service refreshes.",
          retryable: true,
          action: { kind: "retry", label: "Try search again" },
        },
      );
    }
    const response = apiSuccess(items);
    // A window count is unavailable when PostgreSQL returns no row for an
    // offset past the end. Do not claim the catalog has zero matches in that
    // case; callers can still treat the empty page as terminal.
    if (rows.length > 0 || offset === 0) {
      response.headers.set("X-Total-Count", String(total));
    }
    return response;
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Food catalog services are temporarily unavailable.",
      503,
      {
        details:
          "The catalog could not be reached. No food preferences were changed; check the connection and try again.",
        retryable: true,
        action: { kind: "retry", label: "Try search again" },
      },
    );
  }
}
