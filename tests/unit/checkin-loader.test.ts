import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  loadCheckinRange,
  loadDayMealCheckins,
} from "../../src/lib/checkin-loader";

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["eq", "gte", "in", "lte", "order", "select"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (
    onFulfilled: (value: typeof result) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

describe("check-in loaders", () => {
  it("groups a calendar range without repeatedly scanning every meal row", async () => {
    const client = {
      from: vi.fn((table: string) =>
        table === "daily_checkins"
          ? query({
              data: [
                { local_date: "2026-08-01", notes: "First" },
                { local_date: "2026-08-02", notes: null },
              ],
              error: null,
            })
          : query({
              data: [
                {
                  local_date: "2026-08-02",
                  meal_type: "lunch",
                  status: "skipped",
                  skip_reason: "Travel",
                },
              ],
              error: null,
            }),
      ),
    };

    const result = await loadCheckinRange(
      client as never,
      "user-1",
      "2026-08-01",
      "2026-08-31",
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data[1]).toMatchObject({
      localDate: "2026-08-02",
      notes: null,
      slots: expect.arrayContaining([
        {
          mealType: "lunch",
          status: "skipped",
          skipReason: "Travel",
        },
      ]),
    });
  });

  it("assembles recorded foods onto the correct day meal", async () => {
    const client = {
      from: vi.fn(() =>
        query({
          data: [
            {
              id: "meal-1",
              meal_type: "breakfast",
              status: "completed",
              skip_reason: null,
              items: [
                {
                  id: "item-2",
                  sort_order: 2,
                  food: {
                    id: "food-2",
                    english_name: "Berries",
                    verification_status: "verified",
                  },
                },
                {
                  id: "item-1",
                  sort_order: 1,
                  food: {
                    id: "food-1",
                    english_name: "Oats",
                    verification_status: "verified",
                  },
                },
              ],
            },
          ],
          error: null,
        }),
      ),
    };

    const result = await loadDayMealCheckins(
      client as never,
      "user-1",
      "2026-08-01",
    );

    expect(result.error).toBeNull();
    expect(
      result.data.find((meal) => meal.mealType === "breakfast"),
    ).toMatchObject({
      status: "completed",
      items: [
        {
          id: "item-1",
          foodId: "food-1",
          name: "Oats",
          verificationStatus: "verified",
        },
        {
          id: "item-2",
          foodId: "food-2",
          name: "Berries",
          verificationStatus: "verified",
        },
      ],
    });
    expect(client.from).toHaveBeenCalledOnce();
    expect(client.from).toHaveBeenCalledWith("daily_meal_checkins");
  });

  it("returns a nested day-query error without starting another read", async () => {
    const databaseError = { code: "08006" };
    const client = {
      from: vi.fn(() => query({ data: null, error: databaseError })),
    };

    const result = await loadDayMealCheckins(
      client as never,
      "user-1",
      "2026-08-01",
    );

    expect(result).toEqual({ data: [], error: databaseError });
    expect(client.from).toHaveBeenCalledOnce();
  });
});
