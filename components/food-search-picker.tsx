"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { FoodLabelUpload } from "@/components/food-label-upload";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";
import styles from "@/components/food-discovery.module.css";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromPayload,
  clientApiError,
} from "@/src/lib/client-api-error";
import type {
  FoodNutritionFacts,
  FoodSourceSummary,
} from "@/src/lib/domain/food-catalog";
import type {
  ExternalFoodCandidate,
  ExternalFoodProviderStatus,
} from "@/src/lib/external/food-data-types";

export type FoodPickerItem = {
  id: string;
  name: string;
  categories: string[];
  planEligible: boolean;
  brandName?: string | null;
  variantName?: string | null;
  gtin?: string | null;
  catalogStatus?: "active" | "pending_review" | "rejected" | "retired";
  nutrition?: FoodNutritionFacts | null;
  source?: FoodSourceSummary | null;
};

type Meal = "breakfast" | "lunch" | "dinner";
type SearchPhase = "idle" | "waiting" | "searching" | "success" | "error";
type Notice = { text: string };

type Envelope<T> = { data?: T | null; error?: unknown } | null;

type CandidateResponse = {
  kind: "candidates";
  candidates: ExternalFoodCandidate[];
  providers?: ExternalFoodProviderStatus[];
  cacheable?: boolean;
};

type ImportResponse = {
  kind: "imported";
  displayName: string;
  reviewStatus: string;
};

type SearchCacheEntry = {
  cachedAt: number;
  candidates: ExternalFoodCandidate[];
  providers: ExternalFoodProviderStatus[];
};

type CandidateFailure = {
  error: ApiError;
  waitsForCooldown: boolean;
  retryKind: "import" | "catalog";
  refreshQuery?: string;
};

type ProviderCooldown = {
  deadlineMs: number;
  remainingSeconds: number;
};

type RankedResult =
  | {
      kind: "saved";
      key: string;
      score: number;
      food: FoodPickerItem;
    }
  | {
      kind: "source";
      key: string;
      score: number;
      candidate: ExternalFoodCandidate;
    };

type RetryRequest =
  | { kind: "search"; query: string }
  | { kind: "catalog"; query: string };

const CATALOG_DELAY_MS = 300;
const INITIAL_RESULT_COUNT = 6;
const COMPLETE_SEARCH_CACHE_TTL_MS = 30 * 60 * 1_000;
const PARTIAL_SEARCH_CACHE_TTL_MS = 30 * 1_000;
const DEFAULT_IMPORT_COOLDOWN_SECONDS = 5 * 60;
const mealLabels: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

function coreNutritionIdentity(candidate: ExternalFoodCandidate) {
  const value = (amount: number | null) =>
    amount === null ? "missing" : String(Math.round(amount * 1_000) / 1_000);
  const nutrition = candidate.nutritionPreview;
  return [
    candidate.nutritionReferenceUnit,
    value(nutrition.calories),
    value(nutrition.proteinGrams),
    value(nutrition.carbohydrateGrams),
    value(nutrition.fatGrams),
  ].join(":");
}

function sourceVisibleIdentity(candidate: ExternalFoodCandidate) {
  return `${normalizedText(candidate.displayName)}:${normalizedText(candidate.variantName ?? "")}:${normalizedText(candidatePackageDescription(candidate) ?? "")}:${coreNutritionIdentity(candidate)}`;
}

function candidatePackageDescription(candidate: ExternalFoodCandidate) {
  const value = candidate.packageDescription;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function searchCacheTtl(entry: SearchCacheEntry) {
  return entry.providers.some((provider) => provider.status !== "ok")
    ? PARTIAL_SEARCH_CACHE_TTL_MS
    : COMPLETE_SEARCH_CACHE_TTL_MS;
}

function retryAfterSeconds(response: Response, payload: unknown) {
  const object =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const error =
    object?.error && typeof object.error === "object" && !Array.isArray(object.error)
      ? (object.error as Record<string, unknown>)
      : null;
  const numericCandidates = [
    error?.retryAfterSeconds,
    error?.retry_after_seconds,
    object?.retryAfterSeconds,
    object?.retry_after_seconds,
  ];
  for (const value of numericCandidates) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(3_600, Math.ceil(parsed));
    }
  }

  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(3_600, Math.ceil(seconds));
  }
  const date = Date.parse(header);
  if (!Number.isFinite(date)) return null;
  return Math.min(3_600, Math.max(1, Math.ceil((date - Date.now()) / 1_000)));
}

function formatCooldown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function cooldownDeadline(waitSeconds: number) {
  return Date.now() + waitSeconds * 1_000;
}

function normalizedText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchesQuery(value: string, query: string) {
  const normalizedValue = normalizedText(value);
  const tokens = normalizedText(query).split(" ").filter(Boolean);
  return tokens.every((token) => normalizedValue.includes(token));
}

