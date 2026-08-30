import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  data: unknown;
  error: unknown;
};

const pageState = vi.hoisted(() => ({
  from: vi.fn(),
  planView: vi.fn(() => null),
  planLoadError: vi.fn(() => null),
  selects: [] as Array<{ table: string; columns: string }>,
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: pageState.from }),
  getCurrentUser: async () => ({ id: "user-1" }),
}));

vi.mock("@/components/plan-view", () => ({
  PlanLoadError: pageState.planLoadError,
  PlanView: pageState.planView,
}));

import PlanPage from "../../app/(app)/plan/page";

function query(table: string, result: QueryResult) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn((columns: string) => {
    pageState.selects.push({ table, columns });
    return builder;
  });
  for (const method of ["eq", "limit", "order"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

function planGraph() {
  const mealTypes = ["breakfast", "lunch", "dinner"] as const;
  return Array.from({ length: 7 }, (_, dayOffset) => {
    const dayIndex = dayOffset + 1;
    const dayId = `day-${dayIndex}`;
    return {
      id: dayId,
      plan_id: "plan-1",
      day_index: dayIndex,
      title: `Day ${dayIndex}`,
      plan_meals: mealTypes.map((mealType, mealIndex) => {
        const mealId = `${dayId}-${mealType}`;
        return {
          id: mealId,
          meal_type: mealType,
          plan_day_id: dayId,
          sort_order: mealIndex,
          plan_items: [
            {
              id: `${mealId}-item`,
              food_id: "food-1",
              measurement_basis: "cooked",
              plan_meal_id: mealId,
              preparation_note: null,
              quantity: 100,
              sort_order: 0,
              substitution_group: null,
              unit: "g",
              verification_status: "verified",
              food: { id: "food-1", english_name: "Test food" },
              nutrition: {
                calories: 100,
                carbohydrate_g: 10,
                fat_g: 2,
                fiber_g: 1,
                food_id: "food-1",
                measurement_basis: "cooked",
                protein_g: 8,
                reference_quantity: 100,
                reference_unit: "g",
                sodium_mg: 20,
                source_name: "Test source",
                source_reference: null,
                verification_status: "verified",
              },
            },
          ],
        };
      }),
    };
  });
}

describe("Plan page query shape", () => {
  beforeEach(() => {
    pageState.from.mockReset();
    pageState.planView.mockClear();
    pageState.planLoadError.mockClear();
    pageState.selects.length = 0;
    let planQueryCount = 0;
    pageState.from.mockImplementation((table: string) => {
      if (table === "plans") {
        planQueryCount += 1;
        return query(
          table,
          planQueryCount === 1
            ? {
                data: [
                  {
                    id: "plan-1",
                    accepted_at: "2026-08-20T12:00:00.000Z",
                    created_at: "2026-08-19T12:00:00.000Z",
                    goal_id: "goal-1",
                    status: "accepted",
                    version: 1,
                  },
                ],
                error: null,
              }
            : {
                data: {
                  id: "plan-1",
                  accepted_at: "2026-08-20T12:00:00.000Z",
                  created_at: "2026-08-19T12:00:00.000Z",
                  goal_id: "goal-1",
                  input_snapshot: {},
                  model: "mock-plan-v1",
                  provider: "mock",
                  status: "accepted",
                  validated_output_snapshot: {},
                  version: 1,
                },
                error: null,
              },
        );
      }
      if (table === "plan_days") {
        return query(table, { data: planGraph(), error: null });
      }
      if (table === "goals") {
        return query(table, {
          data: { id: "goal-1", target_weight_kg: 75 },
          error: null,
        });
      }
      if (table === "weight_entries") {
        return query(table, { data: { weight_kg: 80 }, error: null });
      }
      throw new Error(`Unexpected Plan-page table: ${table}`);
    });
  });

  it("loads lightweight history and one nested selected-plan graph", async () => {
    const element = await PlanPage({ searchParams: Promise.resolve({}) });

    expect(element.type).toBe(pageState.planView);
    expect(element.props.days).toHaveLength(7);
    expect(element.props.history).toHaveLength(1);
    expect(pageState.from.mock.calls.map(([table]) => table)).toEqual([
      "plans",
      "plans",
      "plan_days",
      "goals",
      "weight_entries",
    ]);

    const planSelects = pageState.selects.filter(
      ({ table }) => table === "plans",
    );
    expect(planSelects).toHaveLength(2);
    expect(planSelects[0]?.columns).not.toContain("input_snapshot");
    expect(planSelects[0]?.columns).not.toContain(
      "validated_output_snapshot",
    );
    expect(planSelects[1]?.columns).toContain("input_snapshot");

    const graphSelect = pageState.selects.find(
      ({ table }) => table === "plan_days",
    )?.columns;
    expect(graphSelect).toContain("plan_meals");
    expect(graphSelect).toContain("plan_items");
    expect(graphSelect).toContain("nutrition:food_nutrition");
    expect(graphSelect).not.toContain("serving_weight_grams");
    expect(graphSelect).not.toContain("source_version");
  });
});
