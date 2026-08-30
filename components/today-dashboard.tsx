"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Circle,
  Coffee,
  Cookie,
  Dumbbell,
  MoonStar,
  Pencil,
  Plus,
  Scale,
  Sparkles,
  Sun,
  Utensils,
  X,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { LazyWeightTrendChart } from "@/components/lazy-weight-trend-chart";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromResponse,
  apiErrorFromThrown,
  clientApiError,
} from "@/src/lib/client-api-error";
import {
  MEAL_CHECKIN_STATUSES,
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  SNACK_MEAL_TYPES,
  isPrimaryMealType,
  normalizeMealSlotCheckins,
  type MealCheckinStatus,
  type MealSlot,
  type MealSlotCheckin,
  type PrimaryMealType,
} from "@/src/lib/domain/meal-slots";
import { summarizeMealCheckins } from "@/src/lib/domain/completion";
import { localDateInTimeZone } from "@/src/lib/domain/dates";
import type {
  FoodNutritionFacts,
  FoodSourceSummary,
} from "@/src/lib/domain/food-catalog";

export type TodayMealItem = {
  id: string;
  foodId: string;
  name: string;
  verificationStatus: string;
};

export type TodayMealCheckin = MealSlotCheckin & {
  items: TodayMealItem[];
};

type CatalogFood = {
  id: string;
  english_name: string;
  verification_status: string;
  plan_eligible?: boolean;
  brand_name?: string | null;
  variant_name?: string | null;
  gtin?: string | null;
  catalog_status?: "active" | "pending_review" | "rejected" | "retired";
  nutrition?: FoodNutritionFacts | null;
  source?: FoodSourceSummary | null;
};

const demoMeals: Array<{
  key: MealSlot;
  label: string;
  detail: string;
  Icon: typeof Coffee;
}> = [
  { key: "breakfast", label: "Breakfast", detail: "Oats, yogurt & blueberries", Icon: Coffee },
  { key: "morning_snack", label: "Morning snack", detail: "No snack recorded", Icon: Cookie },
  { key: "lunch", label: "Lunch", detail: "Rice bowl with chicken & greens", Icon: Sun },
  { key: "afternoon_snack", label: "Afternoon snack", detail: "No snack recorded", Icon: Cookie },
  { key: "dinner", label: "Dinner", detail: "Salmon, potato & broccoli", Icon: MoonStar },
  { key: "evening_snack", label: "Evening snack", detail: "No snack recorded", Icon: Cookie },
];

const demoWeightData = [
  { day: "Fri", weight: 81.4 },
  { day: "Sat", weight: 81.2 },
  { day: "Sun", weight: 81.3 },
  { day: "Mon", weight: 81.0 },
  { day: "Tue", weight: 80.9 },
  { day: "Wed", weight: 80.8 },
  { day: "Thu", weight: 80.7 },
];

export type TodayWeightPoint = { day: string; weight: number };

function mutationResponseMayBeAmbiguous(response: { status?: number }) {
  return typeof response.status === "number" && response.status >= 500;
}

function checkinsFromDayPayload(payload: unknown): TodayMealCheckin[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const slots = (data as { slots?: unknown }).slots;
  if (!Array.isArray(slots) || slots.length !== MEAL_SLOTS.length) return null;

  const parsed = new Map<MealSlot, TodayMealCheckin>();
  for (const value of slots) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const slot = value as Record<string, unknown>;
    if (
      typeof slot.mealType !== "string" ||
      !MEAL_SLOTS.includes(slot.mealType as MealSlot) ||
      typeof slot.status !== "string" ||
      !MEAL_CHECKIN_STATUSES.includes(slot.status as MealCheckinStatus) ||
      (slot.skipReason !== null && typeof slot.skipReason !== "string") ||
      !Array.isArray(slot.items)
    ) {
      return null;
    }
    const items: TodayMealItem[] = [];
    for (const valueItem of slot.items) {
      if (
        !valueItem ||
        typeof valueItem !== "object" ||
        Array.isArray(valueItem)
      ) {
        return null;
      }
      const item = valueItem as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        typeof item.foodId !== "string" ||
        typeof item.name !== "string" ||
        typeof item.verificationStatus !== "string"
      ) {
        return null;
      }
      items.push({
        id: item.id,
        foodId: item.foodId,
        name: item.name,
        verificationStatus: item.verificationStatus,
      });
    }
    const mealType = slot.mealType as MealSlot;
    if (parsed.has(mealType)) return null;
    parsed.set(mealType, {
      mealType,
      status: slot.status as MealCheckinStatus,
      skipReason: slot.status === "skipped" ? slot.skipReason as string | null : null,
      items,
    });
  }

  return parsed.size === MEAL_SLOTS.length
    ? MEAL_SLOTS.map((mealType) => parsed.get(mealType)!)
    : null;
}

