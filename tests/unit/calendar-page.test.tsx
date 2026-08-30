import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type QueryResult = {
  data: unknown;
  error: unknown;
};

const pageState = vi.hoisted(() => ({
  errors: new Map<string, unknown>(),
  from: vi.fn(),
  pageLoadError: vi.fn(() => null),
}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: pageState.from }),
  getCurrentProfile: async () => ({
    data: { time_zone: "UTC" },
    error: pageState.errors.get("profile") ?? null,
  }),
  getCurrentUser: async () => ({ id: "user-1" }),
}));

vi.mock("@/components/calendar-view", () => ({
  CalendarView: vi.fn(() => null),
}));

vi.mock("@/components/page-load-error", () => ({
  PageLoadError: pageState.pageLoadError,
}));

import CalendarPage from "../../app/(app)/calendar/page";

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["eq", "gte", "lte", "order", "select"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

describe("Calendar page load failures", () => {
  beforeEach(() => {
    pageState.errors.clear();
    pageState.from.mockReset();
    pageState.from.mockImplementation((table: string) =>
      query({
        data: [],
        error: pageState.errors.get(table) ?? null,
      }),
    );
  });

  it.each(["profile", "daily_checkins", "daily_meal_checkins"])(
    "shows a load error when the %s query fails",
    async (queryFamily) => {
      pageState.errors.set(queryFamily, { message: "unavailable" });

      const element = await CalendarPage();

      expect(element.type).toBe(pageState.pageLoadError);
      expect(element.props).toMatchObject({
        retryHref: "/calendar",
        retryLabel: "Reload Calendar",
        title: "Your calendar could not be loaded.",
      });
    },
  );
});
