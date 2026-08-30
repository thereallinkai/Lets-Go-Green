import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  data: unknown;
  error: unknown;
};

const pageState = vi.hoisted(() => ({
  errors: new Map<string, unknown>(),
  from: vi.fn(),
  settingsView: vi.fn(() => null),
}));

vi.mock("@/src/lib/env", () => ({
  getAIProviderMode: () => "mock",
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/meal-preference-loader", () => ({
  loadMealPreferenceSummaries: async () => ({
    data: [],
    error: pageState.errors.get("mealPreferences") ?? null,
  }),
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: pageState.from }),
  getCurrentProfile: async () => ({
    data: {
      full_name: "Member",
      preferred_weight_unit: "kg",
      time_zone: "UTC",
      allergies: [],
      dietary_restrictions: [],
      disliked_foods: [],
      training_days_per_week: null,
      safety_context: null,
    },
    error: pageState.errors.get("profile") ?? null,
  }),
  getCurrentUser: async () => ({
    id: "user-1",
    email: "member@example.test",
    created_at: "2026-08-20T12:00:00.000Z",
    user_metadata: {},
  }),
}));

vi.mock("@/components/settings-view", () => ({
  SettingsView: pageState.settingsView,
}));

import SettingsPage from "../../app/(app)/settings/page";

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["eq", "in", "limit", "order", "select"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

describe("Settings page section load errors", () => {
  beforeEach(() => {
    pageState.errors.clear();
    pageState.from.mockReset();
    pageState.settingsView.mockClear();
    pageState.from.mockImplementation((table: string) =>
      query({
        data: table === "goals" ? null : [],
        error: pageState.errors.get(table) ?? null,
      }),
    );
  });

  it.each([
    ["profile", "profile"],
    ["goals", "goal"],
    ["mealPreferences", "mealPreferences"],
    ["foods", "privateLabelFoods"],
    ["food_label_submissions", "activeLabelDrafts"],
  ] as const)(
    "isolates a %s failure to the %s section",
    async (queryFamily, errorSection) => {
      pageState.errors.set(queryFamily, { message: "unavailable" });

      const element = await SettingsPage();
      const loadErrors = element.props.initialData.loadErrors as Record<
        string,
        string | null
      >;

      expect(element.type).toBe(pageState.settingsView);
      expect(loadErrors[errorSection]).toEqual(expect.any(String));
      expect(
        Object.entries(loadErrors)
          .filter(([section]) => section !== errorSection)
          .every(([, message]) => message === null),
      ).toBe(true);
    },
  );
});
