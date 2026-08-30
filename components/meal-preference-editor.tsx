"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error-notice";
import type { FoodPickerItem } from "@/components/food-search-picker";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromPayload,
  clientApiError,
} from "@/src/lib/client-api-error";
import type {
  FoodNutritionFacts,
  FoodSourceSummary,
} from "@/src/lib/domain/food-catalog";
import {
  MEAL_SLOT_LABELS,
  PRIMARY_MEAL_TYPES,
  type PrimaryMealType,
} from "@/src/lib/domain/meal-slots";

const FoodSearchPicker = dynamic(
  () =>
    import("@/components/food-search-picker").then(
      (module) => module.FoodSearchPicker,
    ),
  {
    loading: () => (
      <div className="message-box" role="status">
        Loading food search…
      </div>
    ),
  },
);

type Meal = PrimaryMealType;

export type StoredMealPreference = {
  mealType: Meal;
  foodId: string;
  foodName: string;
  sortOrder: number;
};

type MutationResponse = {
  id: string;
  mealType: Meal;
  foodId: string;
  sortOrder: number;
  persisted: boolean;
};

type RemovalResponse = {
  removed: true;
  alreadyAbsent?: boolean;
  mealType: Meal;
  foodId: string;
  persisted: boolean;
};

const meals = PRIMARY_MEAL_TYPES;
const mealLabels = MEAL_SLOT_LABELS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function storedPreferencesFromPayload(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
  if (payload.data.length > meals.length * 50) return null;

  const preferences: StoredMealPreference[] = [];
  const seen = new Set<string>();
  for (const value of payload.data) {
    if (!isRecord(value)) return null;
    const { mealType, foodId, foodName, sortOrder } = value;
    if (
      typeof mealType !== "string" ||
      !meals.includes(mealType as Meal) ||
      typeof foodId !== "string" ||
      !foodId ||
      typeof foodName !== "string" ||
      !foodName ||
      !Number.isInteger(sortOrder) ||
      (sortOrder as number) < 0
    ) {
      return null;
    }
    const key = `${mealType}:${foodId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    preferences.push({
      mealType: mealType as Meal,
      foodId,
      foodName,
      sortOrder: sortOrder as number,
    });
  }
  return preferences;
}

function appendResponse(
  value: unknown,
  mealType: Meal,
  foodId: string,
): MutationResponse | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.mealType !== mealType ||
    value.foodId !== foodId ||
    !Number.isInteger(value.sortOrder) ||
    (value.sortOrder as number) < 0 ||
    typeof value.persisted !== "boolean"
  ) {
    return null;
  }
  return value as MutationResponse;
}

function removalResponse(
  value: unknown,
  mealType: Meal,
  foodId: string,
): RemovalResponse | null {
  if (!isRecord(value)) return null;
  if (
    value.removed !== true ||
    value.mealType !== mealType ||
    value.foodId !== foodId ||
    typeof value.persisted !== "boolean" ||
    (value.alreadyAbsent !== undefined &&
      typeof value.alreadyAbsent !== "boolean")
  ) {
    return null;
  }
  return value as RemovalResponse;
}

function catalogFood(food: {
  id: string;
  english_name: string;
  categories?: string[];
  plan_eligible: boolean;
  brand_name?: string | null;
  variant_name?: string | null;
  gtin?: string | null;
  catalog_status?: FoodPickerItem["catalogStatus"];
  nutrition?: FoodNutritionFacts | null;
  source?: FoodSourceSummary | null;
}): FoodPickerItem {
  return {
    id: food.id,
    name: food.english_name,
    categories: food.categories ?? [],
    planEligible: food.plan_eligible,
    brandName: food.brand_name,
    variantName: food.variant_name,
    gtin: food.gtin,
    catalogStatus: food.catalog_status,
    nutrition: food.nutrition,
    source: food.source,
  };
}

export function MealPreferenceEditor({
  initialPreferences,
  catalogAdditions = [],
  disabled = false,
}: {
  initialPreferences: StoredMealPreference[];
  catalogAdditions?: Array<{ foodId: string; foodName: string }>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] =
    useState<StoredMealPreference[]>(initialPreferences);
  const [foods, setFoods] = useState<FoodPickerItem[]>(() => [
    ...new Map(
      initialPreferences.map((preference) => [
        preference.foodId,
        {
          id: preference.foodId,
          name: preference.foodName,
          categories: [],
          planEligible: true,
        } satisfies FoodPickerItem,
      ]),
    ).values(),
  ]);
  const [search, setSearch] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<ApiError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const retryRef = useRef<(() => void) | null>(null);

  const catalogFoods = useMemo(() => {
    const merged = new Map(foods.map((food) => [food.id, food]));
    catalogAdditions.forEach((food) => {
      merged.set(food.foodId, {
        id: food.foodId,
        name: food.foodName,
        categories: [],
        planEligible: true,
      });
    });
    return [...merged.values()];
  }, [catalogAdditions, foods]);

  async function loadFoods(query = "") {
    try {
      const response = await fetch(
        `/api/foods?limit=100&q=${encodeURIComponent(query.trim())}`,
      );
      if (!response.ok) return false;
      const payload = (await response.json().catch(() => null)) as {
        data?: Array<{
          id: string;
          english_name: string;
          categories?: string[];
          plan_eligible: boolean;
          brand_name?: string | null;
          variant_name?: string | null;
          gtin?: string | null;
          catalog_status?: FoodPickerItem["catalogStatus"];
          nutrition?: FoodNutritionFacts | null;
          source?: FoodSourceSummary | null;
        }>;
      } | null;
      if (!Array.isArray(payload?.data)) return false;
      const loaded = payload.data.map(catalogFood);
      setFoods((current) => {
        const merged = new Map(current.map((food) => [food.id, food]));
        loaded.forEach((food) => merged.set(food.id, food));
        return [...merged.values()];
      });
      return true;
    } catch {
      return false;
    }
  }

  async function refreshPreferences() {
    try {
      const response = await fetch("/api/settings/meal-preferences", {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      const refreshed = storedPreferencesFromPayload(payload);
      if (!response.ok || !refreshed) return null;
      setPreferences(refreshed);
      return refreshed;
    } catch {
      return null;
    }
  }

  async function refreshAfterDuplicate(
    mealType: Meal,
    food: FoodPickerItem,
  ) {
    if (pendingKey) return;
    setPendingKey(`refresh:${mealType}:${food.id}`);
    const refreshed = await refreshPreferences();
    if (refreshed) {
      retryRef.current = null;
      setOperationError(null);
      setAnnouncement(
        refreshed.some(
          (preference) =>
            preference.mealType === mealType &&
            preference.foodId === food.id,
        )
          ? `${food.name} is already saved in ${mealLabels[mealType]} preferences.`
          : `${food.name} is no longer saved in ${mealLabels[mealType]}. Choose Add if you want to save it again.`,
      );
    } else {
      retryRef.current = () => void refreshAfterDuplicate(mealType, food);
      setAnnouncement(
        "Saved meal preferences could not be refreshed. No new preference was submitted.",
      );
    }
    setPendingKey(null);
  }

  async function addPreference(mealType: Meal, food: FoodPickerItem) {
    const mutationKey = `add:${mealType}:${food.id}`;
    if (pendingKey) return;
    if (
      preferences.some(
        (preference) =>
          preference.mealType === mealType && preference.foodId === food.id,
      )
    ) {
      setAnnouncement(`${food.name} is already selected for ${mealLabels[mealType]}.`);
      return;
    }

    const fallback = clientApiError(
      "MEAL_PREFERENCE_ADD_UNAVAILABLE",
      `${food.name} could not be added to ${mealLabels[mealType]}.`,
      "The saved result could not be confirmed. Refresh preferences before retrying because the server may already have added it.",
      {
        retryable: true,
        action: { kind: "retry", label: "Try adding again" },
      },
    );
    setPendingKey(mutationKey);
    setOperationError(null);
    retryRef.current = () => void addPreference(mealType, food);
    try {
      const response = await fetch("/api/settings/meal-preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mealType, foodId: food.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw apiErrorFromPayload(payload, fallback);
      }
      const result = appendResponse(
        isRecord(payload) ? payload.data : null,
        mealType,
        food.id,
      );
      if (!result) throw fallback;
      setPreferences((current) => [
        ...current,
        {
          mealType,
          foodId: food.id,
          foodName: food.name,
          sortOrder: result.sortOrder,
        },
      ]);
      retryRef.current = null;
      setAnnouncement(
        result.persisted
          ? `${food.name} was added to ${mealLabels[mealType]} preferences.`
          : `${food.name} was added to this demo preview only.`,
      );
    } catch (error) {
      const publicError = apiErrorFromPayload({ error }, fallback);
      const refreshed = await refreshPreferences();
      if (
        refreshed?.some(
          (preference) =>
            preference.mealType === mealType &&
            preference.foodId === food.id,
        )
      ) {
        retryRef.current = null;
        setOperationError(null);
        setAnnouncement(
          `${food.name} is saved in ${mealLabels[mealType]} preferences. The list was refreshed after the earlier response could not be confirmed.`,
        );
        return;
      }
      if (publicError.code === "DUPLICATE_MEAL_PREFERENCE") {
        retryRef.current = () => void refreshAfterDuplicate(mealType, food);
      }
      setOperationError(publicError);
      setAnnouncement(
        refreshed
          ? `${food.name} is not in the latest saved ${mealLabels[mealType]} preferences. You can retry the add.`
          : `${food.name} could not be confirmed as added. Refresh preferences before trying again.`,
      );
    } finally {
      setPendingKey(null);
    }
  }

  async function removePreference(preference: StoredMealPreference) {
    const mutationKey = `remove:${preference.mealType}:${preference.foodId}`;
    if (pendingKey) return;
    const fallback = clientApiError(
      "MEAL_PREFERENCE_REMOVE_UNAVAILABLE",
      `${preference.foodName} could not be removed from ${mealLabels[preference.mealType]}.`,
      "The saved result could not be confirmed. Refresh preferences before retrying because the server may already have removed it.",
      {
        retryable: true,
        action: { kind: "retry", label: "Try removing again" },
      },
    );
    setPendingKey(mutationKey);
    setOperationError(null);
    retryRef.current = () => void removePreference(preference);
    const removesLastForMeal =
      preferences.filter(
        (candidate) => candidate.mealType === preference.mealType,
      ).length === 1;
    try {
      const response = await fetch("/api/settings/meal-preferences", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mealType: preference.mealType,
          foodId: preference.foodId,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw apiErrorFromPayload(payload, fallback);
      }
      const result = removalResponse(
        isRecord(payload) ? payload.data : null,
        preference.mealType,
        preference.foodId,
      );
      if (!result) throw fallback;
      setPreferences((current) =>
        current.filter(
          (candidate) =>
            !(
              candidate.mealType === preference.mealType &&
              candidate.foodId === preference.foodId
            ),
        ),
      );
      retryRef.current = null;
      setAnnouncement(
        result.persisted
          ? `${preference.foodName} was removed from ${mealLabels[preference.mealType]} preferences.${
              removesLastForMeal
                ? ` ${mealLabels[preference.mealType]} is now None selected.`
                : ""
            }`
          : `${preference.foodName} was removed from this demo preview only.`,
      );
    } catch (error) {
      const publicError = apiErrorFromPayload({ error }, fallback);
      const refreshed = await refreshPreferences();
      if (
        refreshed &&
        !refreshed.some(
          (candidate) =>
            candidate.mealType === preference.mealType &&
            candidate.foodId === preference.foodId,
        )
      ) {
        retryRef.current = null;
        setOperationError(null);
        setAnnouncement(
          `${preference.foodName} is no longer in ${mealLabels[preference.mealType]} preferences. The list was refreshed after the earlier response could not be confirmed.${
            removesLastForMeal
              ? ` ${mealLabels[preference.mealType]} is now None selected.`
              : ""
          }`,
        );
        return;
      }
      setOperationError(publicError);
      setAnnouncement(
        refreshed
          ? `${preference.foodName} is still in the latest saved ${mealLabels[preference.mealType]} preferences. You can retry the removal.`
          : `${preference.foodName} could not be confirmed as removed. Refresh preferences before trying again.`,
      );
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="meal-preference-editor">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="meal-preference-summary">
        <div>
          <strong>Meal food preferences</strong>
          <p className="field-help">
            These choices guide future generated plans. Today&apos;s food log stays
            separate and accepted plans never change silently.
          </p>
        </div>
        <button
          aria-expanded={open}
          aria-controls="meal-preference-editor-panel"
          className="button button-quiet"
          disabled={disabled}
          onClick={() => {
            const nextOpen = !open;
            setOpen(nextOpen);
            if (nextOpen) void loadFoods(search);
          }}
          type="button"
        >
          <Pencil aria-hidden="true" size={16} />
          {open ? "Close editor" : "Edit meal preferences"}
        </button>
      </div>

      <div className="meal-preference-groups" aria-label="Stored meal preferences">
        {meals.map((mealType) => {
          const selected = preferences
            .filter((preference) => preference.mealType === mealType)
            .sort((left, right) => left.sortOrder - right.sortOrder);
          return (
            <section className="meal-preference-group" key={mealType}>
              <h3>{mealLabels[mealType]}</h3>
              {selected.length ? (
                <ul>
                  {selected.map((preference) => (
                    <li key={preference.foodId}>
                      <Check aria-hidden="true" size={15} />
                      <span>{preference.foodName}</span>
                      {open ? (
                        <button
                          aria-label={`Remove ${preference.foodName} from ${mealLabels[mealType]} preferences`}
                          className="icon-button"
                          disabled={pendingKey !== null}
                          onClick={() => void removePreference(preference)}
                          type="button"
                        >
                          <X aria-hidden="true" size={16} />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-help">None selected</p>
              )}
            </section>
          );
        })}
      </div>
      <p className="meal-preference-guidance">
        A future plan needs enough eligible foods across Breakfast, Lunch, and
        Dinner. Leaving a meal as None selected can prevent new generation, but
        it does not change your accepted plan or today&apos;s food log.
      </p>

      {open ? (
        <div className="meal-preference-editor-panel" id="meal-preference-editor-panel">
          {operationError ? (
            <ApiErrorNotice
              actionDisabled={pendingKey !== null}
              error={operationError}
              heading="Meal preferences were not changed"
              onAction={
                operationError.action?.kind === "retry"
                  ? () => retryRef.current?.()
                  : undefined
              }
            />
          ) : null}
          <FoodSearchPicker
            addDisabled={pendingKey !== null}
            foods={catalogFoods}
            onAdd={(mealType, food) => void addPreference(mealType, food)}
            onCatalogChanged={loadFoods}
            onSearchChange={setSearch}
            search={search}
            showLabelUploadFallback={false}
          />
          <p className="meal-preference-label-link">
            Can&apos;t find a packaged product?{" "}
            <a className="text-link" href="#foods">
              Read its nutrition-label photo once in Private label foods
            </a>
            , then return here to select it.
          </p>
        </div>
      ) : null}
    </div>
  );
}
