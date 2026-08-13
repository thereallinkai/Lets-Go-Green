"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Circle,
  Coffee,
  Cookie,
  Dumbbell,
  MoonStar,
  Plus,
  Scale,
  Sparkles,
  Sun,
  Utensils,
  X,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromResponse,
  apiErrorFromThrown,
  clientApiError,
} from "@/src/lib/client-api-error";
import {
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  SNACK_MEAL_TYPES,
  isPrimaryMealType,
  localDateInTimeZone,
  normalizeMealSlotCheckins,
  summarizeMealCheckins,
  type MealCheckinStatus,
  type MealSlot,
  type MealSlotCheckin,
  type PrimaryMealType,
} from "@/src/lib/domain";
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
  demoMode?: boolean;
}) {
  const fallbackCheckins: TodayMealCheckin[] = normalizeMealSlotCheckins(
    MEAL_SLOTS.map((mealType) => ({
      mealType,
      status:
        isPrimaryMealType(mealType) && initialCompleted[mealType]
          ? "completed"
          : "not_marked",
      skipReason: null,
    })),
  ).map((checkin) => ({ ...checkin, items: [] }));
  const [checkins, setCheckins] = useState<TodayMealCheckin[]>(
    initialCheckins ?? fallbackCheckins,
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
  const mainSummary = summarizeMealCheckins(checkins);
  const snackCount = checkins.filter(
    (checkin) =>
      SNACK_MEAL_TYPES.includes(
        checkin.mealType as (typeof SNACK_MEAL_TYPES)[number],
      ) &&
      (checkin.status === "completed" || checkin.items.length > 0),
  ).length;
  const localDate = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    [timeZone],
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

  function checkinFor(mealType: MealSlot) {
    return checkins.find((checkin) => checkin.mealType === mealType)!;
  }

  async function updateMeal(
    meal: MealSlot,
    status: MealCheckinStatus,
    reason: string | null = null,
  ) {
    if (saving) return;
    if (
      status === "skipped" &&
      checkinFor(meal).items.length > 0
    ) {
      setSkipEditor(null);
      setSkipReason("");
      setAnnouncement(
        "Remove recorded foods before marking this slot skipped.",
      );
      return;
    }
    const previous = checkins;
    const fallback = clientApiError(
      "CHECKIN_SAVE_UNAVAILABLE",
      "The meal status could not be saved.",
      "Your previous status was restored. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try again" } },
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
    try {
      const localDay = localDateInTimeZone(new Date(), timeZone);
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
        throw await apiErrorFromResponse(response, fallback);
      }
      setSkipEditor(null);
      setSkipReason("");
      setAnnouncement(
        `${label} is now ${status.replace("_", " ")}.`,
      );
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      setCheckins(previous);
      setOperationError(publicError);
      setAnnouncement(
        `We could not save ${label}. Your previous status was restored.`,
      );
    } finally {
      setSaving(null);
    }
  }

  async function loadFoods(query = "") {
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
      );
      if (!response.ok) {
        throw await apiErrorFromResponse(response, fallback);
      }
      const result = (await response.json()) as { data?: CatalogFood[] };
      setCatalogFoods(result.data ?? []);
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      setCatalogFoods([]);
      setOperationError(publicError);
      setAnnouncement("The food catalog could not be loaded. Please try again.");
    } finally {
      setCatalogLoading(false);
    }
  }

  function openFoodPicker(mealType: MealSlot) {
    setFoodEditor(mealType);
    setFoodSearch("");
    void loadFoods();
  }

  function searchFoods(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadFoods(foodSearch);
  }

  async function addFood(mealType: MealSlot, food: CatalogFood) {
    if (saving) return;
    setSaving(mealType);
    setOperationError(null);
    const fallback = clientApiError(
      "MEAL_ITEM_SAVE_UNAVAILABLE",
      `${food.english_name} could not be added.`,
      "No food record was changed. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try adding again" } },
    );
    const localDay = localDateInTimeZone(new Date(), timeZone);
    try {
      const response = await fetch(`/api/checkins/${localDay}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mealType, foodId: food.id }),
      });
      if (!response.ok) {
        throw await apiErrorFromResponse(response, fallback);
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
      const itemId = result.data?.id ?? `${mealType}-${food.id}`;
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
      setFoodEditor(null);
      setSkipEditor(null);
      setSkipReason("");
      setAnnouncement(
        `${food.english_name} was added to ${MEAL_SLOT_LABELS[mealType]}.`,
      );
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      setOperationError(publicError);
      setAnnouncement(
        `${food.english_name} could not be added. No food record was changed.`,
      );
    } finally {
      setSaving(null);
    }
  }

  async function removeFood(mealType: MealSlot, item: TodayMealItem) {
    if (saving) return;
    setSaving(mealType);
    setOperationError(null);
    const fallback = clientApiError(
      "MEAL_ITEM_DELETE_UNAVAILABLE",
      `${item.name} could not be removed.`,
      "The food record remains. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try removing again" } },
    );
    const localDay = localDateInTimeZone(new Date(), timeZone);
    const currentMeal = checkinFor(mealType);
    const isFinalRecordedSnack =
      SNACK_MEAL_TYPES.includes(
        mealType as (typeof SNACK_MEAL_TYPES)[number],
      ) &&
      currentMeal.status === "completed" &&
      currentMeal.items.length === 1 &&
      currentMeal.items[0]?.id === item.id;
    try {
      const response = await fetch(
        `/api/checkins/${localDay}/items/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw await apiErrorFromResponse(response, fallback);
      }

      setCheckins((current) =>
        current.map((checkin) =>
          checkin.mealType === mealType
            ? {
                ...checkin,
                status:
                  isFinalRecordedSnack ? "not_marked" : checkin.status,
                skipReason:
                  isFinalRecordedSnack ? null : checkin.skipReason,
                items: checkin.items.filter(
                  (candidate) => candidate.id !== item.id,
                ),
              }
            : checkin,
        ),
      );
      setAnnouncement(
        `${item.name} was removed from ${MEAL_SLOT_LABELS[mealType]}.${
          isFinalRecordedSnack ? " The empty snack is now not marked." : ""
        }`,
      );
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      setOperationError(publicError);
      setAnnouncement(
        `${item.name} could not be removed. The food record remains.`,
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
                {snackCount ? ` · ${snackCount} snacks recorded` : ""}. A
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
                <p>Record meals, optional snacks, or a neutral skipped status.</p>
              </div>
              <span className="source-label"><Utensils size={14} /> Provided by you</span>
            </div>
            <div className="meal-list">
              {meals.map(({ key, label, detail, Icon }) => (
                <div className="meal-row" key={key} style={{ flexWrap: "wrap" }}>
                  <span className="meal-icon" aria-hidden="true"><Icon size={20} /></span>
                  <div style={{ flex: "1 1 14rem" }}>
                    <span>{label}</span>
                    <strong>{detail}</strong>
                    {checkinFor(key).items.length ? (
                      <ul aria-label={`${label} recorded foods`} style={{ margin: ".45rem 0 0", paddingLeft: "1.2rem" }}>
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
                      {checkinFor(key).status === "completed" ? <Check size={16} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
                      {saving === key ? "Saving…" : checkinFor(key).status === "completed" ? "Completed" : "Mark completed"}
                    </button>
                    <button
                      className="button button-quiet"
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
                          setSkipEditor(key);
                          setSkipReason("");
                        }
                      }}
                      type="button"
                    >
                      {checkinFor(key).status === "skipped" ? "Return to not marked" : "Skip"}
                    </button>
                    {!isPrimaryMealType(key) ? (
                      <button
                        className="button button-quiet"
                        disabled={saving !== null}
                        onClick={() => openFoodPicker(key)}
                        type="button"
                      >
                        <Plus size={15} aria-hidden="true" /> Add food
                      </button>
                    ) : null}
                  </div>
                  {skipEditor === key ? (
                    <div className="meal-inline-editor">
                      <label className="field">
                        <span className="field-label">Optional reason for skipping {label.toLowerCase()}</span>
                        <input
                          maxLength={500}
                          onChange={(event) => setSkipReason(event.target.value)}
                          placeholder="You can leave this blank"
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
                          onClick={() => setSkipEditor(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {foodEditor === key ? (
                    <div className="meal-inline-editor">
                      <form onSubmit={searchFoods}>
                        <label className="field">
                          <span className="field-label">Find food for {label.toLowerCase()}</span>
                          <input
                            onChange={(event) => setFoodSearch(event.target.value)}
                            placeholder="Search the catalog"
                            value={foodSearch}
                          />
                        </label>
                        <div className="header-actions">
                          <button className="button button-dark" disabled={catalogLoading} type="submit">
                            {catalogLoading ? "Searching…" : "Search"}
                          </button>
                          <button className="button button-quiet" onClick={() => setFoodEditor(null)} type="button">
                            <X size={15} aria-hidden="true" /> Close
                          </button>
                        </div>
                      </form>
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
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weightPoints} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#e3dfd5" vertical={false} />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} fontSize={11} />
                  <YAxis domain={["dataMin - 1", "dataMax + 1"]} axisLine={false} tickLine={false} fontSize={11} />
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(1)} kg`, "Weight"]}
                    contentStyle={{ borderRadius: 10, borderColor: "#d9d4c8", fontSize: 12 }}
                  />
                  {weightPoints.length ? <ReferenceLine y={weightPoints.at(-1)?.weight} stroke="#aeb7ad" strokeDasharray="4 4" /> : null}
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke="#647632"
                    strokeWidth={2.5}
                    dot={{ fill: "#647632", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
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
