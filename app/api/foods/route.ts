import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
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
    if (authError) {
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

    const rows = Array.isArray(data) ? data : [];
    const items = rows.flatMap((row): FoodCatalogItem[] => {
      if (!row || typeof row !== "object") return [];
      const candidate = { ...(row as Record<string, unknown>) };
      delete candidate.total_count;
      const checked = foodCatalogItemSchema.safeParse(candidate);
      return checked.success ? [checked.data] : [];
    });
    const firstRow = rows[0] as Record<string, unknown> | undefined;
    const total = Number(firstRow?.total_count ?? items.length);
    const response = apiSuccess(items);
    response.headers.set(
      "X-Total-Count",
      String(Number.isFinite(total) ? total : items.length),
    );
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
