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
