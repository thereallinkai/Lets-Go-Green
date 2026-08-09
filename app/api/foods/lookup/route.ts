import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { getServerEnv, isDevelopmentDemo } from "@/src/lib/env";
import {
  ExternalFoodError,
  type ExternalFoodCandidate,
  type ExternalFoodProvider,
  type ExternalFoodProviderStatus,
  type NormalizedExternalFood,
} from "@/src/lib/external/food-data-types";
import {
  loadOpenFoodFactsProduct,
  loadUsdaFood,
  searchOpenFoodFactsProducts,
  searchUsdaFoods,
} from "@/src/lib/external";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"),
    query: z.string().trim().min(2).max(120),
  }),
  z.object({
    action: z.literal("search_usda"),
    query: z.string().trim().min(2).max(120),
  }),
  z.object({
    action: z.literal("search_open_food_facts"),
    query: z.string().trim().min(2).max(120),
  }),
  z.object({
    action: z.literal("import"),
    provider: z.enum(["usda_fdc", "open_food_facts"]),
    externalId: z.string().trim().min(1).max(240),
  }),
]);

type RpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

function providerError(error: unknown) {
  if (!(error instanceof ExternalFoodError)) {
    return apiError(
      "FOOD_PROVIDER_UNAVAILABLE",
      "The selected food source could not be reached.",
      503,
      {
        details:
          "No source record was imported. Retry later, choose another result, or add a manually confirmed package label.",
        retryable: true,
        action: { kind: "retry", label: "Retry import" },
      },
    );
  }
  if (error.code === "not_found") {
    return apiError(
      "FOOD_SOURCE_RECORD_NOT_FOUND",
      "That source record is no longer available.",
      404,
      {
        details:
          "Nothing was imported. Return to the search results and choose another match, or add a manually confirmed package label.",
        retryable: false,
        action: { kind: "edit", label: "Choose another food" },
      },
    );
  }
  if (error.code === "incomplete_nutrition") {
    return apiError(
      "FOOD_SOURCE_NUTRITION_INCOMPLETE",
      "That source record is missing required nutrition values.",
      422,
      {
        details:
          "Calories, protein, carbohydrate, and fat must all be present before source review. Choose another match or add the exact package label.",
        retryable: false,
        action: { kind: "edit", label: "Choose another food or label" },
      },
    );
  }
  if (error.code === "rate_limited") {
    return apiError(
      "FOOD_SOURCE_RATE_LIMITED",
      "The selected food source reached its temporary request limit.",
      429,
      {
        details:
          "Nothing was imported. Wait a few minutes before trying this source again.",
        retryable: true,
        action: { kind: "wait", label: "Wait, then try again" },
      },
    );
  }
  if (error.code === "invalid_response") {
    return apiError(
      "FOOD_SOURCE_RESPONSE_UNSUPPORTED",
      "That source record could not be read safely.",
      502,
      {
        details:
          "Nothing was imported. Choose another source result or add the package label manually.",
        retryable: false,
        action: { kind: "edit", label: "Choose another food or label" },
      },
    );
  }
  return apiError(
    "FOOD_SOURCE_UNAVAILABLE",
    "The selected food source is temporarily unavailable.",
    503,
    {
      details:
        "Nothing was imported. Retry later, choose another result, or add a manually confirmed package label.",
      retryable: true,
      action: { kind: "retry", label: "Retry import" },
    },
  );
}

function providerSearchFailure(
  provider: ExternalFoodProvider,
  error: unknown,
): ExternalFoodProviderStatus {
  const providerName =
    provider === "usda_fdc" ? "USDA FoodData Central" : "Open Food Facts";
  if (error instanceof ExternalFoodError) {
    const reason =
      error.code === "rate_limited"
        ? "reached its temporary request limit; wait a few minutes before searching it again."
        : error.code === "not_found"
          ? "reported no matching records for this search."
          : error.code === "incomplete_nutrition"
            ? "returned matches without the four core nutrition values required for review."
            : error.code === "invalid_response"
              ? "returned data this app could not safely read."
              : "could not be reached right now.";
    return {
      provider,
      status: error.code === "rate_limited" ? "rate_limited" : "unavailable",
      resultCount: 0,
      message: `${providerName} ${reason}`,
    };
  }
  return {
    provider,
    status: "unavailable",
    resultCount: 0,
    message: `${providerName} could not be reached. You can retry or use a package-label photo.`,
  };
}