function relevanceScore(value: string, query: string) {
  const normalizedValue = normalizedText(value);
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return 0;
  const words = normalizedValue.split(" ");
  const tokens = normalizedQuery.split(" ");
  let score = 0;
  if (normalizedValue === normalizedQuery) score += 1_200;
  else if (normalizedValue.startsWith(normalizedQuery)) score += 900;
  else if (normalizedValue.includes(normalizedQuery)) score += 650;
  for (const token of tokens) {
    if (words.includes(token)) score += 120;
    else if (words.some((word) => word.startsWith(token))) score += 75;
    else if (normalizedValue.includes(token)) score += 35;
  }
  score -= Math.min(80, Math.abs(normalizedValue.length - normalizedQuery.length));
  return score;
}

function providerLabel(provider: ExternalFoodCandidate["provider"]) {
  return provider === "usda_fdc"
    ? "USDA FoodData Central"
    : "Open Food Facts";
}

function savedSourceLabel(food: FoodPickerItem) {
  if (food.source?.provider === "usda_fdc") return "Saved · USDA FoodData Central";
  if (food.source?.provider === "open_food_facts") return "Saved · Open Food Facts";
  if (food.source?.provider === "user_label") return "Your confirmed package label";
  if (food.source?.provider === "manual_review") return "Saved · reviewed catalog";
  return "Saved catalog";
}

function nutritionSummary(candidate: ExternalFoodCandidate) {
  const nutrition = candidate.nutritionPreview;
  const value = (amount: number | null, unit: string) =>
    amount === null ? "not reported" : `${Math.round(amount * 10) / 10}${unit}`;
  return `${value(nutrition.calories, " kcal")} · ${value(
    nutrition.proteinGrams,
    " g protein",
  )} · ${value(nutrition.carbohydrateGrams, " g carbs")} · ${value(
    nutrition.fatGrams,
    " g fat",
  )}`;
}

