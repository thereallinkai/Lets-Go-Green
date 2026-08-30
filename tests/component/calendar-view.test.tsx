import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalendarView } from "../../components/calendar-view";
import { normalizeMealSlotCheckins } from "../../src/lib/domain";

function mealSection(label: string) {
  const section = screen.getByText(label).closest(".day-meal");
  if (!section) throw new Error(`Could not find ${label}.`);
  return section as HTMLElement;
}

describe("CalendarView six-slot check-ins", () => {
  it("shows optional snack spaces and saves a skipped primary meal", async () => {
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>) => {
        void _arguments;
        return { ok: true };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <CalendarView
        initialMonth="2026-07"
        initialSelectedDate="2026-07-24"
        initialCheckins={[
          {
            localDate: "2026-07-24",
            notes: null,
            slots: normalizeMealSlotCheckins([]),
          },
        ]}
      />,
    );

    expect(screen.getByText("Morning snack")).toBeInTheDocument();
    expect(screen.getByText("Afternoon snack")).toBeInTheDocument();
    expect(screen.getByText("Evening snack")).toBeInTheDocument();

    await user.click(
      within(mealSection("Lunch")).getByRole("button", { name: "Skip" }),
    );
    await user.type(
      within(mealSection("Lunch")).getByRole("textbox", {
        name: "Optional skip reason",
      }),
      "No appetite",
    );
    await user.click(
      within(mealSection("Lunch")).getByRole("button", {
        name: "Save skipped status",
      }),
    );

    await waitFor(() =>
      expect(mealSection("Lunch")).toHaveTextContent(
        "Skipped · No appetite",
      ),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      kind: "meal_status",
      mealType: "lunch",
      status: "skipped",
      skipReason: "No appetite",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkins/2026-07-24");
  });

  it("saves a day note with a separate mutation", async () => {
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>) => {
        void _arguments;
        return { ok: true };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <CalendarView
        initialMonth="2026-07"
        initialSelectedDate="2026-07-24"
        initialCheckins={[
          {
            localDate: "2026-07-24",
            notes: "Existing",
            slots: normalizeMealSlotCheckins([
              {
                mealType: "breakfast",
                status: "completed",
                skipReason: null,
              },
            ]),
          },
        ]}
      />,
    );

    const note = screen.getByRole("textbox", { name: "Optional note" });
    await user.clear(note);
    await user.type(note, "Updated note");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() =>
      expect(
        screen.getByText("The note was saved.", {
          selector: "[aria-live]",
        }),
      ).toBeInTheDocument(),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      kind: "note",
      notes: "Updated note",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkins/2026-07-24");
  });

  it("keeps calendar navigation disabled until a dated mutation settles", async () => {
    let resolveSave!: (response: { ok: boolean }) => void;
    const pendingSave = new Promise<{ ok: boolean }>((resolve) => {
      resolveSave = resolve;
    });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return pendingSave;
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <CalendarView
        initialMonth="2026-07"
        initialSelectedDate="2026-07-24"
        initialCheckins={[
          {
            localDate: "2026-07-24",
            notes: null,
            slots: normalizeMealSlotCheckins([]),
          },
          {
            localDate: "2026-07-25",
            notes: null,
            slots: normalizeMealSlotCheckins([]),
          },
        ]}
      />,
    );

    await user.click(
      within(mealSection("Breakfast")).getByRole("button", {
        name: "Mark completed",
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkins/2026-07-24");
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Previous month" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Next month" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /July 25, 2026/ }),
    ).toBeDisabled();

    resolveSave({ ok: true });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Today" })).toBeEnabled(),
    );
  });

  it("uses the saved local date when undoing a note", async () => {
    const fetchMock = vi.fn(
      async (..._arguments: Parameters<typeof fetch>) => {
        void _arguments;
        return { ok: true };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <CalendarView
        initialMonth="2026-07"
        initialSelectedDate="2026-07-24"
        initialCheckins={[
          {
            localDate: "2026-07-24",
            notes: "Before",
            slots: normalizeMealSlotCheckins([]),
          },
        ]}
      />,
    );

    const note = screen.getByRole("textbox", { name: "Optional note" });
    await user.clear(note);
    await user.type(note, "After");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    await screen.findByText("The note was saved.", {
      selector: "[aria-live]",
    });
    await user.click(
      screen.getByRole("button", { name: "Undo last saved change" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/checkins/2026-07-24",
      "/api/checkins/2026-07-24",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      kind: "note",
      notes: "Before",
    });
    expect(note).toHaveValue("Before");
  });

  it("aborts superseded month loads and ignores their stale responses", async () => {
    type MonthResponse = {
      ok: boolean;
      json: () => Promise<{ data: unknown[] }>;
    };
    let resolveAugust!: (response: MonthResponse) => void;
    let resolveJune!: (response: MonthResponse) => void;
    const augustResponse = new Promise<MonthResponse>((resolve) => {
      resolveAugust = resolve;
    });
    const juneResponse = new Promise<MonthResponse>((resolve) => {
      resolveJune = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.includes("from=2026-08-01")) return augustResponse;
      if (url.includes("from=2026-06-01")) return juneResponse;
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <CalendarView
        initialMonth="2026-07"
        initialSelectedDate="2026-07-24"
        initialCheckins={[
          {
            localDate: "2026-07-24",
            notes: null,
            slots: normalizeMealSlotCheckins([]),
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstSignal = fetchMock.mock.calls[0][1]?.signal;
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);

    resolveJune({
      ok: true,
      json: async () => ({ data: [] }),
    });
    expect(
      await screen.findByRole("heading", { name: "June 2026" }),
    ).toBeInTheDocument();

    resolveAugust({
      ok: true,
      json: async () => ({ data: [] }),
    });
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "June 2026" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: "August 2026" }),
    ).not.toBeInTheDocument();
  });

  it("clears an unsaved skip reason when a different month loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [] }),
      })),
    );
    const user = userEvent.setup();
    render(
      <CalendarView
        initialMonth="2026-07"
        initialSelectedDate="2026-07-24"
        initialCheckins={[
          {
            localDate: "2026-07-24",
            notes: null,
            slots: normalizeMealSlotCheckins([]),
          },
        ]}
      />,
    );

    await user.click(
      within(mealSection("Lunch")).getByRole("button", { name: "Skip" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Optional skip reason" }),
      "Reason for July only",
    );
    await user.click(screen.getByRole("button", { name: "Next month" }));

    await screen.findByRole("heading", { name: "August 2026" });
    expect(
      screen.queryByRole("textbox", { name: "Optional skip reason" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(mealSection("Lunch")).getByRole("button", { name: "Skip" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Optional skip reason" }),
    ).toHaveValue("");
  });

  it("shows a safe structured persistence error visibly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          data: null,
          error: {
            code: "CHECKIN_PROFILE_UNAVAILABLE",
            message: "Your time zone could not be checked before saving.",
            details: "No check-in data was changed.",
            retryable: true,
            action: { kind: "retry", label: "Try saving again" },
          },
        }),
      })),
    );
    const user = userEvent.setup();
    render(
      <CalendarView
        initialMonth="2026-07"
        initialSelectedDate="2026-07-24"
        initialCheckins={[
          {
            localDate: "2026-07-24",
            notes: "Existing",
            slots: normalizeMealSlotCheckins([]),
          },
        ]}
      />,
    );

    const note = screen.getByRole("textbox", { name: "Optional note" });
    await user.clear(note);
    await user.type(note, "Unsaved change");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Your time zone could not be checked before saving.",
    );
    expect(alert).toHaveTextContent("Error code: CHECKIN_PROFILE_UNAVAILABLE");
    expect(note).toHaveValue("Existing");
  });
});
