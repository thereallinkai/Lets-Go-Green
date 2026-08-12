import type { PropsWithChildren } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  TodayDashboard,
  type TodayMealCheckin,
} from "../../components/today-dashboard";

vi.mock("recharts", () => {
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    CartesianGrid: Empty,
    Line: Empty,
    ReferenceLine: Empty,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mealRow(label: string) {
  const row = screen.getByText(label).closest(".meal-row");
  if (!row) throw new Error(`Could not find ${label} row.`);
  return row as HTMLElement;
}

function mealButton(label: string) {
  return within(mealRow(label)).getByRole("button", {
    name: /^(Completed|Mark completed|Saving…)$/,
  });
}

describe("TodayDashboard meal completion", () => {
  it("optimistically applies the desired final state and confirms a successful save", async () => {
    const request = deferred<{ ok: boolean }>();
    const fetchMock = vi.fn((..._arguments: Parameters<typeof fetch>) => {
      void _arguments;
      return request.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard />);

    const dinner = mealButton("Dinner");
    expect(dinner).toHaveAttribute("aria-pressed", "false");
    await user.click(dinner);

    expect(dinner).toHaveAttribute("aria-pressed", "true");
    expect(dinner).toHaveTextContent("Saving…");
    expect(mealButton("Breakfast")).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      kind: "meal_status",
      mealType: "dinner",
      status: "completed",
      skipReason: null,
    });

    request.resolve({ ok: true });
    await waitFor(() => expect(dinner).toHaveTextContent("Completed"));
    expect(
      screen.getByText("Dinner is now completed.", { selector: "[aria-live]" }),
    ).toBeInTheDocument();
  });

  it("rolls optimistic state back and announces a persistence failure", async () => {
    const request = deferred<{ ok: boolean }>();
    vi.stubGlobal("fetch", vi.fn(() => request.promise));
    const user = userEvent.setup();
    render(<TodayDashboard />);

    const dinner = mealButton("Dinner");
    await user.click(dinner);
    expect(dinner).toHaveAttribute("aria-pressed", "true");

    request.resolve({ ok: false });
    await waitFor(() => {
      expect(dinner).toHaveAttribute("aria-pressed", "false");
      expect(dinner).toHaveTextContent("Mark completed");
    });
    expect(
      screen.getByText(
        "We could not save Dinner. Your previous status was restored.",
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: CHECKIN_SAVE_UNAVAILABLE",
    );
  });

  it("sends an explicit false state when a completed meal is undone", async () => {
    const fetchMock = vi.fn(async (..._arguments: Parameters<typeof fetch>) => {
      void _arguments;
      return { ok: true };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard />);

    await user.click(mealButton("Breakfast"));
    await waitFor(() =>
      expect(
        screen.getByText("Breakfast is now not marked.", {
          selector: "[aria-live]",
        }),
      ).toBeInTheDocument(),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      kind: "meal_status",
      mealType: "breakfast",
      status: "not_marked",
      skipReason: null,
    });
  });

  it("saves a skipped meal with an optional reason", async () => {
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>) => {
        void _arguments;
        return { ok: true };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard />);

    await user.click(
      within(mealRow("Dinner")).getByRole("button", { name: "Skip" }),
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Optional reason for skipping dinner",
      }),
      "Late appointment",
    );
    await user.click(
      screen.getByRole("button", { name: "Save skipped status" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("Dinner is now skipped.", {
          selector: "[aria-live]",
        }),
      ).toBeInTheDocument(),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      kind: "meal_status",
      mealType: "dinner",
      status: "skipped",
      skipReason: "Late appointment",
    });
    expect(mealRow("Dinner")).toHaveTextContent(
      "Skipped · Late appointment",
    );
  });

  it("adds a catalog food to an optional snack space", async () => {
    const fetchMock = vi.fn(async (...arguments_: Parameters<typeof fetch>) => {
      const [input] = arguments_;
      const url = String(input);
      if (url.startsWith("/api/foods")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: "food-1",
                english_name:
                  "Optimum Nutrition — Gold Standard 100% Whey",
                verification_status: "source_reported",
                plan_eligible: false,
                brand_name: "Optimum Nutrition",
                variant_name: "Double Rich Chocolate",
                gtin: "748927022650",
                catalog_status: "pending_review",
                nutrition: {
                  measurement_basis: "as_sold",
                  reference_quantity: 100,
                  reference_unit: "g",
                  calories: 400,
                  energy_kj: 1674,
                  protein_g: 80,
                  carbohydrate_g: 10,
                  fat_g: 3,
                  fiber_g: 1,
                  sodium_mg: 500,
                  verification_status: "source_reported",
                  nutrients: [],
                },
                source: {
                  provider: "open_food_facts",
                  attribution_text: "Product data from Open Food Facts.",
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            id: "item-1",
            food: {
              id: "food-1",
              english_name:
                "Optimum Nutrition — Gold Standard 100% Whey",
              verification_status: "source_reported",
            },
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard />);

    await user.click(
      within(mealRow("Morning snack")).getByRole("button", {
        name: "Add food",
      }),
    );
    const addButton = await within(mealRow("Morning snack")).findByRole(
      "button",
      {
        name: "Add Optimum Nutrition — Gold Standard 100% Whey to Morning snack",
      },
    );
    expect(mealRow("Morning snack")).toHaveTextContent(
      "Double Rich Chocolate",
    );
    expect(mealRow("Morning snack")).not.toHaveTextContent(/barcode/i);
    expect(mealRow("Morning snack")).toHaveTextContent(
      "Pending catalog review",
    );
    expect(
      within(mealRow("Morning snack")).getByText("Nutrition facts"),
    ).toBeInTheDocument();
    expect(mealRow("Morning snack")).toHaveTextContent(
      "Reference food — available for daily logging",
    );
    await user.click(addButton);

    await waitFor(() =>
      expect(mealRow("Morning snack")).toHaveTextContent(
        "Optimum Nutrition — Gold Standard 100% Whey",
      ),
    );
    expect(
      within(mealRow("Morning snack")).getByRole("button", { name: "Skip" }),
    ).toBeDisabled();
    expect(
      within(mealRow("Morning snack")).getByText(
        "Remove recorded foods before marking this slot skipped.",
      ),
    ).toBeInTheDocument();
    const addRequest = fetchMock.mock.calls.find(
      ([input]) => String(input).includes("/items"),
    );
    expect(JSON.parse(String(addRequest?.[1]?.body))).toEqual({
      mealType: "morning_snack",
      foodId: "food-1",
    });
  });

  it("returns an empty snack to not marked after its final food is removed", async () => {
    const initialCheckins = [
      {
        mealType: "breakfast",
        status: "not_marked",
        skipReason: null,
        items: [],
      },
      {
        mealType: "morning_snack",
        status: "completed",
        skipReason: null,
        items: [
          {
            id: "snack-item-1",
            foodId: "food-1",
            name: "Apple",
            verificationStatus: "verified",
          },
        ],
      },
      {
        mealType: "lunch",
        status: "not_marked",
        skipReason: null,
        items: [],
      },
      {
        mealType: "afternoon_snack",
        status: "not_marked",
        skipReason: null,
        items: [],
      },
      {
        mealType: "dinner",
        status: "not_marked",
        skipReason: null,
        items: [],
      },
      {
        mealType: "evening_snack",
        status: "not_marked",
        skipReason: null,
        items: [],
      },
    ] satisfies TodayMealCheckin[];
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>) => {
        void _arguments;
        return { ok: true };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard initialCheckins={initialCheckins} />);

    expect(
      within(mealRow("Morning snack")).getByRole("button", {
        name: "Completed",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(
      within(mealRow("Morning snack")).getByRole("button", {
        name: "Remove Apple from Morning snack",
      }),
    );

    await waitFor(() =>
      expect(
        within(mealRow("Morning snack")).getByRole("button", {
          name: "Mark completed",
        }),
      ).toHaveAttribute("aria-pressed", "false"),
    );
    expect(
      screen.getByText(
        "Apple was removed from Morning snack. The empty snack is now not marked.",
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/1 snacks recorded/, { selector: ".day-status-card p" }),
    ).not.toBeInTheDocument();

    const deleteRequest = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).includes("/items/snack-item-1") &&
        init?.method === "DELETE",
    );
    expect(deleteRequest).toBeDefined();
    const statusRequest = fetchMock.mock.calls.find(
      ([input, init]) =>
        !String(input).includes("/items/") && init?.method === "PATCH",
    );
    expect(statusRequest).toBeUndefined();
  });
});
