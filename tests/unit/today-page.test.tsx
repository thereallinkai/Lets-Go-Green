import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  count?: number | null;
  data: unknown;
  error: unknown;
};

const pageState = vi.hoisted(() => ({
  dailyMealQueryCount: 0,
  from: vi.fn(),
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

function query(result: QueryResult) {
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
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  builder.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

describe("Today page weight context", () => {
  beforeEach(() => {
    pageState.dailyMealQueryCount = 0;
    pageState.weightQueryCount = 0;
    pageState.from.mockReset();

    const recentWeights = Array.from({ length: 30 }, (_, index) => ({
      local_date: new Date(Date.UTC(2026, 7, 28 - index))
        .toISOString()
        .slice(0, 10),
      weight_kg: 80 + index / 10,
    }));

    pageState.from.mockImplementation((table: string) => {
      if (table === "goals") {
        return query({
          data: {
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
          : query({ data: { weight_kg: 95 }, error: null });
      }
      if (table === "plans") {
        return query({ data: null, error: null });
      }
      if (table === "daily_meal_checkins") {
        pageState.dailyMealQueryCount += 1;
        return query({ data: [], error: null });
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
    expect(element.props.weightPoints).toHaveLength(7);
    expect(
      element.props.weightPoints.every(
        (point: { weight: number }) => point.weight !== 95,
      ),
    ).toBe(true);
  });
});