export function FoodSearchPicker({
  foods,
  search,
  onSearchChange,
  onAdd,
  onCatalogChanged,
}: {
  foods: FoodPickerItem[];
  search: string;
  onSearchChange: (value: string) => void;
  onAdd: (meal: Meal, food: FoodPickerItem) => void;
  onCatalogChanged: (query?: string) => unknown | Promise<unknown>;
}) {
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [candidates, setCandidates] = useState<ExternalFoodCandidate[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<
    ExternalFoodProviderStatus[]
  >([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<Set<string>>(() => new Set());
  const [destinationMeal, setDestinationMeal] = useState<Meal | "">("");
  const [candidateFailures, setCandidateFailures] = useState<
    Record<string, CandidateFailure>
  >({});
  const [providerCooldowns, setProviderCooldowns] = useState<
    Partial<Record<ExternalFoodCandidate["provider"], ProviderCooldown>>
  >({});
  const [visibleResultCount, setVisibleResultCount] = useState(
    INITIAL_RESULT_COUNT,
  );
  const catalogCallbackRef = useRef(onCatalogChanged);
  const activeRequestRef = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const candidateErrorRefs = useRef(new Map<string, HTMLDivElement>());
  const searchCacheRef = useRef(
    new Map<string, SearchCacheEntry>(),
  );

  useEffect(() => {
    catalogCallbackRef.current = onCatalogChanged;
  }, [onCatalogChanged]);

  const reportError = useCallback(
    (nextError: ApiError, retry: RetryRequest | null = null) => {
      setError(nextError);
      setRetryRequest(retry);
      window.requestAnimationFrame(() => errorRef.current?.focus());
    },
    [],
  );

  useEffect(() => {
    if (!Object.keys(providerCooldowns).length) return;
    const refreshCooldowns = () => {
      const currentTime = Date.now();
      const expiredProviders: ExternalFoodCandidate["provider"][] = [];
      let changed = false;
      const next: Partial<
        Record<ExternalFoodCandidate["provider"], ProviderCooldown>
      > = {};
      for (const [provider, cooldown] of Object.entries(
        providerCooldowns,
      ) as Array<
        [ExternalFoodCandidate["provider"], ProviderCooldown]
      >) {
        const remainingSeconds = Math.max(
          0,
          Math.ceil((cooldown.deadlineMs - currentTime) / 1_000),
        );
        if (remainingSeconds > 0) {
          next[provider] = { ...cooldown, remainingSeconds };
        } else {
          expiredProviders.push(provider);
        }
        if (remainingSeconds !== cooldown.remainingSeconds) changed = true;
      }
      if (changed) setProviderCooldowns(next);
      if (expiredProviders.length) {
        const expired = new Set(expiredProviders);
        setCandidateFailures((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([key, failure]) => {
              const provider = key.split(
                ":",
                1,
              )[0] as ExternalFoodCandidate["provider"];
              return !(failure.waitsForCooldown && expired.has(provider));
            }),
          ),
        );
      }
    };
    const timer = window.setInterval(refreshCooldowns, 1_000);
    window.addEventListener("focus", refreshCooldowns);
    document.addEventListener("visibilitychange", refreshCooldowns);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshCooldowns);
      document.removeEventListener("visibilitychange", refreshCooldowns);
    };
  }, [providerCooldowns]);

  const applySearchResult = useCallback(
    (
      query: string,
      nextCandidates: ExternalFoodCandidate[],
      providers: ExternalFoodProviderStatus[],
    ) => {
      setCandidates(nextCandidates);
      setProviderStatuses(providers);
      const failedProviders = providers.filter((provider) => provider.status !== "ok");
      const availableProviders = providers.filter((provider) => provider.status === "ok");
      if (failedProviders.length && !availableProviders.length) {
        setPhase("error");
        setNotice(null);
        const allRateLimited = failedProviders.every(
          (provider) => provider.status === "rate_limited",
        );
        const details = failedProviders
          .map(
            (provider) =>
              provider.message ??
              `${providerLabel(provider.provider)} is temporarily unavailable.`,
          )
          .join(" ");
        reportError(
          clientApiError(
            allRateLimited
              ? "FOOD_SEARCH_SOURCES_RATE_LIMITED"
              : "FOOD_SEARCH_SOURCES_UNAVAILABLE",
            allRateLimited
              ? "Online food search has reached its temporary request limits."
              : "No online food source could be reached.",
            `${details} Saved-food filtering still works, and a package-label photo remains available below.`,
            {
              retryable: true,
              action: allRateLimited
                ? { kind: "wait", label: "Wait a few minutes, then search again" }
                : { kind: "retry", label: "Retry search" },
            },
          ),
          allRateLimited ? null : { kind: "search", query },
        );
        return;
      }
      setPhase("success");
      setError(null);
      setRetryRequest(null);
      if (failedProviders.length) {
        setNotice({
          text: `Some source results are unavailable, but the available matches are shown. ${failedProviders
            .map(
              (provider) =>
                provider.message ??
                `${providerLabel(provider.provider)} is temporarily unavailable.`,
            )
            .join(" ")}`,
        });
      } else {
        setNotice({
          text: nextCandidates.length
            ? `Source results for “${query}” are ready. Duplicates are combined below so you can compare each distinct match once.`
            : `No source match was found for “${query}”. Try a simpler name or use a package-label photo.`,
        });
      }
    },
    [reportError],
  );

  const runSmartSearch = useCallback(
    async (rawQuery: string, force = false) => {
      const query = rawQuery.trim().replace(/\s+/g, " ");
      const cacheKey = normalizedText(query);
      if (query.length < 2) return;
      setVisibleResultCount(INITIAL_RESULT_COUNT);
      const cached = searchCacheRef.current.get(cacheKey);
      const cacheIsFresh =
        cached && Date.now() - cached.cachedAt < searchCacheTtl(cached);
      if (cached && cacheIsFresh && !force) {
        searchCacheRef.current.set(cacheKey, cached);
        applySearchResult(query, cached.candidates, cached.providers);
        return;
      }
      if (cached && !cacheIsFresh) {
        searchCacheRef.current.delete(cacheKey);
      }

      activeRequestRef.current?.abort();
      const controller = new AbortController();
      activeRequestRef.current = controller;
      setPhase("searching");
      setError(null);
      setRetryRequest(null);
      setNotice({
        text: `Searching the saved catalog, USDA, and Open Food Facts for “${query}”…`,
      });
      const invalidResponse = clientApiError(
        "FOOD_SEARCH_RESPONSE_INVALID",
        "Online food search could not be completed.",
        "The search service returned an unreadable response. Saved-food filtering still works; retry the online search or use a package-label photo.",
        {
          retryable: true,
          action: { kind: "retry", label: "Retry search" },
        },
      );
      try {
        const response = await fetch("/api/foods/lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "search", query }),
          signal: controller.signal,
        });
        const result = (await response.json().catch(() => null)) as Envelope<CandidateResponse>;
        if (
          !response.ok ||
          !result?.data ||
          result.data.kind !== "candidates" ||
          !Array.isArray(result.data.candidates)
        ) {
          throw apiErrorFromPayload(result, invalidResponse);
        }
        if (
          controller.signal.aborted ||
          activeRequestRef.current !== controller
        ) {
          return;
        }
        const providers = Array.isArray(result.data.providers)
          ? result.data.providers
          : [];
        const cacheEntry: SearchCacheEntry = {
          cachedAt: Date.now(),
          candidates: result.data.candidates,
          providers,
        };
        if (result.data.cacheable !== false) {
          searchCacheRef.current.set(cacheKey, cacheEntry);
        }
        applySearchResult(query, result.data.candidates, providers);
      } catch (error) {
        if (
          controller.signal.aborted ||
          activeRequestRef.current !== controller ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }
        setPhase("error");
        setCandidates([]);
        setProviderStatuses([]);
        setNotice(null);
        reportError(
          apiErrorFromPayload(
            { error },
            clientApiError(
              "FOOD_SEARCH_NETWORK_ERROR",
              "Online food search could not be reached.",
              "Check the connection and retry. Saved-food filtering still works, and no source record was imported.",
              {
                retryable: true,
                action: { kind: "retry", label: "Retry search" },
              },
            ),
          ),
          { kind: "search", query },
        );
      } finally {
        if (activeRequestRef.current === controller) {
          activeRequestRef.current = null;
        }
      }
    },
    [applySearchResult, reportError],
  );

  useEffect(() => {
    const query = search.trim();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.resolve()
        .then(() => catalogCallbackRef.current(query))
        .then((refreshed) => {
          if (cancelled) return;
          if (refreshed === false) {
            throw new Error("catalog_refresh_not_confirmed");
          }
        })
        .catch(() => {
          if (cancelled) return;
          reportError(
            clientApiError(
              "SAVED_FOOD_SEARCH_FAILED",
              "Saved foods could not be refreshed.",
              "The current saved results remain on screen. Check the connection and try the same search again.",
              {
                retryable: true,
                action: { kind: "retry", label: "Retry saved-food search" },
              },
            ),
            { kind: "catalog", query },
          );
        });
    }, CATALOG_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reportError, search]);

  useEffect(
    () => () => {
      activeRequestRef.current?.abort();
    },
    [],
  );

  const rankedResults = useMemo<RankedResult[]>(() => {
    const query = search.trim();
    const localResults: RankedResult[] = foods
      .filter((food) =>
        matchesQuery(
          `${food.name} ${food.brandName ?? ""} ${food.variantName ?? ""} ${food.categories.join(" ")}`,
          query,
        ),
      )
      .map((food) => ({
        kind: "saved" as const,
        key: `saved:${food.id}`,
        food,
        score:
          relevanceScore(
            `${food.name} ${food.brandName ?? ""} ${food.variantName ?? ""}`,
            query,
          ) +
          (food.planEligible ? 90 : 20),
      }));

    const savedGtins = new Set(
      localResults.flatMap((result) =>
        result.kind === "saved" && result.food.gtin ? [result.food.gtin] : [],
      ),
    );
    const sourceByIdentity = new Map<string, ExternalFoodCandidate>();
    for (const candidate of candidates) {
      if (candidate.gtin && savedGtins.has(candidate.gtin)) {
        continue;
      }
      // Search providers can return the same visible product under multiple
      // record IDs or package codes. Merge only when both the displayed identity
      // and all four normalized core values match; distinct formulations remain.
      const identity = sourceVisibleIdentity(candidate);
      const previous = sourceByIdentity.get(identity);
      const completeness = Object.values(candidate.nutritionPreview).filter(
        (value) => value !== null,
      ).length;
      const previousCompleteness = previous
        ? Object.values(previous.nutritionPreview).filter((value) => value !== null).length
        : -1;
      if (
        !previous ||
        completeness +
          (candidate.imageUrl ? 1 : 0) +
          (candidate.nutritionImageUrl ? 1 : 0) >
          previousCompleteness +
            (previous.imageUrl ? 1 : 0) +
            (previous.nutritionImageUrl ? 1 : 0)
      ) {
        sourceByIdentity.set(identity, candidate);
      }
    }
    const sourceResults: RankedResult[] = [...sourceByIdentity.values()].map(
      (candidate) => {
        const genericUsda =
          candidate.provider === "usda_fdc" &&
          candidate.dataType !== null &&
          candidate.dataType !== "Branded";
        return {
          kind: "source" as const,
          key: `source:${candidate.provider}:${candidate.externalId}`,
          candidate,
          score:
            relevanceScore(candidate.displayName, query) +
            (genericUsda ? 55 : 0) +
            Object.values(candidate.nutritionPreview).filter(
              (value) => value !== null,
            ).length *
              5,
        };
      },
    );

    return [...localResults, ...sourceResults]
      .sort((left, right) => {
        const scoreDifference = right.score - left.score;
        if (scoreDifference) return scoreDifference;
        const kindDifference =
          (left.kind === "saved" ? 0 : 1) -
          (right.kind === "saved" ? 0 : 1);
        return kindDifference || left.key.localeCompare(right.key);
      })
      .slice(0, 30);
  }, [candidates, foods, search]);

  const visibleResults = rankedResults.slice(0, visibleResultCount);

  function reportCandidateFailure(key: string, failure: CandidateFailure) {
    setCandidateFailures((current) => ({ ...current, [key]: failure }));
    window.requestAnimationFrame(() => candidateErrorRefs.current.get(key)?.focus());
  }

  async function importCandidate(candidate: ExternalFoodCandidate) {
    const key = `${candidate.provider}:${candidate.externalId}`;
    const providerCooldown = providerCooldowns[candidate.provider];
    if (
      importingKey ||
      importedKeys.has(key) ||
      (providerCooldown?.remainingSeconds ?? 0) > 0
    ) {
      return;
    }
    setImportingKey(key);
    setCandidateFailures((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    const invalidResponse = clientApiError(
      "FOOD_IMPORT_RESPONSE_INVALID",
      "The catalog save result could not be confirmed.",
      `The ${providerLabel(candidate.provider)} response was unreadable. The idempotent save may already have completed, but nothing was added to a meal. Try the same save once; the existing provider record will be reused rather than duplicated.`,
      {
        retryable: true,
        action: { kind: "retry", label: "Try saving again" },
      },
    );
    let imported: ImportResponse;
    try {
      const response = await fetch("/api/foods/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          provider: candidate.provider,
          externalId: candidate.externalId,
        }),
      });
      const result = (await response.json().catch(() => null)) as Envelope<ImportResponse>;
      if (
        !response.ok ||
        !result?.data ||
        result.data.kind !== "imported" ||
        typeof result.data.displayName !== "string"
      ) {
        let nextError = apiErrorFromPayload(result, invalidResponse);
        const isRateLimited =
          response.status === 429 || nextError.code.includes("RATE_LIMITED");
        let waitsForCooldown = false;
        if (isRateLimited) {
          const waitSeconds =
            retryAfterSeconds(response, result) ??
            DEFAULT_IMPORT_COOLDOWN_SECONDS;
          waitsForCooldown = true;
          const deadlineMs = cooldownDeadline(waitSeconds);
          setProviderCooldowns((current) => ({
            ...current,
            [candidate.provider]: {
              deadlineMs,
              remainingSeconds: waitSeconds,
            },
          }));
          nextError = {
            ...nextError,
            retryable: true,
            action: {
              kind: "wait",
              label: `Wait ${formatCooldown(waitSeconds)}, then try again`,
            },
          };
        }
        reportCandidateFailure(key, {
          error: nextError,
          waitsForCooldown,
          retryKind: "import",
        });
        return;
      }
      imported = result.data;
      setImportedKeys((current) => new Set(current).add(key));
    } catch (error) {
      reportCandidateFailure(key, {
        error: apiErrorFromPayload(
          { error },
          clientApiError(
            "FOOD_IMPORT_NETWORK_ERROR",
            "The catalog save result could not be confirmed.",
            "The connection ended before the app received a result. The idempotent save may already have completed, but nothing was added to a meal. Check the connection and try the same save once; the provider record will be reused rather than duplicated.",
            {
              retryable: true,
              action: { kind: "retry", label: "Try saving again" },
            },
          ),
        ),
        waitsForCooldown: false,
        retryKind: "import",
      });
      return;
    } finally {
      setImportingKey(null);
    }

    try {
      const refreshed = await catalogCallbackRef.current(imported.displayName);
      if (refreshed === false) throw new Error("catalog_refresh_not_confirmed");
      setCandidateFailures((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch {
      reportCandidateFailure(key, {
        error: clientApiError(
          "FOOD_IMPORT_REFRESH_FAILED",
          `${imported.displayName} was saved, but saved results did not refresh.`,
          "The source record is still pending catalog review and was not added to a meal. Refresh saved foods; do not save this source record again.",
          {
            retryable: true,
            action: { kind: "retry", label: "Refresh saved foods" },
          },
        ),
        waitsForCooldown: false,
        retryKind: "catalog",
        refreshQuery: imported.displayName,
      });
    }
  }

  async function retryCandidateCatalog(key: string, query: string) {
    try {
      const refreshed = await catalogCallbackRef.current(query);
      if (refreshed === false) throw new Error("catalog_refresh_not_confirmed");
      setCandidateFailures((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch {
      reportCandidateFailure(key, {
        error: clientApiError(
          "FOOD_IMPORT_REFRESH_FAILED",
          `${query} is saved, but saved results still could not refresh.`,
          "The source record remains pending catalog review and was not added to a meal. Try refreshing later; do not save this source record again.",
          {
            retryable: true,
            action: { kind: "retry", label: "Refresh saved foods" },
          },
        ),
        waitsForCooldown: false,
        retryKind: "catalog",
        refreshQuery: query,
      });
    }
  }

  async function retryLastRequest() {
    if (!retryRequest) return;
    if (retryRequest.kind === "search") {
      await runSmartSearch(retryRequest.query, true);
      return;
    }
    setError(null);
    setRetryRequest(null);
    setNotice({ text: "Refreshing saved foods…" });
    try {
      const refreshed = await catalogCallbackRef.current(retryRequest.query);
      if (refreshed === false) throw new Error("catalog_refresh_not_confirmed");
      setNotice({ text: "Saved foods are up to date." });
    } catch {
      reportError(
        clientApiError(
          "SAVED_FOOD_SEARCH_FAILED",
          "Saved foods still could not be refreshed.",
          "The current results remain on screen. Check the connection and try again later; do not repeat an already successful catalog save.",
          {
            retryable: true,
            action: { kind: "retry", label: "Retry saved-food search" },
          },
        ),
        retryRequest,
      );
    }
  }

  function changeSearch(value: string) {
    activeRequestRef.current?.abort();
    onSearchChange(value);
    setCandidates([]);
    setProviderStatuses([]);
    setNotice(null);
    setError(null);
    setRetryRequest(null);
    setCandidateFailures({});
    setVisibleResultCount(INITIAL_RESULT_COUNT);
    setPhase(value.trim().length >= 2 ? "waiting" : "idle");
  }

  const query = search.trim();
  const isSearching = phase === "searching";
  const failedProviderCount = providerStatuses.filter(
    (provider) => provider.status !== "ok",
  ).length;

  return (
    <section className={styles.root} data-layout="overflow-safe-food-search">
      <div className={styles.searchPanel}>
        <form
          className={styles.searchForm}
          onSubmit={(event) => {
            event.preventDefault();
            void runSmartSearch(query);
          }}
        >
          <label className={styles.searchField}>
            <span>Search foods and products</span>
            <input
              value={search}
              maxLength={120}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder="Try asparagus, tofu, a brand, or a flavor"
              autoComplete="off"
            />
          </label>
          <button
            className="button button-dark"
            type="submit"
            disabled={query.length < 2 || isSearching}
          >
            {isSearching ? "Searching all sources…" : "Search all sources"}
          </button>
        </form>
        <p className={styles.searchDisclosure}>
          Typing filters saved foods and never contacts an external provider.
          “Search all sources” sends the name to USDA FoodData Central and
          Open Food Facts; repeated complete searches are reused only while this
          page remains open.
        </p>
        <ol className={styles.workflow} aria-label="How food search works">
          <li><span>1</span> Type to filter saved foods immediately.</li>
          <li><span>2</span> Search all sources, then compare nutrition.</li>
          <li><span>3</span> Choose Breakfast, Lunch, or Dinner before Add.</li>
        </ol>
        <label className={styles.mealDestination}>
          <span>Add saved foods to</span>
          <select
            aria-label="Meal destination for saved foods"
            required
            value={destinationMeal}
            onChange={(event) => setDestinationMeal(event.target.value as Meal | "")}
          >
            <option value="">Choose a meal…</option>
            {(Object.keys(mealLabels) as Meal[]).map((meal) => (
              <option value={meal} key={meal}>{mealLabels[meal]}</option>
            ))}
          </select>
          <small>
            This choice applies only to approved saved foods. Online source
            matches must be reviewed before they can be added to any meal.
          </small>
        </label>
        {error ? (
          <ApiErrorNotice
            actionDisabled={isSearching || Boolean(importingKey)}
            className={styles.foodApiError}
            error={error}
            onAction={
              error.action?.kind === "retry" && retryRequest
                ? () => void retryLastRequest()
                : undefined
            }
            ref={errorRef}
          />
        ) : null}
        {notice ? (
          <div className={styles.notice} role="status" aria-live="polite">
            <span>{notice.text}</span>
          </div>
        ) : null}
        {failedProviderCount > 0 && !error ? (
          <p className={styles.sourceNote}>
            Results can still be used when one provider is temporarily unavailable.
          </p>
        ) : null}
      </div>

      <section
        className={styles.resultsSection}
        aria-labelledby="food-results-heading"
        aria-busy={isSearching}
      >
        <div className={styles.resultsHeading}>
          <div>
            <p className={styles.eyebrow}>Smart results</p>
            <h2 id="food-results-heading">
              {query ? `Best matches for “${query}”` : "Saved foods"}
            </h2>
          </div>
          {isSearching ? (
            <span className={styles.searchingBadge}>Searching…</span>
          ) : rankedResults.length ? (
            <span className={styles.resultCount} aria-live="polite">
              Showing {Math.min(visibleResultCount, rankedResults.length)} of{" "}
              {rankedResults.length} unique {rankedResults.length === 1 ? "match" : "matches"}
            </span>
          ) : null}
        </div>

        <div
          className={styles.resultList}
          id="food-search-result-list"
          aria-label="Food search results"
        >
          {visibleResults.map((result) => {
            if (result.kind === "saved") {
              const { food } = result;
              return (
                <article className={styles.resultCard} key={result.key}>
                  <div className={styles.resultCopy}>
                    <div className={styles.resultMeta}>
                      <span className={styles.savedBadge}>{savedSourceLabel(food)}</span>
                      {food.catalogStatus === "pending_review" ? (
                        <span className={styles.reviewBadge}>Review pending</span>
                      ) : null}
                    </div>
                    <h3>{food.name}</h3>
                    {food.brandName || food.variantName ? (
                      <p className={styles.secondaryText}>
                        {[food.brandName, food.variantName].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    <div className={styles.categories}>
                      {food.categories.map((category) => (
                        <span key={category}>{category}</span>
                      ))}
                    </div>
                    <NutritionFactsCard
                      compact
                      nutrition={food.nutrition ?? null}
                      source={food.source}
                    />
                    {!food.planEligible ? (
                      <p className={styles.reviewCopy}>
                        Reference only. Source and nutrition review must finish before this food can enter a generated plan.
                      </p>
                    ) : null}
                  </div>
                  <div className={styles.addControls}>
                    <button
                      className="button button-dark"
                      disabled={!food.planEligible || !destinationMeal}
                      type="button"
                      aria-label={
                        !food.planEligible
                          ? `${food.name} needs review`
                          : destinationMeal
                            ? `Add ${food.name} to ${destinationMeal}`
                            : `Choose a meal before adding ${food.name}`
                      }
                      onClick={() => {
                        if (destinationMeal) onAdd(destinationMeal, food);
                      }}
                    >
                      {!food.planEligible
                        ? "Needs review"
                        : destinationMeal
                          ? `Add to ${mealLabels[destinationMeal]}`
                          : "Choose a meal to add"}
                    </button>
                  </div>
                </article>
              );
            }

            const { candidate } = result;
            const key = `${candidate.provider}:${candidate.externalId}`;
            const isImporting = importingKey === key;
            const isImported = importedKeys.has(key);
            const usesUnsupportedBasis =
              candidate.nutritionReferenceUnit !== "g";
            const storedCandidateFailure = candidateFailures[key];
            const providerCooldown = providerCooldowns[candidate.provider];
            const candidateFailure =
              storedCandidateFailure?.waitsForCooldown &&
              (providerCooldown?.remainingSeconds ?? 0) <= 0
                ? undefined
                : storedCandidateFailure;
            const cooldownSeconds = Math.max(
              0,
              providerCooldown?.remainingSeconds ?? 0,
            );
            const isCoolingDown = cooldownSeconds > 0;
            const contextualError = candidateFailure?.error ?? null;
            const candidateErrorAction =
              contextualError?.action?.kind === "retry" && candidateFailure
                ? candidateFailure.retryKind === "catalog" &&
                  candidateFailure.refreshQuery
                  ? () =>
                      void retryCandidateCatalog(
                        key,
                        candidateFailure.refreshQuery!,
                      )
                  : () => void importCandidate(candidate)
                : undefined;
            const sourcePhotos = [
              candidate.imageUrl
                ? {
                    url: candidate.imageUrl,
                    alt: `${candidate.displayName} package photo supplied by Open Food Facts`,
                  }
                : null,
              candidate.nutritionImageUrl
                ? {
                    url: candidate.nutritionImageUrl,
                    alt: `${candidate.displayName} nutrition-label photo supplied by Open Food Facts`,
                  }
                : null,
            ].filter((photo): photo is { url: string; alt: string } => photo !== null);
            return (
              <article className={styles.resultCard} key={result.key}>
                {sourcePhotos.length ? (
                  <div className={styles.sourceImages}>
                    {sourcePhotos.map((photo) => (
                      <div className={styles.sourceImageFrame} key={photo.url}>
                        {/* Provider URLs are restricted to HTTPS Open Food Facts hosts server-side. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.url} alt={photo.alt} loading="lazy" />
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className={styles.resultCopy}>
                  <div className={styles.resultMeta}>
                    <span className={styles.sourceBadge}>{providerLabel(candidate.provider)}</span>
                    <span className={styles.sourceReported}>Source reported</span>
                  </div>
                  <h3>{candidate.displayName}</h3>
                  {candidate.dataType ? (
                    <p className={styles.secondaryText}>{candidate.dataType}</p>
                  ) : null}
                  <p className={styles.sourceIdentity}>
                    {[
                      candidatePackageDescription(candidate)
                        ? `Package ${candidatePackageDescription(candidate)}`
                        : null,
                      candidate.gtin ? `Package code ${candidate.gtin}` : null,
                      `${providerLabel(candidate.provider)} record ${candidate.externalId}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className={styles.nutritionPreview}>
                    <strong>
                      {candidate.nutritionReferenceUnit === "g"
                        ? "Per 100 g:"
                        : candidate.nutritionReferenceUnit === "ml"
                          ? "Per 100 mL:"
                          : "Per 100 g or mL (source unclear):"}
                    </strong>{" "}
                    {nutritionSummary(candidate)}
                  </p>
                  <p className={styles.sourceNote}>
                    {usesUnsupportedBasis
                      ? candidate.nutritionReferenceUnit === "ml"
                        ? "Preview only. This liquid is reported per 100 mL and cannot enter gram-based plan math safely. Use the package-label workflow below only when the label gives a serving weight in grams."
                        : "Preview only. The source does not say whether these values are per 100 g or per 100 mL, so the record cannot enter plan math safely. Choose another result or use a label with a serving weight in grams."
                      : `Preview only; values come from ${providerLabel(candidate.provider)} and are refetched before the record is saved for review.`}
                  </p>
                </div>
                <div className={styles.importControls}>
                  {contextualError ? (
                    <ApiErrorNotice
                      actionDisabled={isImporting || isCoolingDown}
                      className={styles.candidateApiError}
                      error={contextualError}
                      heading={`Could not save ${candidate.displayName}`}
                      onAction={candidateErrorAction}
                      ref={(node) => {
                        if (node) candidateErrorRefs.current.set(key, node);
                        else candidateErrorRefs.current.delete(key);
                      }}
                    />
                  ) : null}
                  {usesUnsupportedBasis ? (
                    <>
                      <p>
                        Catalog save unavailable: this source does not provide a
                        supported, unambiguous 100 g nutrition reference.
                      </p>
                      <button
                        className="button button-quiet"
                        type="button"
                        disabled
                        aria-label={`Nutrition-basis import unavailable for ${candidate.displayName}`}
                      >
                        Nutrition-basis save unavailable
                      </button>
                    </>
                  ) : (
                    <>
                      <p>
                        Save this source-reported record for catalog review. It
                        is not added to any meal. If approved,
                        it will appear as a saved food you can add later.
                      </p>
                      <button
                        className="button button-quiet"
                        type="button"
                        disabled={Boolean(importingKey) || isImported || isCoolingDown}
                        aria-label={
                          isCoolingDown
                            ? `Saving ${candidate.displayName} is temporarily unavailable`
                            : `Save ${candidate.displayName} for catalog review`
                        }
                        onClick={() => void importCandidate(candidate)}
                      >
                        {isImporting
                          ? "Saving…"
                          : isImported
                            ? "Saved for catalog review"
                            : isCoolingDown
                              ? `Wait ${formatCooldown(cooldownSeconds)}`
                              : "Save for catalog review"}
                      </button>
                      {isImported ? (
                        <p className={styles.savedForReview} role="status">
                          Saved for catalog review. It was not added to a meal.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            );
          })}

          {isSearching && rankedResults.length === 0 ? (
            <div className={styles.loadingStack} aria-hidden="true">
              <span /><span /><span />
            </div>
          ) : null}
          {!isSearching && rankedResults.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>No matching saved or source-reported food yet.</strong>
              <p>Try fewer words, check the spelling, or add the package label below.</p>
            </div>
          ) : null}
          {rankedResults.length > INITIAL_RESULT_COUNT ? (
            <div className={styles.showMoreRow}>
              <button
                aria-controls="food-search-result-list"
                aria-expanded={visibleResults.length === rankedResults.length}
                className="button button-quiet"
                type="button"
                onClick={() =>
                  setVisibleResultCount((current) =>
                    current < rankedResults.length
                      ? rankedResults.length
                      : INITIAL_RESULT_COUNT,
                  )
                }
              >
                {visibleResults.length < rankedResults.length
                  ? `Show all ${rankedResults.length - visibleResults.length} remaining ${rankedResults.length - visibleResults.length === 1 ? "match" : "matches"}`
                  : "Show fewer matches"}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <details className={styles.labelFallback}>
        <summary>
          <strong>Product not found? Add package-label photos</strong>
          <span>Create a private, manually confirmed food for your plan.</span>
        </summary>
        <div className={styles.labelFallbackBody}>
          <p>
            Start with a clear package photo, then copy the printed serving and
            nutrition facts yourself. The app does not guess facts from the image.
            The original upload is not retained as-is; server-re-encoded evidence
            stays private and is never shared. Reusable nutrition facts remain
            review-gated.
          </p>
          <FoodLabelUpload
            onCreated={async (_foodId, displayName) => {
              changeSearch(displayName);
              return await catalogCallbackRef.current(displayName);
            }}
          />
        </div>
      </details>
    </section>
  );
}
