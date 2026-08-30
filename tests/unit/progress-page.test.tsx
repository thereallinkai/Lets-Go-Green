import { beforeEach, describe, expect, it, vi } from "vitest";

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
    data: { preferred_weight_unit: "kg", time_zone: "UTC" },
    error: pageState.errors.get("profile") ?? null,
  }),
  getCurrentUser: async () => ({ id: "user-1" }),
}));

vi.mock("@/components/progress-view", () => ({
  ProgressView: vi.fn(() => null),
}));

vi.mock("@/components/page-load-error", () => ({
  PageLoadError: pageState.pageLoadError,
}));

import ProgressPage from "../../app/(app)/progress/page";

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["eq", "order", "select"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

describe("Progress page load failures", () => {
  beforeEach(() => {
    pageState.errors.clear();
    pageState.from.mockReset();
    pageState.from.mockImplementation((table: string) =>
      query({
        data: table === "goals" ? null : [],
        error: pageState.errors.get(table) ?? null,
      }),
    );
  });

  it.each(["profile", "weight_entries", "goals"])(
    "shows a load error when the %s query fails",
    async (queryFamily) => {
      pageState.errors.set(queryFamily, { message: "unavailable" });

      const element = await ProgressPage();

      expect(element.type).toBe(pageState.pageLoadError);
      expect(element.props).toMatchObject({
        retryHref: "/progress",
        retryLabel: "Reload Progress",
        title: "Your progress could not be loaded.",
      });
    },
  );
});
