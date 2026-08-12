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
};

type ImportResponse = {
  kind: "imported";
  displayName: string;
  reviewStatus: string;
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
  | {
      kind: "import";
      candidate: ExternalFoodCandidate;
      destination: Meal;
    }
  | { kind: "catalog"; query: string };

const CATALOG_DELAY_MS = 300;
const mealLabels: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

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
  const [destinations, setDestinations] = useState<Record<string, Meal>>({});
  const catalogCallbackRef = useRef(onCatalogChanged);
  const activeRequestRef = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const searchCacheRef = useRef(
    new Map<
      string,
      {
        candidates: ExternalFoodCandidate[];
        providers: ExternalFoodProviderStatus[];
      }
    >(),
  );

  useEffect(() => {
    catalogCallbackRef.current = onCatalogChanged;
  }, [onCatalogChanged]);

  const reportError = useCallback(
    (nextError: ApiError, retry: RetryRequest | null = null) => {
      setNotice(null);
      setError(nextError);
      setRetryRequest(retry);
      window.requestAnimationFrame(() => errorRef.current?.focus());
    },
    [],
  );

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
            ? `Found ${nextCandidates.length} source ${nextCandidates.length === 1 ? "match" : "matches"} for “${query}”. Compare them with saved foods below.`
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
      const cached = searchCacheRef.current.get(cacheKey);
      if (cached && !force) {
        applySearchResult(query, cached.candidates, cached.providers);
        return;
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
        const providers = Array.isArray(result.data.providers)
          ? result.data.providers
          : [];
        searchCacheRef.current.set(cacheKey, {
          candidates: result.data.candidates,
          providers,
        });
        applySearchResult(query, result.data.candidates, providers);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setPhase("error");
        setCandidates([]);
        setProviderStatuses([]);
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
    const timer = window.setTimeout(() => {
      void Promise.resolve()
        .then(() => catalogCallbackRef.current(query))
        .then((refreshed) => {
          if (refreshed === false) {
            throw new Error("catalog_refresh_not_confirmed");
          }
        })
        .catch(() => {
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
    return () => window.clearTimeout(timer);
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

    const savedIdentities = new Set(
      localResults.flatMap((result) => {
        if (result.kind !== "saved") return [];
        return [
          result.food.gtin ? `id:${result.food.gtin}` : "",
          `name:${normalizedText(
            `${result.food.brandName ?? ""} ${result.food.name} ${result.food.variantName ?? ""}`,
          )}`,
        ].filter(Boolean);
      }),
    );
    const sourceByIdentity = new Map<string, ExternalFoodCandidate>();
    for (const candidate of candidates) {
      const identity = candidate.gtin
        ? `id:${candidate.gtin}`
        : `name:${normalizedText(candidate.displayName)}`;
      if (savedIdentities.has(identity)) continue;
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

  async function importCandidate(candidate: ExternalFoodCandidate, destination: Meal) {
    const key = `${candidate.provider}:${candidate.externalId}`;
    if (importingKey || importedKeys.has(key)) return;
    setImportingKey(key);
    setError(null);
    setRetryRequest(null);
    setNotice({
      text: `Importing ${candidate.displayName} from ${providerLabel(candidate.provider)} for review before ${mealLabels[destination]} use…`,
    });
    const invalidResponse = clientApiError(
      "FOOD_IMPORT_RESPONSE_INVALID",
      "The source record was not imported.",
      `The ${providerLabel(candidate.provider)} import service returned an unreadable response. Nothing was added to ${mealLabels[destination]}.`,
      {
        retryable: true,
        action: { kind: "retry", label: "Retry import" },
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
        throw apiErrorFromPayload(result, invalidResponse);
      }
      imported = result.data;
      setImportedKeys((current) => new Set(current).add(key));
      setNotice({
        text: `${imported.displayName} was imported for catalog review. ${mealLabels[destination]} is your intended destination on this screen, but the food was not added. After approval, choose it from saved foods and Add.`,
      });
    } catch (error) {
      reportError(
        apiErrorFromPayload(
          { error },
          clientApiError(
            "FOOD_IMPORT_NETWORK_ERROR",
            "The source record was not imported.",
            `The import service could not be reached. Nothing was added to ${mealLabels[destination]}; check the connection and try again or use a package-label photo.`,
            {
              retryable: true,
              action: { kind: "retry", label: "Retry import" },
            },
          ),
        ),
        { kind: "import", candidate, destination },
      );
      setImportingKey(null);
      return;
    }

    try {
      const refreshed = await catalogCallbackRef.current(imported.displayName);
      if (refreshed === false) {
        throw new Error("catalog_refresh_not_confirmed");
      }
    } catch {
      reportError(
        clientApiError(
          "FOOD_IMPORT_REFRESH_FAILED",
          `${imported.displayName} was imported, but saved results did not refresh.`,
          `The imported record remains pending catalog review and was not added to ${mealLabels[destination]}. Retry the refresh; do not import the same source record again.`,
          {
            retryable: true,
            action: { kind: "retry", label: "Refresh saved foods" },
          },
        ),
        { kind: "catalog", query: imported.displayName },
      );
    } finally {
      setImportingKey(null);
    }
  }

  async function retryLastRequest() {
    if (!retryRequest) return;
    if (retryRequest.kind === "search") {
      await runSmartSearch(retryRequest.query, true);
      return;
    }
    if (retryRequest.kind === "import") {
      await importCandidate(retryRequest.candidate, retryRequest.destination);
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
          "The current results remain on screen. Check the connection and try again later; do not repeat an already successful import.",
          {
            retryable: true,
            action: { kind: "retry", label: "Retry saved-food search" },
          },
        ),
        retryRequest,
      );
    }
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
              onChange={(event) => {
                activeRequestRef.current?.abort();
                const value = event.target.value;
                onSearchChange(value);
                setCandidates([]);
                setProviderStatuses([]);
                setNotice(null);
                setError(null);
                setRetryRequest(null);
                setPhase(value.trim().length >= 2 ? "waiting" : "idle");
              }}
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
          “Search all sources” sends the name once to USDA FoodData Central and
          Open Food Facts; repeated searches are reused during this visit.
        </p>
        <ol className={styles.workflow} aria-label="How food search works">
          <li><span>1</span> Type to filter saved foods immediately.</li>
          <li><span>2</span> Search all sources, then compare nutrition.</li>
          <li><span>3</span> Choose Breakfast, Lunch, or Dinner before Add.</li>
        </ol>
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
          {isSearching ? <span className={styles.searchingBadge}>Searching…</span> : null}
        </div>

        <div className={styles.resultList} aria-label="Food search results">
          {rankedResults.map((result) => {
            if (result.kind === "saved") {
              const { food } = result;
              const destination = destinations[result.key] ?? "breakfast";
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
                    <label>
                      <span>Add to</span>
                      <select
                        aria-label={`Destination for ${food.name}`}
                        value={destination}
                        disabled={!food.planEligible}
                        onChange={(event) =>
                          setDestinations((current) => ({
                            ...current,
                            [result.key]: event.target.value as Meal,
                          }))
                        }
                      >
                        {(Object.keys(mealLabels) as Meal[]).map((meal) => (
                          <option value={meal} key={meal}>{mealLabels[meal]}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button button-dark"
                      disabled={!food.planEligible}
                      type="button"
                      aria-label={
                        food.planEligible
                          ? `Add ${food.name} to ${destination}`
                          : `${food.name} needs review`
                      }
                      onClick={() => onAdd(destination, food)}
                    >
                      {food.planEligible ? `Add to ${mealLabels[destination]}` : "Needs review"}
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
            const destination = destinations[result.key] ?? "breakfast";
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
                      : `Preview only; values come from ${providerLabel(candidate.provider)} and are refetched before import.`}
                  </p>
                </div>
                <div className={styles.importControls}>
                  {usesUnsupportedBasis ? (
                    <>
                      <p>
                        Import unavailable: this source does not provide a
                        supported, unambiguous 100 g nutrition reference.
                      </p>
                      <button
                        className="button button-quiet"
                        type="button"
                        disabled
                        aria-label={`Nutrition-basis import unavailable for ${candidate.displayName}`}
                      >
                        Nutrition-basis import unavailable
                      </button>
                    </>
                  ) : (
                    <>
                      <label>
                        <span>Use after review</span>
                        <select
                          aria-label={`Intended destination for ${candidate.displayName}`}
                          value={destination}
                          disabled={isImporting || isImported}
                          onChange={(event) =>
                            setDestinations((current) => ({
                              ...current,
                              [result.key]: event.target.value as Meal,
                            }))
                          }
                        >
                          {(Object.keys(mealLabels) as Meal[]).map((meal) => (
                            <option value={meal} key={meal}>{mealLabels[meal]}</option>
                          ))}
                        </select>
                      </label>
                      <p>Import for source review first. It is not added to the selected meal until approved.</p>
                      <button
                        className="button button-quiet"
                        type="button"
                        disabled={Boolean(importingKey) || isImported}
                        aria-label={`Import ${candidate.displayName} for ${mealLabels[destination]} review`}
                        onClick={() => void importCandidate(candidate, destination)}
                      >
                        {isImporting
                          ? "Importing…"
                          : isImported
                            ? `Imported for ${mealLabels[destination]} review`
                            : `Import for ${mealLabels[destination]} review`}
                      </button>
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
              onSearchChange(displayName);
              return await catalogCallbackRef.current(displayName);
            }}
          />
        </div>
      </details>
    </section>
  );
}
