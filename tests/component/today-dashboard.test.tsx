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
    name: new RegExp(
      `^(?:Mark ${label} completed|Return ${label} to not marked)$`,
    ),
  });
}

function dayResponse(
  overrides: Partial<Record<TodayMealCheckin["mealType"], Partial<TodayMealCheckin>>> = {},
) {
  const mealTypes: TodayMealCheckin["mealType"][] = [
    "breakfast",
    "morning_snack",
    "lunch",
    "afternoon_snack",
    "dinner",
    "evening_snack",
  ];
  const slots = mealTypes.map((mealType) => ({
    mealType,
    status: "not_marked" as const,
    skipReason: null,
    items: [],
    ...overrides[mealType],
  }));
  return {
    ok: true,
    json: async () => ({
      data: {
        localDate: "2026-08-14",
        notes: null,
        slots,
      },
      error: null,
    }),
  };
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

    expect(
      screen.getByRole("link", { name: "Edit meal preferences" }),
    ).toHaveAttribute("href", "/settings#preferences");
    expect(screen.getByText(/planning preferences stay separate/i)).toBeInTheDocument();

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
    await waitFor(() => expect(dinner).toHaveTextContent("Done"));
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
      expect(dinner).toHaveTextContent("Mark done");
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

  it("converges to the authoritative status after a PATCH response is lost", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(
        dayResponse({
          dinner: { status: "completed", items: [] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard demoMode={false} />);

    await user.click(mealButton("Dinner"));

    await waitFor(() =>
      expect(mealButton("Dinner")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "PATCH",
      "GET",
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Dinner is completed. Today was refreshed after the earlier response could not be confirmed.",
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
  });

  it("treats a server-error response as ambiguous and refreshes without another write", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          data: null,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Check-in services are temporarily unavailable.",
            retryable: true,
          },
        }),
      })
      .mockResolvedValueOnce(
        dayResponse({ dinner: { status: "completed", items: [] } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard demoMode={false} />);

    await user.click(mealButton("Dinner"));

    await waitFor(() =>
      expect(mealButton("Dinner")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "PATCH",
      "GET",
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
      async (...arguments_: Parameters<typeof fetch>) => {
        const [, init] = arguments_;
        return init?.method === "GET"
          ? dayResponse({
              morning_snack: {
                status: "not_marked",
                items: [],
              },
            })
          : { ok: true };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard />);

    await user.click(
      within(mealRow("Dinner")).getByRole("button", {
        name: "Skip Dinner",
      }),
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

  it("exposes the skip editor as a disclosure and restores focus on cancel", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    render(<TodayDashboard />);

    const skip = within(mealRow("Dinner")).getByRole("button", {
      name: "Skip Dinner",
    });
    expect(skip).toHaveAttribute("aria-expanded", "false");
    expect(skip).toHaveAttribute("aria-controls", "skip-editor-dinner");

    await user.click(skip);

    const reason = screen.getByRole("textbox", {
      name: "Optional reason for skipping dinner",
    });
    expect(skip).toHaveAttribute("aria-expanded", "true");
    expect(reason).toHaveFocus();
    expect(reason.closest("#skip-editor-dinner")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(skip).toHaveFocus());
    expect(skip).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("skip-editor-dinner")).toBeNull();
  });

  it("focuses the food disclosure and restores its opener on close", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    );
    const user = userEvent.setup();
    render(<TodayDashboard />);

    const record = within(mealRow("Breakfast")).getByRole("button", {
      name: "Record food for Breakfast",
    });
    expect(record).toHaveAttribute("aria-expanded", "false");
    expect(record).toHaveAttribute("aria-controls", "food-editor-breakfast");

    await user.click(record);

    const search = screen.getByRole("textbox", {
      name: "Find food to record for breakfast",
    });
    expect(record).toHaveAttribute("aria-expanded", "true");
    expect(search).toHaveFocus();
    expect(search.closest("#food-editor-breakfast")).not.toBeNull();

    await user.click(
      within(mealRow("Breakfast")).getByRole("button", { name: "Close" }),
    );

    await waitFor(() => expect(record).toHaveFocus());
    expect(record).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("food-editor-breakfast")).toBeNull();
  });

  it("refreshes a cross-tab recorded food conflict instead of showing a skipped meal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          data: null,
          error: {
            code: "RECORDED_FOODS_PREVENT_SKIP",
            message: "This meal now has recorded food and cannot be skipped.",
            details:
              "Another tab may have added food. Reload Today, review this meal, and remove every recorded food before trying to skip it.",
            retryable: false,
            action: {
              kind: "navigate",
              label: "Reload Today",
              href: "/today",
            },
          },
        }),
      })
      .mockResolvedValueOnce(
        dayResponse({
          dinner: {
            status: "completed",
            items: [
              {
                id: "dinner-item-banana",
                foodId: "food-banana",
                name: "Banana",
                verificationStatus: "verified",
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard demoMode={false} />);

    await user.click(
      within(mealRow("Dinner")).getByRole("button", {
        name: "Skip Dinner",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save skipped status" }),
    );

    await waitFor(() => expect(mealRow("Dinner")).toHaveTextContent("Banana"));
    expect(mealRow("Dinner")).not.toHaveTextContent(/Skipped ·/);
    expect(mealButton("Dinner")).toHaveAttribute("aria-pressed", "true");
    expect(
      within(mealRow("Dinner")).getByRole("button", { name: "Skip Dinner" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: RECORDED_FOODS_PREVENT_SKIP",
    );
    expect(
      screen.getByText(
        "Dinner was not skipped because recorded food was added elsewhere. Today was refreshed.",
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "PATCH",
      "GET",
    ]);
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
        name: "Record food for Morning snack",
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
      screen.getByText(/1 snack item recorded/, {
        selector: ".day-status-card p",
      }),
    ).toBeInTheDocument();
    expect(
      within(mealRow("Morning snack")).getByRole("button", {
        name: "Skip Morning snack",
      }),
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

  it("lets users record a primary meal when no accepted plan exists", async () => {
    const fetchMock = vi.fn(async (...arguments_: Parameters<typeof fetch>) => {
      const [input, init] = arguments_;
      if (String(input).startsWith("/api/foods")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: "food-apple",
                english_name: "Apple",
                verification_status: "verified",
                plan_eligible: true,
              },
            ],
          }),
        };
      }
      if (init?.method === "GET") {
        return dayResponse({
          breakfast: {
            status: "completed",
            items: [
              {
                id: "breakfast-item-1",
                foodId: "food-apple",
                name: "Apple",
                verificationStatus: "verified",
              },
            ],
          },
        });
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            id: "breakfast-item-1",
            food: {
              id: "food-apple",
              english_name: "Apple",
              verification_status: "verified",
            },
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <TodayDashboard
        demoMode={false}
        initialCompleted={{ breakfast: false, lunch: false, dinner: false }}
      />,
    );

    expect(mealRow("Breakfast")).toHaveTextContent(
      "No accepted plan meal is available for this day.",
    );
    expect(
      within(mealRow("Breakfast")).getByText("Plan for today"),
    ).toBeInTheDocument();
    expect(
      within(mealRow("Morning snack")).getByText("Optional snack space"),
    ).toBeInTheDocument();

    await user.click(
      within(mealRow("Breakfast")).getByRole("button", {
        name: "Record food for Breakfast",
      }),
    );
    expect(mealRow("Breakfast")).toHaveTextContent(
      "Recording a food marks this slot completed.",
    );
    await user.click(
      await within(mealRow("Breakfast")).findByRole("button", {
        name: "Add Apple to Breakfast",
      }),
    );

    const manageRecordedFoods = await within(mealRow("Breakfast")).findByRole(
      "button",
      { name: "Manage recorded foods for Breakfast" },
    );
    await waitFor(() => expect(manageRecordedFoods).toHaveFocus());
    expect(mealRow("Breakfast")).toHaveTextContent("Recorded today");
    expect(mealButton("Breakfast")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(
        "Apple was recorded for Breakfast and the slot was marked completed.",
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
    const addRequest = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/items"),
    );
    expect(JSON.parse(String(addRequest?.[1]?.body))).toEqual({
      mealType: "breakfast",
      foodId: "food-apple",
    });
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      undefined,
      "POST",
      "GET",
    ]);
  });

  it("reconciles a malformed successful food-add response before claiming success", async () => {
    const catalogResponse = {
      ok: true,
      json: async () => ({
        data: [
          {
            id: "food-apple",
            english_name: "Apple",
            verification_status: "verified",
            plan_eligible: true,
          },
        ],
      }),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(catalogResponse)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ data: {} }),
      })
      .mockResolvedValueOnce(
        dayResponse({
          breakfast: {
            status: "completed",
            items: [
              {
                id: "breakfast-item-apple",
                foodId: "food-apple",
                name: "Apple",
                verificationStatus: "verified",
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <TodayDashboard
        demoMode={false}
        initialCompleted={{ breakfast: false, lunch: false, dinner: false }}
      />,
    );

    await user.click(
      within(mealRow("Breakfast")).getByRole("button", {
        name: "Record food for Breakfast",
      }),
    );
    await user.click(
      await within(mealRow("Breakfast")).findByRole("button", {
        name: "Add Apple to Breakfast",
      }),
    );

    await waitFor(() => expect(mealRow("Breakfast")).toHaveTextContent("Apple"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      undefined,
      "POST",
      "GET",
    ]);
  });

  it("uses the authoritative food name when post-insert detail lookup is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "food-apple",
              english_name: "Apple",
              verification_status: "verified",
              plan_eligible: true,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            id: "breakfast-item-apple",
            foodId: "food-apple",
            food: null,
            reconciliationRequired: true,
          },
        }),
      })
      .mockResolvedValueOnce(
        dayResponse({
          breakfast: {
            status: "completed",
            items: [
              {
                id: "breakfast-item-apple",
                foodId: "food-apple",
                name: "Apple",
                verificationStatus: "verified",
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <TodayDashboard
        demoMode={false}
        initialCompleted={{ breakfast: false, lunch: false, dinner: false }}
      />,
    );

    await user.click(
      within(mealRow("Breakfast")).getByRole("button", {
        name: "Record food for Breakfast",
      }),
    );
    await user.click(
      await within(mealRow("Breakfast")).findByRole("button", {
        name: "Add Apple to Breakfast",
      }),
    );

    await waitFor(() => expect(mealRow("Breakfast")).toHaveTextContent("Apple"));
    expect(mealRow("Breakfast")).not.toHaveTextContent("Selected food");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("converges after a food-add response is lost", async () => {
    const foodCatalogResponse = {
      ok: true,
      json: async () => ({
        data: [
          {
            id: "food-apple",
            english_name: "Apple",
            verification_status: "verified",
            plan_eligible: true,
          },
        ],
      }),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(foodCatalogResponse)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(
        dayResponse({
          breakfast: {
            status: "completed",
            items: [
              {
                id: "breakfast-item-apple",
                foodId: "food-apple",
                name: "Apple",
                verificationStatus: "verified",
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <TodayDashboard
        demoMode={false}
        initialCompleted={{ breakfast: false, lunch: false, dinner: false }}
      />,
    );

    await user.click(
      within(mealRow("Breakfast")).getByRole("button", {
        name: "Record food for Breakfast",
      }),
    );
    await user.click(
      await within(mealRow("Breakfast")).findByRole("button", {
        name: "Add Apple to Breakfast",
      }),
    );

    await waitFor(() => expect(mealRow("Breakfast")).toHaveTextContent("Apple"));
    expect(mealButton("Breakfast")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Apple is recorded for Breakfast. Today was refreshed after the earlier response could not be confirmed.",
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      undefined,
      "POST",
      "GET",
    ]);
  });

  it("ignores an older food-catalog response after the active meal changes", async () => {
    const first = deferred<{
      ok: boolean;
      json: () => Promise<{ data: Array<Record<string, unknown>> }>;
    }>();
    const second = deferred<{
      ok: boolean;
      json: () => Promise<{ data: Array<Record<string, unknown>> }>;
    }>();
    const firstJson = vi.fn(async () => ({
      data: [
        {
          id: "food-apple",
          english_name: "Apple",
          verification_status: "verified",
          plan_eligible: true,
        },
      ],
    }));
    const secondJson = vi.fn(async () => ({
      data: [
        {
          id: "food-banana",
          english_name: "Banana",
          verification_status: "verified",
          plan_eligible: true,
        },
      ],
    }));
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard />);

    await user.click(
      within(mealRow("Breakfast")).getByRole("button", {
        name: "Record food for Breakfast",
      }),
    );
    await user.click(
      within(mealRow("Lunch")).getByRole("button", {
        name: "Record food for Lunch",
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toHaveProperty(
      "aborted",
      true,
    );
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toHaveProperty(
      "aborted",
      false,
    );
    second.resolve({ ok: true, json: secondJson });
    expect(
      await within(mealRow("Lunch")).findByRole("button", {
        name: "Add Banana to Lunch",
      }),
    ).toBeInTheDocument();

    first.resolve({ ok: true, json: firstJson });
    await waitFor(() => expect(firstJson).toHaveBeenCalledOnce());
    expect(mealRow("Lunch")).toHaveTextContent("Banana");
    expect(mealRow("Lunch")).not.toHaveTextContent("Apple");
  });

  it("ignores a food-catalog response after its picker is closed", async () => {
    const pending = deferred<{
      ok: boolean;
      json: () => Promise<{ data: Array<Record<string, unknown>> }>;
    }>();
    const responseJson = vi.fn(async () => ({
      data: [
        {
          id: "food-apple",
          english_name: "Apple",
          verification_status: "verified",
          plan_eligible: true,
        },
      ],
    }));
    const fetchMock = vi.fn((..._arguments: Parameters<typeof fetch>) => {
      void _arguments;
      return pending.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard />);

    await user.click(
      within(mealRow("Breakfast")).getByRole("button", {
        name: "Record food for Breakfast",
      }),
    );
    await user.click(
      within(mealRow("Breakfast")).getByRole("button", { name: "Close" }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toHaveProperty(
      "aborted",
      true,
    );
    pending.resolve({ ok: true, json: responseJson });
    await waitFor(() => expect(responseJson).toHaveBeenCalledOnce());

    expect(
      within(mealRow("Breakfast")).queryByRole("button", {
        name: "Add Apple to Breakfast",
      }),
    ).not.toBeInTheDocument();
  });

  it("normalizes missing meal-slot rows before rendering controls", () => {
    render(
      <TodayDashboard
        initialCheckins={[
          {
            mealType: "breakfast",
            status: "completed",
            skipReason: null,
            items: [],
          },
        ]}
      />,
    );

    expect(mealButton("Breakfast")).toHaveAttribute("aria-pressed", "true");
    expect(mealButton("Lunch")).toHaveAttribute("aria-pressed", "false");
    expect(mealButton("Evening snack")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("matches persisted reload state after a final snack food is removed", async () => {
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
      async (...arguments_: Parameters<typeof fetch>) =>
        arguments_[1]?.method === "GET"
          ? dayResponse({
              morning_snack: { status: "not_marked", items: [] },
            })
          : { ok: true },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { unmount } = render(
      <TodayDashboard demoMode={false} initialCheckins={initialCheckins} />,
    );

    expect(
      within(mealRow("Morning snack")).getByRole("button", {
        name: "Return Morning snack to not marked",
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
          name: "Mark Morning snack completed",
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
      screen.queryByText(/snack item recorded/, {
        selector: ".day-status-card p",
      }),
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
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "GET"),
    ).toBe(true);

    unmount();
    render(
      <TodayDashboard
        initialCheckins={initialCheckins.map((checkin) =>
          checkin.mealType === "morning_snack"
            ? { ...checkin, status: "not_marked", items: [] }
            : checkin,
        )}
      />,
    );
    expect(
      within(mealRow("Morning snack")).getByRole("button", {
        name: "Mark Morning snack completed",
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("converges by refreshing when a final-snack delete response is lost", async () => {
    const initialCheckins = [
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
    ] satisfies TodayMealCheckin[];
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(
        dayResponse({
          morning_snack: { status: "not_marked", items: [] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <TodayDashboard demoMode={false} initialCheckins={initialCheckins} />,
    );

    const remove = within(mealRow("Morning snack")).getByRole("button", {
      name: "Remove Apple from Morning snack",
    });
    await user.click(remove);
    await waitFor(() =>
      expect(mealRow("Morning snack")).not.toHaveTextContent("Apple"),
    );
    expect(mealButton("Morning snack")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("DELETE");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
      cache: "no-store",
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses the authoritative day after a concurrent snack add and delete", async () => {
    const initialCheckins = [
      {
        mealType: "morning_snack",
        status: "completed",
        skipReason: null,
        items: [
          {
            id: "snack-item-apple",
            foodId: "food-apple",
            name: "Apple",
            verificationStatus: "verified",
          },
        ],
      },
    ] satisfies TodayMealCheckin[];
    const fetchMock = vi.fn(
      async (...arguments_: Parameters<typeof fetch>) =>
        arguments_[1]?.method === "GET"
          ? dayResponse({
              morning_snack: {
                status: "completed",
                items: [
                  {
                    id: "snack-item-banana",
                    foodId: "food-banana",
                    name: "Banana",
                    verificationStatus: "verified",
                  },
                ],
              },
            })
          : { ok: true },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <TodayDashboard demoMode={false} initialCheckins={initialCheckins} />,
    );

    await user.click(
      within(mealRow("Morning snack")).getByRole("button", {
        name: "Remove Apple from Morning snack",
      }),
    );

    await waitFor(() =>
      expect(mealRow("Morning snack")).toHaveTextContent("Banana"),
    );
    expect(mealRow("Morning snack")).not.toHaveTextContent("Apple");
    expect(mealButton("Morning snack")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText(/1 snack item recorded/, {
        selector: ".day-status-card p",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Apple was removed from Morning snack. 1 other snack item remains; the slot is completed.",
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
      "DELETE",
      "GET",
    ]);
  });

  it("preserves a primary meal status after its final recorded food is removed", async () => {
    const breakfastItem = {
      id: "breakfast-item-1",
      foodId: "food-1",
      name: "Apple",
      verificationStatus: "verified",
    };
    const initialCheckins = [
      {
        mealType: "breakfast",
        status: "completed",
        skipReason: null,
        items: [breakfastItem],
      },
    ] satisfies TodayMealCheckin[];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (...arguments_: Parameters<typeof fetch>) =>
        arguments_[1]?.method === "GET"
          ? dayResponse({
              breakfast: { status: "completed", items: [] },
            })
          : { ok: true },
      ),
    );
    const user = userEvent.setup();
    render(
      <TodayDashboard demoMode={false} initialCheckins={initialCheckins} />,
    );

    await user.click(
      within(mealRow("Breakfast")).getByRole("button", {
        name: "Remove Apple from Breakfast",
      }),
    );

    await waitFor(() =>
      expect(
        within(mealRow("Breakfast")).getByRole("button", {
          name: "Return Breakfast to not marked",
        }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(
      screen.getByText(
        "Apple was removed from Breakfast. The meal is still completed.",
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
  });

  it("does not send a status mutation after the rendered local day rolls over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date("2026-08-15T03:59:00.000Z"));
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(
        <TodayDashboard
          demoMode={false}
          renderedLocalDay="2026-08-14"
          timeZone="America/New_York"
        />,
      );

      vi.setSystemTime(new Date("2026-08-15T04:01:00.000Z"));
      await user.click(mealButton("Dinner"));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mealButton("Dinner")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Error code: TODAY_DAY_CHANGED",
      );
      expect(
        screen.getByRole("link", { name: "Load the new day" }),
      ).toHaveAttribute("href", "/today");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not add a food to a different day after midnight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date("2026-08-15T03:59:00.000Z"));
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "food-apple",
              english_name: "Apple",
              verification_status: "verified",
              plan_eligible: true,
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(
        <TodayDashboard
          demoMode={false}
          renderedLocalDay="2026-08-14"
          timeZone="America/New_York"
        />,
      );

      await user.click(
        within(mealRow("Breakfast")).getByRole("button", {
          name: "Record food for Breakfast",
        }),
      );
      const addApple = await within(mealRow("Breakfast")).findByRole(
        "button",
        { name: "Add Apple to Breakfast" },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date("2026-08-15T04:01:00.000Z"));
      await user.click(addApple);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
      ).toBe(false);
      expect(mealRow("Breakfast")).not.toHaveTextContent("Recorded today");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Error code: TODAY_DAY_CHANGED",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not delete a visible prior-day food from the new day", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date("2026-08-15T03:59:00.000Z"));
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(
        <TodayDashboard
          demoMode={false}
          renderedLocalDay="2026-08-14"
          timeZone="America/New_York"
          initialCheckins={[
            {
              mealType: "breakfast",
              status: "completed",
              skipReason: null,
              items: [
                {
                  id: "prior-day-apple",
                  foodId: "food-apple",
                  name: "Apple",
                  verificationStatus: "verified",
                },
              ],
            },
          ]}
        />,
      );

      vi.setSystemTime(new Date("2026-08-15T04:01:00.000Z"));
      await user.click(
        within(mealRow("Breakfast")).getByRole("button", {
          name: "Remove Apple from Breakfast",
        }),
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mealRow("Breakfast")).toHaveTextContent("Apple");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Error code: TODAY_DAY_CHANGED",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
