import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type QueryResult = {
  count?: number | null;
  data: unknown;
  error: unknown;
};

const pageState = vi.hoisted(() => ({
  acceptedPlan: false,
  aggressiveGoal: false,
  dailyMealResult: null as Promise<QueryResult> | null,
  dailyMealQueryCount: 0,
  from: vi.fn(),
  planDayError: false,
  weightQueryCount: 0,
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: pageState.from }),
  getCurrentProfile: async () => ({
    data: {
      activity_level: "sedentary",
      age: 34,
      date_of_birth: null,
      full_name: "Long History",
      gender: "prefer_not_to_say",
      height_cm: 170,
      safety_context: null,
      time_zone: "UTC",
    },
    error: null,
  }),
  getCurrentUser: async () => ({ id: "user-1" }),
}));

vi.mock("@/components/today-dashboard", () => ({
  TodayDashboard: () => null,
}));

import TodayPage from "../../app/(app)/today/page";

function query(result: QueryResult | Promise<QueryResult>) {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "eq",
    "gte",
    "in",
    "limit",
    "lte",
    "order",
    "select",
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

describe("Today page weight context", () => {
  beforeEach(() => {
    pageState.acceptedPlan = false;
    pageState.aggressiveGoal = false;
    pageState.dailyMealResult = null;
    pageState.dailyMealQueryCount = 0;
    pageState.weightQueryCount = 0;
    pageState.from.mockReset();
    pageState.planDayError = false;

    const recentWeights = Array.from({ length: 30 }, (_, index) => ({
      local_date: new Date(Date.UTC(2026, 7, 28 - index))
        .toISOString()
        .slice(0, 10),
      weight_kg: 80 + index / 10,
    }));

    pageState.from.mockImplementation((table: string) => {
      if (table === "goals") {
        return query({
          data: pageState.aggressiveGoal
            ? {
                goal_type: "fat_loss",
                plan_start_date: "2026-08-01",
                target_date: "2026-09-01",
                target_weight_kg: 70,
              }
            : {
                goal_type: "maintenance",
                plan_start_date: "2026-08-01",
                target_date: "2026-12-31",
                target_weight_kg: 80,
              },
          error: null,
        });
      }
      if (table === "weight_entries") {
        pageState.weightQueryCount += 1;
        return pageState.weightQueryCount === 1
          ? query({ data: recentWeights, error: null })
          : query({
              data: { weight_kg: pageState.aggressiveGoal ? 80 : 95 },
              error: null,
            });
      }
      if (table === "plans") {
        return query({
          data: pageState.acceptedPlan
            ? { id: "plan-1", provider: "mock", model: "mock-v1" }
            : null,
          error: null,
        });
      }
      if (table === "plan_days") {
        return query({
          data: {
            plan_meals: [
              {
                id: "meal-1",
                meal_type: "breakfast",
                sort_order: 1,
                plan_items: [
                  {
                    sort_order: 2,
                    food: { english_name: "Berries" },
                  },
                  {
                    sort_order: 1,
                    food: { english_name: "Oats" },
                  },
                ],
              },
              {
                id: "meal-2",
                meal_type: "lunch",
                sort_order: 2,
                plan_items: [],
              },
            ],
          },
          error: pageState.planDayError ? { code: "08006" } : null,
        });
      }
      if (table === "daily_meal_checkins") {
        pageState.dailyMealQueryCount += 1;
        return query(
          pageState.dailyMealResult ?? { data: [], error: null },
        );
      }
      throw new Error(`Unexpected Today-page table: ${table}`);
    });
  });

  it("keeps the onboarding baseline after more than 30 newer readings", async () => {
    const element = await TodayPage();

    expect(pageState.weightQueryCount).toBe(2);
    expect(element.props.goalContext).toMatchObject({
      currentKg: 80,
      startKg: 95,
      targetKg: 80,
    });
    expect(element.props.energyRange).toBeNull();
    expect(element.props.weightPoints).toHaveLength(7);
    expect(
      element.props.weightPoints.every(
        (point: { weight: number }) => point.weight !== 95,
      ),
    ).toBe(true);
  });

  it("withholds a goal-adjusted energy range for an aggressive timeline", async () => {
    pageState.aggressiveGoal = true;

    const element = await TodayPage();

    expect(element.props.energyRange).toBeNull();
    expect(element.props.proteinRange).not.toBeNull();
  });

  it("loads nested plan details while independent day queries are pending", async () => {
    let resolveDailyMeals!: (result: QueryResult) => void;
    pageState.dailyMealResult = new Promise<QueryResult>((resolve) => {
      resolveDailyMeals = resolve;
    });
    pageState.acceptedPlan = true;

    const pagePromise = TodayPage();
    await vi.waitFor(() =>
      expect(pageState.from).toHaveBeenCalledWith("plan_days"),
    );

    expect(pageState.dailyMealQueryCount).toBe(2);
    expect(pageState.from).not.toHaveBeenCalledWith("plan_meals");
    expect(pageState.from).not.toHaveBeenCalledWith("plan_items");
    resolveDailyMeals({ data: [], error: null });

    const element = await pagePromise;
    expect(element.props.mealDetails).toEqual({
      breakfast: "Oats, Berries",
      lunch: "No items in this meal.",
    });
  });

  it("preserves the safe page error when nested plan details fail", async () => {
    pageState.acceptedPlan = true;
    pageState.planDayError = true;

    const element = await TodayPage();

    expect(element.props).toMatchObject({
      title: "Today could not be loaded.",
      retryHref: "/today",
    });
  });
});