async function cacheFood(food: NormalizedExternalFood) {
  const admin = createSupabaseAdminClient();
  const cache = admin.rpc.bind(admin) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<RpcResult>;
  const { data, error } = await cache("cache_external_food", {
    source_provider: food.provider,
    source_external_id: food.externalId,
    normalized_food: food.food,
    normalized_nutrition: food.nutrition,
    source_metadata: food.sourceMetadata,
    source_snapshot: food.snapshot,
  });
  if (error || typeof data !== "string") {
    console.error("cache_external_food failed", { code: error?.code });
    throw new Error("food_cache_failed");
  }
  const { data: cached, error: cachedError } = await admin
    .from("foods")
    .select("id,slug,english_name,catalog_status")
    .eq("id", data)
    .single();
  if (cachedError || !cached) throw new Error("food_cache_read_failed");
  return cached;
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(
      "INVALID_EXTERNAL_LOOKUP",
      "Search by a food, brand, product, or flavor name, then choose a source record.",
      422,
      {
        details:
          "Use 2 to 120 characters for a name search. Imports must use a result returned by USDA FoodData Central or Open Food Facts.",
        retryable: false,
        action: { kind: "edit", label: "Edit the food search" },
      },
    );
  }
  if (isDevelopmentDemo()) {
    return apiError(
      "EXTERNAL_LOOKUP_REQUIRES_LOCAL_STACK",
      "Start the local Supabase stack to import shared food records.",
      503,
      {
        details:
          "Run npm run dev:all, wait for the readiness message, then retry the food search.",
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
        "FOOD_LOOKUP_AUTH_UNAVAILABLE",
        "Your session could not be checked for food search.",
        503,
        {
          details: "Check the connection and retry. No external source was contacted.",
          retryable: true,
          action: { kind: "retry", label: "Retry food search" },
        },
      );
    }
    if (!auth.user) {
      return apiError(
        "SESSION_EXPIRED",
        "Log in before looking up external foods.",
        401,
        {
          details: "No external source was contacted and no food was imported.",
          retryable: false,
          action: { kind: "navigate", label: "Log in", href: "/login" },
        },
      );
    }
    const env = getServerEnv();
    const admin = createSupabaseAdminClient();
    const recordLookup = admin.rpc.bind(admin) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<RpcResult>;
    const recordProviderLookup = async (provider: ExternalFoodProvider) => {
      const { data, error } = await recordLookup(
        "record_external_food_lookup",
        {
          target_user_id: auth.user.id,
          lookup_provider: provider,
        },
      );
      return { allowed: data === true, error };
    };
    const usdaApiKey =
      env.USDA_FDC_API_KEY ??
      (process.env.NODE_ENV === "production" ? null : "DEMO_KEY");
    const providerOptions = { userAgent: env.FOOD_LOOKUP_USER_AGENT };

    if (parsed.data.action === "search") {
      const query = parsed.data.query;
      const runProviderSearch = async (
        provider: ExternalFoodProvider,
      ): Promise<{
        candidates: ExternalFoodCandidate[];
        status: ExternalFoodProviderStatus;
      }> => {
        const allowance = await recordProviderLookup(provider);
        if (allowance.error) {
          return {
            candidates: [],
            status: {
              provider,
              status: "unavailable",
              resultCount: 0,
              message:
                `${provider === "usda_fdc" ? "USDA FoodData Central" : "Open Food Facts"} search accounting could not be checked. Retry in a moment.`,
            },
          };
        }
        if (!allowance.allowed) {
          return {
            candidates: [],
            status: {
              provider,
              status: "rate_limited",
              resultCount: 0,
              message:
                `${provider === "usda_fdc" ? "USDA FoodData Central" : "Open Food Facts"} reached its temporary lookup limit. Retry in a few minutes.`,
            },
          };
        }
        if (provider === "usda_fdc" && !usdaApiKey) {
          return {
            candidates: [],
            status: {
              provider,
              status: "unavailable",
              resultCount: 0,
              message:
                "USDA FoodData Central is not configured. Open Food Facts results may still be available.",
            },
          };
        }
        try {
          const candidates =
            provider === "open_food_facts"
              ? await searchOpenFoodFactsProducts(
                  query,
                  providerOptions,
                )
              : await searchUsdaFoods(query, {
                  ...providerOptions,
                  apiKey: usdaApiKey!,
                });
          return {
            candidates,
            status: {
              provider,
              status: "ok",
              resultCount: candidates.length,
              message: null,
            },
          };
        } catch (error) {
          return {
            candidates: [],
            status: providerSearchFailure(provider, error),
          };
        }
      };

      const searches = await Promise.all([
        runProviderSearch("usda_fdc"),
        runProviderSearch("open_food_facts"),
      ]);
      const seen = new Set<string>();
      const candidates = searches.flatMap((search) =>
        search.candidates.filter((candidate) => {
          const key = `${candidate.provider}:${candidate.externalId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      );
      return apiSuccess({
        kind: "candidates" as const,
        candidates,
        providers: searches.map((search) => search.status),
      });
    }

    const requestedProvider: ExternalFoodProvider =
      parsed.data.action === "search_open_food_facts" ||
      (parsed.data.action === "import" &&
        parsed.data.provider === "open_food_facts")
        ? "open_food_facts"
        : "usda_fdc";
    const allowance = await recordProviderLookup(requestedProvider);
    if (allowance.error) {
      return apiError(
        "FOOD_LOOKUP_UNAVAILABLE",
        "The external lookup could not be started.",
        503,
        {
          details:
            "The source request allowance could not be checked, so the provider was not contacted.",
          retryable: true,
          action: { kind: "retry", label: "Retry food lookup" },
        },
      );
    }
    if (!allowance.allowed) {
      return apiError(
        "FOOD_LOOKUP_RATE_LIMITED",
        "Wait a few minutes before making another external food lookup.",
        429,
        {
          details:
            "The provider was not contacted and no food was imported. Waiting prevents another request from extending the temporary limit.",
          retryable: true,
          action: { kind: "wait", label: "Wait, then try again" },
        },
      );
    }

    if (parsed.data.action === "search_usda") {
      if (!usdaApiKey) {
        return apiError(
          "USDA_LOOKUP_NOT_CONFIGURED",
          "USDA lookup is not configured. Search the same name with Open Food Facts or upload the package label.",
          503,
          {
            details:
              "The USDA request was not sent. An administrator must configure USDA_FDC_API_KEY before this source can be used.",
            retryable: false,
            action: {
              kind: "contact_support",
              label: "Contact the site administrator",
            },
          },
        );
      }
      const candidates = await searchUsdaFoods(parsed.data.query, {
        ...providerOptions,
        apiKey: usdaApiKey,
      });
      return apiSuccess({ kind: "candidates" as const, candidates });
    }

    if (parsed.data.action === "search_open_food_facts") {
      const candidates = await searchOpenFoodFactsProducts(
        parsed.data.query,
        providerOptions,
      );
      return apiSuccess({ kind: "candidates" as const, candidates });
    }

    const normalized =
      parsed.data.provider === "open_food_facts"
        ? await loadOpenFoodFactsProduct(
            parsed.data.externalId,
            providerOptions,
          )
        : await loadUsdaFood(parsed.data.externalId, {
            ...providerOptions,
            apiKey:
              usdaApiKey ??
              (() => {
                throw new ExternalFoodError(
                  "provider_unavailable",
                  "USDA lookup is not configured.",
                );
              })(),
          });
    const cachedFood = await cacheFood(normalized);
    return apiSuccess(
      {
        kind: "imported" as const,
        foodId: cachedFood.id,
        slug: cachedFood.slug,
        displayName: cachedFood.english_name,
        reviewStatus: cachedFood.catalog_status,
        planEligible: false,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ExternalFoodError) return providerError(error);
    return apiError(
      "FOOD_IMPORT_FAILED",
      "The source record could not be saved for catalog review.",
      500,
      {
        details:
          "Nothing was added to a meal. Retry the import once, choose another result, or add the package label manually.",
        retryable: true,
        action: { kind: "retry", label: "Retry import" },
      },
    );
  }
}