function normalizeTodayCheckins(
  initialCheckins: TodayMealCheckin[] | undefined,
  initialCompleted: Record<PrimaryMealType, boolean>,
) {
  const suppliedItems = new Map(
    (initialCheckins ?? []).map((checkin) => [
      checkin.mealType,
      Array.isArray(checkin.items) ? checkin.items : [],
    ]),
  );
  const statusRows = initialCheckins ??
    MEAL_SLOTS.map((mealType) => ({
      mealType,
      status:
        isPrimaryMealType(mealType) && initialCompleted[mealType]
          ? "completed" as const
          : "not_marked" as const,
      skipReason: null,
    }));

  return normalizeMealSlotCheckins(statusRows).map((checkin) => ({
    ...checkin,
    items: suppliedItems.get(checkin.mealType) ?? [],
  }));
}

export function TodayDashboard({
  name = "Jamie",
  timeZone = "America/New_York",
  initialCheckins,
  initialCompleted = {
    breakfast: true,
    lunch: true,
    dinner: false,
  },
  mealDetails,
  weightPoints = demoWeightData,
  providerLabel = "Mock AI plan — development only",
  weeklyMarked = 10,
  weeklyPossible = 12,
  weeklySkipped = 0,
  energyRange,
  proteinRange,
  goalContext,
  renderedLocalDay,
  demoMode = true,
}: {
  name?: string;
  timeZone?: string;
  initialCheckins?: TodayMealCheckin[];
  initialCompleted?: Record<PrimaryMealType, boolean>;
  mealDetails?: Partial<Record<MealSlot, string>>;
  weightPoints?: TodayWeightPoint[];
  providerLabel?: string;
  weeklyMarked?: number;
  weeklyPossible?: number;
  weeklySkipped?: number;
  energyRange?: { minimum: number; maximum: number } | null;
  proteinRange?: { minimum: number; maximum: number } | null;
  goalContext?: {
    type: string;
    targetDate: string;
    currentKg: number | null;
    targetKg: number;
    startKg: number | null;
    remainingDays: number;
  } | null;
  renderedLocalDay?: string;
  demoMode?: boolean;
}) {
  const [checkins, setCheckins] = useState<TodayMealCheckin[]>(
    () => normalizeTodayCheckins(initialCheckins, initialCompleted),
  );
  const [announcement, setAnnouncement] = useState("");
  const [operationError, setOperationError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState<MealSlot | null>(null);
  const [skipEditor, setSkipEditor] = useState<MealSlot | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [foodEditor, setFoodEditor] = useState<MealSlot | null>(null);
  const [foodSearch, setFoodSearch] = useState("");
  const [catalogFoods, setCatalogFoods] = useState<CatalogFood[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const foodRequestIdRef = useRef(0);
  const foodAbortRef = useRef<AbortController | null>(null);
  const skipReasonInputRef = useRef<HTMLInputElement | null>(null);
  const foodSearchInputRef = useRef<HTMLInputElement | null>(null);
  const skipOpenerRefs = useRef<
    Partial<Record<MealSlot, HTMLButtonElement | null>>
  >({});
  const foodOpenerRefs = useRef<
    Partial<Record<MealSlot, HTMLButtonElement | null>>
  >({});
  const mainSummary = summarizeMealCheckins(checkins);
  const snackItemCount = checkins.reduce(
    (total, checkin) =>
      SNACK_MEAL_TYPES.includes(
        checkin.mealType as (typeof SNACK_MEAL_TYPES)[number],
      )
        ? total + checkin.items.length
        : total,
    0,
  );
  const stableLocalDay = useMemo(
    () => renderedLocalDay ?? localDateInTimeZone(new Date(), timeZone),
    [renderedLocalDay, timeZone],
  );
  const localDate = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date(`${stableLocalDay}T12:00:00Z`)),
    [stableLocalDay],
  );
  const meals = demoMeals.map((meal) => ({
    ...meal,
    detail:
      mealDetails?.[meal.key] ??
      (demoMode
        ? meal.detail
        : isPrimaryMealType(meal.key)
          ? "No accepted plan meal is available for this day."
          : "Optional space for food eaten between meals."),
  }));

  useEffect(
    () => () => {
      foodRequestIdRef.current += 1;
      foodAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (skipEditor) skipReasonInputRef.current?.focus();
  }, [skipEditor]);

  useEffect(() => {
    if (foodEditor) foodSearchInputRef.current?.focus();
  }, [foodEditor]);

  function checkinFor(mealType: MealSlot) {
    return checkins.find((checkin) => checkin.mealType === mealType)!;
  }

  function restoreOpenerFocus(
    refs: RefObject<Partial<Record<MealSlot, HTMLButtonElement | null>>>,
    mealType: MealSlot,
  ) {
    window.requestAnimationFrame(() => refs.current?.[mealType]?.focus());
  }

  function closeSkipEditor({ restoreFocus = true } = {}) {
    const closingMeal = skipEditor;
    setSkipEditor(null);
    setSkipReason("");
    if (restoreFocus && closingMeal) {
      restoreOpenerFocus(skipOpenerRefs, closingMeal);
    }
  }

  function openSkipEditor(mealType: MealSlot) {
    closeFoodPicker({ restoreFocus: false });
    setSkipEditor(mealType);
    setSkipReason("");
  }

  function localDayForMutation() {
    let currentLocalDay: string;
    try {
      currentLocalDay = localDateInTimeZone(new Date(), timeZone);
    } catch {
      currentLocalDay = "";
    }
    if (currentLocalDay === stableLocalDay) return stableLocalDay;

    const dayChanged = clientApiError(
      "TODAY_DAY_CHANGED",
      "A new local day has started.",
      "This page still shows the prior day, so no change was sent. Load the new day before recording another meal.",
      {
        retryable: true,
        action: { kind: "navigate", label: "Load the new day", href: "/today" },
      },
    );
    setOperationError(dayChanged);
    setAnnouncement(
      "A new local day has started. No change was sent; load the new day first.",
    );
    return null;
  }

  async function refreshDayCheckins(localDay: string) {
    const fallback = clientApiError(
      "CHECKIN_REFRESH_UNAVAILABLE",
      "The saved day could not be refreshed.",
      "The server may have completed the earlier change. No additional write was attempted; check the connection and refresh Today.",
      {
        retryable: true,
        action: {
          kind: "navigate",
          label: "Refresh Today",
          href: "/today",
        },
      },
    );
    const response = await fetch(`/api/checkins/${localDay}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) throw await apiErrorFromResponse(response, fallback);
    const payload = await response.json().catch(() => null);
    const refreshed = checkinsFromDayPayload(payload);
    if (!refreshed) throw fallback;
    setCheckins(refreshed);
    return refreshed;
  }

  async function updateMeal(
    meal: MealSlot,
    status: MealCheckinStatus,
    reason: string | null = null,
  ) {
    if (saving) return;
    const localDay = localDayForMutation();
    if (!localDay) return;
    if (
      status === "skipped" &&
      checkinFor(meal).items.length > 0
    ) {
      closeSkipEditor();
      setAnnouncement(
        "Remove recorded foods before marking this slot skipped.",
      );
      return;
    }
    const previous = checkins;
    const fallback = clientApiError(
      "CHECKIN_SAVE_UNAVAILABLE",
      "The meal status could not be saved.",
      "The screen returns to its earlier status after a confirmed failure. If the response was interrupted, refresh Today before another change.",
      {
        retryable: true,
        action: { kind: "navigate", label: "Refresh Today", href: "/today" },
      },
    );
    setOperationError(null);
    const desired = checkins.map((checkin) =>
      checkin.mealType === meal
        ? {
            ...checkin,
            status,
            skipReason: status === "skipped" ? reason : null,
          }
        : checkin,
    );
    setCheckins(desired);
    setSaving(meal);
    const label = meals.find((item) => item.key === meal)?.label ?? meal;
    let mutationRejected = false;
    try {
      const response = await fetch(`/api/checkins/${localDay}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "meal_status",
          mealType: meal,
          status,
          skipReason: status === "skipped" ? reason : null,
        }),
      });
      if (!response.ok) {
        mutationRejected = !mutationResponseMayBeAmbiguous(response);
        throw await apiErrorFromResponse(response, fallback);
      }
      closeSkipEditor();
      setAnnouncement(
        `${label} is now ${status.replace("_", " ")}.`,
      );
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      if (
        !demoMode &&
        (!mutationRejected ||
          publicError.code === "RECORDED_FOODS_PREVENT_SKIP")
      ) {
        try {
          const refreshed = await refreshDayCheckins(localDay);
          const storedMeal = refreshed.find(
            (checkin) => checkin.mealType === meal,
          )!;
          closeSkipEditor();
          if (publicError.code === "RECORDED_FOODS_PREVENT_SKIP") {
            setOperationError(publicError);
            setAnnouncement(
              `${label} was not skipped because recorded food was added elsewhere. Today was refreshed.`,
            );
          } else {
            setOperationError(null);
            setAnnouncement(
              `${label} is ${storedMeal.status.replaceAll("_", " ")}. Today was refreshed after the earlier response could not be confirmed.`,
            );
          }
          return;
        } catch {
          // Restore the pre-mutation view below when the authoritative refresh
          // also fails. The stable conflict still explains the safe next step.
        }
      }
      setCheckins(previous);
      setOperationError(publicError);
      setAnnouncement(
        mutationRejected
          ? `We could not save ${label}. Your previous status was restored.`
          : `We could not confirm the saved status for ${label}. The screen shows its earlier status; refresh Today before another change.`,
      );
    } finally {
      setSaving(null);
    }
  }

  async function loadFoods(query = "") {
    const requestId = foodRequestIdRef.current + 1;
    foodRequestIdRef.current = requestId;
    foodAbortRef.current?.abort();
    const controller = new AbortController();
    foodAbortRef.current = controller;
    const fallback = clientApiError(
      "FOOD_CATALOG_UNAVAILABLE",
      "The food catalog could not be loaded.",
      "No food was added. Check the connection and try the search again.",
      { retryable: true, action: { kind: "retry", label: "Search again" } },
    );
    setOperationError(null);
    setCatalogLoading(true);
    try {
      const response = await fetch(
        `/api/foods?q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw await apiErrorFromResponse(response, fallback);
      }
      const result = (await response.json()) as { data?: unknown };
      if (requestId !== foodRequestIdRef.current) return;
      setCatalogFoods(Array.isArray(result.data) ? result.data : []);
    } catch (error) {
      if (requestId !== foodRequestIdRef.current) return;
      const publicError = apiErrorFromThrown(error, fallback);
      setCatalogFoods([]);
      setOperationError(publicError);
      setAnnouncement("The food catalog could not be loaded. Please try again.");
    } finally {
      if (requestId === foodRequestIdRef.current) {
        foodAbortRef.current = null;
        setCatalogLoading(false);
      }
    }
  }

  function openFoodPicker(mealType: MealSlot) {
    closeSkipEditor({ restoreFocus: false });
    setFoodEditor(mealType);
    setFoodSearch("");
    void loadFoods();
  }

  function closeFoodPicker({ restoreFocus = true } = {}) {
    const closingMeal = foodEditor;
    // Closing invalidates and aborts the active lookup so it cannot consume more
    // network or repopulate a later picker. The request id remains a second guard
    // for fetch implementations that settle after abort.
    foodRequestIdRef.current += 1;
    foodAbortRef.current?.abort();
    foodAbortRef.current = null;
    setCatalogLoading(false);
    setFoodEditor(null);
    setFoodSearch("");
    setCatalogFoods([]);
    if (restoreFocus && closingMeal) {
      restoreOpenerFocus(foodOpenerRefs, closingMeal);
    }
  }

  function searchFoods(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadFoods(foodSearch);
  }

  async function addFood(mealType: MealSlot, food: CatalogFood) {
    if (saving) return;
    const localDay = localDayForMutation();
    if (!localDay) return;
    setSaving(mealType);
    setOperationError(null);
    const fallback = clientApiError(
      "MEAL_ITEM_SAVE_UNAVAILABLE",
      `${food.english_name} could not be added.`,
      "The result could not be confirmed. Refresh Today before retrying because the server may already have recorded it.",
      {
        retryable: true,
        action: { kind: "navigate", label: "Refresh Today", href: "/today" },
      },
    );
    let mutationConfirmed = false;
    let mutationRejected = false;
    try {
      const response = await fetch(`/api/checkins/${localDay}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mealType, foodId: food.id }),
      });
      if (!response.ok) {
        mutationRejected = !mutationResponseMayBeAmbiguous(response);
        throw await apiErrorFromResponse(response, fallback);
      }
      mutationConfirmed = true;

      if (!demoMode) {
        const refreshed = await refreshDayCheckins(localDay);
        const storedMeal = refreshed.find(
          (checkin) => checkin.mealType === mealType,
        );
        if (!storedMeal?.items.some((item) => item.foodId === food.id)) {
          throw clientApiError(
            "CHECKIN_REFRESH_INCONSISTENT",
            "The server response could not be reconciled with the latest day.",
            "Refresh Today before changing this meal again.",
            {
              retryable: true,
              action: {
                kind: "navigate",
                label: "Refresh Today",
                href: "/today",
              },
            },
          );
        }
        closeFoodPicker();
        closeSkipEditor({ restoreFocus: false });
        setAnnouncement(
          `${food.english_name} was recorded for ${MEAL_SLOT_LABELS[mealType]} and the slot was marked completed.`,
        );
        return;
      }

      const result = (await response.json()) as {
        data?: {
          id?: string;
          food?: {
            id: string;
            english_name: string;
            verification_status: string;
          };
        };
      };
      if (typeof result.data?.id !== "string" || !result.data.id) {
        throw clientApiError(
          "MEAL_ITEM_RESPONSE_INVALID",
          `${food.english_name} could not be shown as recorded.`,
          "The demo response was unreadable. No account data was saved.",
          { retryable: true, action: { kind: "retry", label: "Try adding again" } },
        );
      }
      const itemId = result.data.id;
      const storedFood = result.data?.food ?? food;
      setCheckins((current) =>
        current.map((checkin) =>
          checkin.mealType === mealType
            ? {
                ...checkin,
                status: "completed",
                skipReason: null,
                items: checkin.items.some((item) => item.foodId === food.id)
                  ? checkin.items
                  : [
                      ...checkin.items,
                      {
                        id: itemId,
                        foodId: storedFood.id,
                        name: storedFood.english_name,
                        verificationStatus: storedFood.verification_status,
                      },
                    ],
              }
            : checkin,
        ),
      );
      closeFoodPicker();
      closeSkipEditor({ restoreFocus: false });
      setAnnouncement(
        `${food.english_name} was recorded for ${MEAL_SLOT_LABELS[mealType]} and the slot was marked completed.`,
      );
    } catch (error) {
      if (!demoMode && !mutationConfirmed && !mutationRejected) {
        try {
          const refreshed = await refreshDayCheckins(localDay);
          const storedMeal = refreshed.find(
            (checkin) => checkin.mealType === mealType,
          );
          if (storedMeal?.items.some((item) => item.foodId === food.id)) {
            closeFoodPicker();
            closeSkipEditor({ restoreFocus: false });
            setOperationError(null);
            setAnnouncement(
              `${food.english_name} is recorded for ${MEAL_SLOT_LABELS[mealType]}. Today was refreshed after the earlier response could not be confirmed.`,
            );
            return;
          }
        } catch {
          // Keep the original mutation failure below. Its retry guidance is
          // safer than claiming an unconfirmed write succeeded.
        }
      }
      const publicError = apiErrorFromThrown(error, fallback);
      setOperationError(publicError);
      setAnnouncement(
        mutationConfirmed
          ? `${food.english_name} was recorded, but the latest day could not be confirmed. Refresh Today before another change.`
          : mutationRejected
            ? `${food.english_name} was not added. No food record was changed.`
            : `${food.english_name} could not be confirmed as recorded. Refresh Today before trying again.`,
      );
    } finally {
      setSaving(null);
    }
  }

  async function removeFood(mealType: MealSlot, item: TodayMealItem) {
    if (saving) return;
    const localDay = localDayForMutation();
    if (!localDay) return;
    setSaving(mealType);
    setOperationError(null);
    const fallback = clientApiError(
      "MEAL_ITEM_DELETE_UNAVAILABLE",
      `${item.name} could not be removed.`,
      "The result could not be confirmed. Refresh Today before retrying because the server may already have removed it.",
      { retryable: true, action: { kind: "retry", label: "Try removing again" } },
    );
    const isSnack = SNACK_MEAL_TYPES.includes(
      mealType as (typeof SNACK_MEAL_TYPES)[number],
    );
    const itemWasRemoved = (current: TodayMealCheckin[]) =>
      !current
        .find((checkin) => checkin.mealType === mealType)
        ?.items.some((candidate) => candidate.id === item.id);
    const announceRemoval = (current: TodayMealCheckin[]) => {
      const storedMeal = current.find(
        (checkin) => checkin.mealType === mealType,
      )!;
      if (isSnack && storedMeal.items.length === 0) {
        return `${item.name} was removed from ${MEAL_SLOT_LABELS[mealType]}. The empty snack is now ${storedMeal.status.replaceAll("_", " ")}.`;
      }
      if (isSnack) {
        return `${item.name} was removed from ${MEAL_SLOT_LABELS[mealType]}. ${storedMeal.items.length} other snack ${storedMeal.items.length === 1 ? "item remains" : "items remain"}; the slot is ${storedMeal.status.replaceAll("_", " ")}.`;
      }
      return `${item.name} was removed from ${MEAL_SLOT_LABELS[mealType]}. The meal is still ${storedMeal.status.replaceAll("_", " ")}.`;
    };
    let mutationConfirmed = false;
    let mutationRejected = false;
    try {
      const response = await fetch(
        `/api/checkins/${localDay}/items/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        mutationRejected = !mutationResponseMayBeAmbiguous(response);
        throw await apiErrorFromResponse(response, fallback);
      }
      mutationConfirmed = true;

      if (!demoMode) {
        const refreshed = await refreshDayCheckins(localDay);
        if (!itemWasRemoved(refreshed)) {
          throw clientApiError(
            "CHECKIN_REFRESH_INCONSISTENT",
            "The server response could not be reconciled with the latest day.",
            "Refresh Today before changing this meal again.",
            {
              retryable: true,
              action: {
                kind: "navigate",
                label: "Refresh Today",
                href: "/today",
              },
            },
          );
        }
        setAnnouncement(announceRemoval(refreshed));
        return;
      }

      const localResult = checkins.map((checkin) => {
        if (checkin.mealType !== mealType) return checkin;
        const items = checkin.items.filter(
          (candidate) => candidate.id !== item.id,
        );
        const clearedFinalSnack = isSnack && items.length === 0;
        return {
          ...checkin,
          status: clearedFinalSnack ? "not_marked" as const : checkin.status,
          skipReason: clearedFinalSnack ? null : checkin.skipReason,
          items,
        };
      });
      setCheckins(localResult);
      setAnnouncement(announceRemoval(localResult));
    } catch (error) {
      let reportedError = error;
      if (!demoMode && !mutationConfirmed && !mutationRejected) {
        try {
          const refreshed = await refreshDayCheckins(localDay);
          if (itemWasRemoved(refreshed)) {
            setOperationError(null);
            setAnnouncement(
              `${announceRemoval(refreshed)} Today was refreshed after the earlier response could not be confirmed.`,
            );
            return;
          }
        } catch (refreshError) {
          reportedError = refreshError;
        }
      }
      const publicError = apiErrorFromThrown(reportedError, fallback);
      setOperationError(publicError);
      setAnnouncement(
        mutationConfirmed
          ? `${item.name} may have been removed, but the latest day could not be confirmed. Refresh Today before another change.`
          : `${item.name} could not be confirmed as removed. Refresh Today before trying again.`,
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="page-frame">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <header className="page-header">
        <div>
          <span className="date-label">
            {demoMode ? "Mock data — development only · " : ""}
            {localDate}
          </span>
          <h1>Good morning, {name}.</h1>
          <p>Here&apos;s the plan for today—use what&apos;s helpful.</p>
        </div>
        <Link className="button button-quiet" href="/progress">
          <Scale size={17} aria-hidden="true" /> Add today&apos;s weight
        </Link>
      </header>

      {operationError ? (
        <ApiErrorNotice
          error={operationError}
          heading="We could not complete that action"
        />
      ) : null}

      <div className="today-grid">
        <section className="today-primary" aria-label="Today's meals and status">
          <article className="day-status-card">
            <div>
              <span className="source-label ai">
                <Sparkles size={14} aria-hidden="true" /> {providerLabel}
              </span>
              <h2>{mainSummary.marked === 3 ? "Today is fully marked." : "You’re building today’s rhythm."}</h2>
              <p>
                {mainSummary.marked} of 3 planned meals marked
                {mainSummary.skipped
                  ? ` · ${mainSummary.skipped} skipped`
                  : ""}
                {snackItemCount
                  ? ` · ${snackItemCount} snack ${snackItemCount === 1 ? "item" : "items"} recorded`
                  : ""}. A
                meal can always be returned to not marked.
              </p>
            </div>
            <div className="status-ring" aria-label={`${mainSummary.marked} of 3 planned meals marked`}>
              <span>{mainSummary.marked}/3</span>
            </div>
          </article>

          <article className="card">
            <div className="card-title">
              <div>
                <h2>Today&apos;s meals</h2>
                <p>
                  Record what you ate here. Planning preferences stay separate
                  in Settings.
                </p>
              </div>
              <div className="meal-card-header-actions">
                <span className="source-label">
                  <Utensils size={14} aria-hidden="true" /> Plan and daily log
                </span>
                <Link
                  className="button button-quiet"
                  href="/settings#preferences"
                >
                  <Pencil size={15} aria-hidden="true" /> Edit meal preferences
                </Link>
              </div>
            </div>
            <div className="meal-list">
              {meals.map(({ key, label, detail, Icon }) => (
                <div className="meal-row" key={key}>
                  <span className="meal-icon" aria-hidden="true"><Icon size={20} /></span>
                  <div style={{ flex: "1 1 14rem" }}>
                    <span>{label}</span>
                    <span className="meal-detail-label">
                      {isPrimaryMealType(key)
                        ? "Plan for today"
                        : "Optional snack space"}
                    </span>
                    <strong className="meal-plan-detail">{detail}</strong>
                    {checkinFor(key).items.length ? (
                      <div className="recorded-meal-foods">
                        <span>Recorded today</span>
                        <ul aria-label={`${label} recorded foods`}>
                          {checkinFor(key).items.map((item) => (
                            <li key={item.id}>
                              {item.name}{" "}
                              <button
                                aria-label={`Remove ${item.name} from ${label}`}
                                className="text-link"
                                disabled={saving !== null}
                                onClick={() => void removeFood(key, item)}
                                type="button"
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {checkinFor(key).status === "skipped" ? (
                      <small>
                        Skipped
                        {checkinFor(key).skipReason
                          ? ` · ${checkinFor(key).skipReason}`
                          : " · no reason provided"}
                      </small>
                    ) : null}
                    {checkinFor(key).items.length > 0 ? (
                      <small id={`skip-help-${key}`}>
                        Remove recorded foods before marking this slot skipped.
                      </small>
                    ) : null}
                  </div>
                  <div className="meal-actions">
                    <button
                      className={`check-button ${checkinFor(key).status === "completed" ? "complete" : ""}`}
                      type="button"
                      aria-label={
                        checkinFor(key).status === "completed"
                          ? `Return ${label} to not marked`
                          : `Mark ${label} completed`
                      }
                      aria-pressed={checkinFor(key).status === "completed"}
                      disabled={saving !== null}
                      onClick={() =>
                        void updateMeal(
                          key,
                          checkinFor(key).status === "completed"
                            ? "not_marked"
                            : "completed",
                        )
                      }
                    >
                      <span className="check-button-icon" aria-hidden="true">
                        {checkinFor(key).status === "completed" ? (
                          <Check size={15} />
                        ) : (
                          <Circle size={13} />
                        )}
                      </span>
                      <span className="check-button-label">
                        {saving === key
                          ? "Saving…"
                          : checkinFor(key).status === "completed"
                            ? "Done"
                            : "Mark done"}
                      </span>
                    </button>
                    <button
                      className="button button-quiet"
                      aria-controls={`skip-editor-${key}`}
                      aria-expanded={skipEditor === key}
                      aria-label={
                        checkinFor(key).status === "skipped"
                          ? `Return ${label} to not marked`
                          : `Skip ${label}`
                      }
                      aria-describedby={
                        checkinFor(key).items.length > 0
                          ? `skip-help-${key}`
                          : undefined
                      }
                      disabled={
                        saving !== null ||
                        (checkinFor(key).status !== "skipped" &&
                          checkinFor(key).items.length > 0)
                      }
                      onClick={() => {
                        if (checkinFor(key).status === "skipped") {
                          void updateMeal(key, "not_marked");
                        } else {
                          openSkipEditor(key);
                        }
                      }}
                      ref={(element) => {
                        skipOpenerRefs.current[key] = element;
                      }}
                      type="button"
                    >
                      {checkinFor(key).status === "skipped" ? "Return to not marked" : "Skip"}
                    </button>
                    <button
                      className="button button-quiet"
                      aria-controls={`food-editor-${key}`}
                      aria-expanded={foodEditor === key}
                      aria-label={
                        checkinFor(key).items.length
                          ? `Manage recorded foods for ${label}`
                          : `Record food for ${label}`
                      }
                      disabled={saving !== null}
                      onClick={() => openFoodPicker(key)}
                      ref={(element) => {
                        foodOpenerRefs.current[key] = element;
                      }}
                      type="button"
                    >
                      {checkinFor(key).items.length ? (
                        <Pencil size={15} aria-hidden="true" />
                      ) : (
                        <Plus size={15} aria-hidden="true" />
                      )}
                      {checkinFor(key).items.length
                        ? "Manage recorded foods"
                        : "Record food"}
                    </button>
                  </div>
                  {skipEditor === key ? (
                    <div
                      className="meal-inline-editor"
                      id={`skip-editor-${key}`}
                    >
                      <label className="field">
                        <span className="field-label">Optional reason for skipping {label.toLowerCase()}</span>
                        <input
                          maxLength={500}
                          onChange={(event) => setSkipReason(event.target.value)}
                          placeholder="You can leave this blank"
                          ref={skipReasonInputRef}
                          value={skipReason}
                        />
                      </label>
                      <div className="header-actions">
                        <button
                          className="button button-dark"
                          disabled={
                            saving !== null ||
                            checkinFor(key).items.length > 0
                          }
                          onClick={() => void updateMeal(key, "skipped", skipReason.trim() || null)}
                          type="button"
                        >
                          Save skipped status
                        </button>
                        <button
                          className="button button-quiet"
                          onClick={() => closeSkipEditor()}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {foodEditor === key ? (
                    <div
                      className="meal-inline-editor"
                      id={`food-editor-${key}`}
                    >
                      <form onSubmit={searchFoods}>
                        <label className="field">
                          <span className="field-label">Find food to record for {label.toLowerCase()}</span>
                          <input
                            onChange={(event) => setFoodSearch(event.target.value)}
                            placeholder="Search the catalog"
                            ref={foodSearchInputRef}
                            value={foodSearch}
                          />
                        </label>
                        <div className="header-actions">
                          <button className="button button-dark" disabled={catalogLoading} type="submit">
                            {catalogLoading ? "Searching…" : "Search"}
                          </button>
                          <button
                            className="button button-quiet"
                            onClick={() => closeFoodPicker()}
                            type="button"
                          >
                            <X size={15} aria-hidden="true" /> Close
                          </button>
                        </div>
                      </form>
                      <p className="field-help">
                        Recording a food marks this slot completed. You can change
                        the completion status afterward.
                      </p>
                      {catalogFoods.length ? (
                        <ul
                          aria-label="Food search results"
                          className="snack-food-results"
                        >
                          {catalogFoods.slice(0, 12).map((food) => (
                            <li className="snack-food-result" key={food.id}>
                              <div className="snack-food-result-copy">
                                <strong>{food.english_name}</strong>
                                {food.brand_name || food.variant_name ? (
                                  <p className="field-help">
                                    {[food.brand_name, food.variant_name]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                ) : null}
                                <small className="source-label">
                                  {food.catalog_status === "pending_review"
                                    ? "Pending catalog review"
                                    : food.verification_status.replaceAll(
                                        "_",
                                        " ",
                                      )}
                                </small>
                                <NutritionFactsCard
                                  compact
                                  nutrition={food.nutrition ?? null}
                                  source={food.source}
                                />
                                {food.plan_eligible === false ||
                                food.catalog_status === "pending_review" ? (
                                  <p className="field-help">
                                    Reference food — available for daily logging,
                                    but not for generated plans until reviewed.
                                  </p>
                                ) : null}
                              </div>
                              <button
                                aria-label={`Add ${food.english_name} to ${label}`}
                                className="button button-quiet"
                                disabled={saving !== null}
                                onClick={() => void addFood(key, food)}
                                type="button"
                              >
                                Add
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : !catalogLoading ? (
                        <p className="field-help">No matching foods are available.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="card-title">
              <div>
                <h2>Seven-day weight trend</h2>
                <p>Daily readings and a simple direction—not a judgment.</p>
              </div>
              <span className="source-label">
                <Dumbbell size={14} aria-hidden="true" /> Calculated by the app
              </span>
            </div>
            <div
              className="chart-wrap"
              role="img"
              aria-label={`${weightPoints.length} recent weight readings are shown with missing dates left as gaps.`}
            >
              <LazyWeightTrendChart data={weightPoints} kind="today" />
            </div>
            <p className="chart-alt">
              {weightPoints.length
                ? `${weightPoints.length} recent readings are available. Day-to-day changes can reflect many factors.`
                : "No weight readings are available yet. Missing days remain empty."}
            </p>
          </article>
        </section>

        <aside className="today-side" aria-label="Today summary">
          {energyRange || proteinRange ? <article className="card">
            <div className="card-title">
              <div>
                <h2>Plan range</h2>
                <p>Transparent daily estimates</p>
              </div>
            </div>
            <div className="metric-grid">
              <div className="metric"><span>Energy</span><strong>{energyRange ? `${energyRange.minimum.toLocaleString()}–${energyRange.maximum.toLocaleString()}` : "Insufficient data"}</strong><small>kcal</small></div>
              <div className="metric"><span>Protein</span><strong>{proteinRange ? `${proteinRange.minimum}–${proteinRange.maximum}` : "Insufficient data"}</strong><small>grams</small></div>
            </div>
            <p className="chart-alt">Calculated by the app · Estimator v1 · Individual needs vary.</p>
          </article> : null}

          <article className="card">
            <div className="card-title">
              <div>
                <h2>This week</h2>
                <p>Monday through today</p>
              </div>
            </div>
            <div className="metric-grid">
              <div className="metric"><span>Meals marked</span><strong>{weeklyMarked} / {weeklyPossible}</strong></div>
              <div className="metric"><span>Check-ins recorded</span><strong>{weeklyPossible ? Math.round((weeklyMarked / weeklyPossible) * 100) : 0}%</strong></div>
              <div className="metric"><span>Skipped</span><strong>{weeklySkipped}</strong></div>
            </div>
            <p className="chart-alt">Calculated by the app from your check-ins.</p>
          </article>

          {goalContext ? <article className="card">
            <div className="card-title">
              <div>
                <h2>Goal context</h2>
                <p>{goalContext.type.replaceAll("_", " ")} goal · target {goalContext.targetDate}</p>
              </div>
            </div>
            <div className="metric-grid">
              <div className="metric"><span>Current</span><strong>{goalContext.currentKg === null ? "Unavailable" : `${goalContext.currentKg.toFixed(1)} kg`}</strong></div>
              <div className="metric"><span>Target</span><strong>{goalContext.targetKg.toFixed(1)} kg</strong></div>
              <div className="metric"><span>Change so far</span><strong>{goalContext.currentKg === null || goalContext.startKg === null ? "Insufficient data" : `${Math.abs(goalContext.currentKg - goalContext.startKg).toFixed(1)} kg`}</strong></div>
              <div className="metric"><span>Time remaining</span><strong>{goalContext.remainingDays} days</strong></div>
            </div>
            <Link className="button button-quiet form-submit" href="/progress">
              View progress <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </article>
          : null}
        </aside>
      </div>
    </div>
  );
}
