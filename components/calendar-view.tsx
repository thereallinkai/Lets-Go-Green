"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Undo2,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error-notice";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromResponse,
  apiErrorFromThrown,
  clientApiError,
} from "@/src/lib/client-api-error";
import {
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  SNACK_MEAL_TYPES,
  addLocalDays,
  localDateInTimeZone,
  normalizeMealSlotCheckins,
  summarizeMealCheckins,
  type MealCheckinStatus,
  type MealSlot,
  type MealSlotCheckin,
} from "@/src/lib/domain";

export type CalendarCheckin = {
  localDate: string;
  slots: MealSlotCheckin[];
  notes: string | null;
};

type LastChange =
  | {
      kind: "meal";
      mealType: MealSlot;
      previous: MealSlotCheckin;
    }
  | {
      kind: "note";
      previous: string;
    };

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    first,
    last: `${year}-${String(monthNumber).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}

function fullDateLabel(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${localDate}T12:00:00Z`));
}

function emptyCheckin(localDate: string): CalendarCheckin {
  return {
    localDate,
    slots: normalizeMealSlotCheckins([]),
    notes: null,
  };
}

function normalizeCheckin(checkin: CalendarCheckin): CalendarCheckin {
  return {
    ...checkin,
    slots: normalizeMealSlotCheckins(checkin.slots),
  };
}

export function CalendarView({
  initialMonth = "2026-07",
  initialSelectedDate = "2026-07-24",
  initialCheckins,
  timeZone = "America/New_York",
}: {
  initialMonth?: string;
  initialSelectedDate?: string;
  initialCheckins?: CalendarCheckin[];
  timeZone?: string;
}) {
  const demoCheckins = useMemo<CalendarCheckin[]>(
    () =>
      Array.from({ length: 24 }, (_, index) => {
        const day = index + 1;
        const completed = (day * 7) % 4;
        return {
          localDate: `2026-07-${String(day).padStart(2, "0")}`,
          slots: normalizeMealSlotCheckins(
            MEAL_SLOTS.map((mealType) => ({
              mealType,
              status:
                mealType === "breakfast" && completed > 0
                  ? "completed"
                  : mealType === "lunch" && completed > 1
                    ? "completed"
                    : mealType === "dinner" && completed > 2
                      ? "completed"
                      : "not_marked",
              skipReason: null,
            })),
          ),
          notes: null,
        };
      }),
    [],
  );
  const [month, setMonth] = useState(initialMonth);
  const [checkins, setCheckins] = useState<CalendarCheckin[]>(
    (initialCheckins ?? demoCheckins).map(normalizeCheckin),
  );
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  const selectedCheckin =
    checkins.find((checkin) => checkin.localDate === selectedDate) ??
    emptyCheckin(selectedDate);
  const [notes, setNotes] = useState(selectedCheckin.notes ?? "");
  const [announcement, setAnnouncement] = useState("");
  const [operationError, setOperationError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastChange, setLastChange] = useState<LastChange | null>(null);
  const [skipEditor, setSkipEditor] = useState<MealSlot | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const today = localDateInTimeZone(new Date(), timeZone);

  function replaceSelected(
    updater: (checkin: CalendarCheckin) => CalendarCheckin,
  ) {
    setCheckins((current) => {
      const existing = current.find(
        (checkin) => checkin.localDate === selectedDate,
      );
      const next = updater(existing ?? emptyCheckin(selectedDate));
      return [
        ...current.filter(
          (checkin) => checkin.localDate !== selectedDate,
        ),
        next,
      ];
    });
  }

  const calendarDays = useMemo(() => {
    const bounds = monthBounds(month);
    const firstWeekday = new Date(`${bounds.first}T12:00:00Z`).getUTCDay();
    const gridStart = addLocalDays(bounds.first, -firstWeekday);
    return Array.from({ length: 42 }, (_, index) => {
      const localDate = addLocalDays(gridStart, index);
      const checkin = checkins.find((item) => item.localDate === localDate);
      const summary = summarizeMealCheckins(checkin?.slots ?? []);
      const snacks = (checkin?.slots ?? []).filter(
        (slot) =>
          SNACK_MEAL_TYPES.includes(
            slot.mealType as (typeof SNACK_MEAL_TYPES)[number],
          ) && slot.status === "completed",
      ).length;
      return {
        localDate,
        label: Number(localDate.slice(-2)),
        outside: !localDate.startsWith(month),
        marked: summary.marked,
        snacks,
      };
    });
  }, [checkins, month]);

  async function loadMonth(nextMonth: string, selectDate?: string) {
    const fallback = clientApiError(
      "CHECKINS_LOAD_UNAVAILABLE",
      "The requested month could not be loaded.",
      "The current month remains visible. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try loading again" } },
    );
    setOperationError(null);
    const { first, last } = monthBounds(nextMonth);
    setAnnouncement(`Loading ${monthLabel(nextMonth)}…`);
    try {
      const response = await fetch(
        `/api/checkins?from=${encodeURIComponent(first)}&to=${encodeURIComponent(last)}`,
      );
      if (!response.ok) {
        throw await apiErrorFromResponse(response, fallback);
      }
      const result = (await response.json()) as {
        data: CalendarCheckin[] | null;
      };
      const nextCheckins = (result.data ?? []).map(normalizeCheckin);
      setMonth(nextMonth);
      setCheckins(nextCheckins);
      const nextSelected = selectDate ?? first;
      setSelectedDate(nextSelected);
      const nextCheckin = nextCheckins.find(
        (checkin) => checkin.localDate === nextSelected,
      );
      setNotes(nextCheckin?.notes ?? "");
      setLastChange(null);
      setAnnouncement(`${monthLabel(nextMonth)} is ready.`);
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      setOperationError(publicError);
      setAnnouncement(`${publicError.message} Error code: ${publicError.code}.`);
    }
  }

  function selectDay(localDate: string) {
    const checkin = checkins.find((item) => item.localDate === localDate);
    setSelectedDate(localDate);
    setNotes(checkin?.notes ?? "");
    setLastChange(null);
    setSkipEditor(null);
  }

  async function persistMeal(
    mealType: MealSlot,
    status: MealCheckinStatus,
    reason: string | null,
  ) {
    const fallback = clientApiError(
      "CHECKIN_SAVE_UNAVAILABLE",
      "The meal status could not be saved.",
      "The previous status remains. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try again" } },
    );
    const response = await fetch(`/api/checkins/${selectedDate}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "meal_status",
        mealType,
        status,
        skipReason: status === "skipped" ? reason : null,
      }),
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(response, fallback);
    }
  }

  async function setMeal(
    mealType: MealSlot,
    status: MealCheckinStatus,
    reason: string | null = null,
  ) {
    if (saving || selectedDate > today) return;
    const previous = selectedCheckin.slots.find(
      (slot) => slot.mealType === mealType,
    )!;
    const next = {
      mealType,
      status,
      skipReason: status === "skipped" ? reason : null,
    } satisfies MealSlotCheckin;
    replaceSelected((checkin) => ({
      ...checkin,
      slots: checkin.slots.map((slot) =>
        slot.mealType === mealType ? next : slot,
      ),
    }));
    setSaving(true);
    setOperationError(null);
    try {
      await persistMeal(mealType, status, reason);
      setLastChange({ kind: "meal", mealType, previous });
      setSkipEditor(null);
      setSkipReason("");
      setAnnouncement(
        `${MEAL_SLOT_LABELS[mealType]} is now ${status.replace("_", " ")}.`,
      );
    } catch (error) {
      const publicError = apiErrorFromThrown(
        error,
        clientApiError(
          "CHECKIN_SAVE_UNAVAILABLE",
          "The meal status could not be saved.",
          "The previous status was restored. Check the connection and try again.",
          { retryable: true, action: { kind: "retry", label: "Try again" } },
        ),
      );
      replaceSelected((checkin) => ({
        ...checkin,
        slots: checkin.slots.map((slot) =>
          slot.mealType === mealType ? previous : slot,
        ),
      }));
      setOperationError(publicError);
      setAnnouncement(`${publicError.message} Error code: ${publicError.code}.`);
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    if (saving || selectedDate > today) return;
    const previous = selectedCheckin.notes ?? "";
    const fallback = clientApiError(
      "CHECKIN_NOTE_SAVE_UNAVAILABLE",
      "The note could not be saved.",
      "The previous note was restored. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try saving again" } },
    );
    setOperationError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/checkins/${selectedDate}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "note", notes: notes || null }),
      });
      if (!response.ok) {
        throw await apiErrorFromResponse(response, fallback);
      }
      replaceSelected((checkin) => ({
        ...checkin,
        notes: notes || null,
      }));
      setLastChange({ kind: "note", previous });
      setAnnouncement("The note was saved.");
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      setNotes(previous);
      setOperationError(publicError);
      setAnnouncement(`${publicError.message} Error code: ${publicError.code}.`);
    } finally {
      setSaving(false);
    }
  }

  async function undo() {
    if (!lastChange || saving) return;
    const fallback = clientApiError(
      "CHECKIN_UNDO_UNAVAILABLE",
      "Undo could not be saved.",
      "The latest saved state remains. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try undo again" } },
    );
    setOperationError(null);
    setSaving(true);
    try {
      if (lastChange.kind === "meal") {
        await persistMeal(
          lastChange.mealType,
          lastChange.previous.status,
          lastChange.previous.skipReason,
        );
        replaceSelected((checkin) => ({
          ...checkin,
          slots: checkin.slots.map((slot) =>
            slot.mealType === lastChange.mealType
              ? lastChange.previous
              : slot,
          ),
        }));
      } else {
        const response = await fetch(`/api/checkins/${selectedDate}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "note",
            notes: lastChange.previous || null,
          }),
        });
        if (!response.ok) {
          throw await apiErrorFromResponse(response, fallback);
        }
        setNotes(lastChange.previous);
        replaceSelected((checkin) => ({
          ...checkin,
          notes: lastChange.previous || null,
        }));
      }
      setLastChange(null);
      setAnnouncement("The last saved change was undone.");
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      setOperationError(publicError);
      setAnnouncement(`${publicError.message} Error code: ${publicError.code}.`);
    } finally {
      setSaving(false);
    }
  }

  const selectedSummary = summarizeMealCheckins(selectedCheckin.slots);
  const selectedSnacks = selectedCheckin.slots.filter(
    (slot) =>
      SNACK_MEAL_TYPES.includes(
        slot.mealType as (typeof SNACK_MEAL_TYPES)[number],
      ) && slot.status === "completed",
  ).length;

  return (
    <div className="page-frame">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <header className="page-header">
        <div>
          <span className="date-label">
            {initialCheckins === undefined
              ? "Mock data — development only"
              : timeZone.replaceAll("_", " ")}
          </span>
          <h1>Calendar</h1>
          <p>Review meal and optional snack check-ins by local calendar date.</p>
        </div>
        <button className="button button-quiet" type="button" onClick={() => {
          const currentMonth = today.slice(0, 7);
          if (currentMonth === month) selectDay(today);
          else void loadMonth(currentMonth, today);
        }}>Today</button>
      </header>

      {operationError ? (
        <ApiErrorNotice
          error={operationError}
          heading="We could not complete that action"
        />
      ) : null}

      <div className="calendar-layout">
        <section className="card calendar-card" aria-label={`${monthLabel(month)} calendar`}>
          <div className="calendar-toolbar">
            <button className="icon-button" aria-label="Previous month" type="button" onClick={() => void loadMonth(shiftMonth(month, -1))}><ChevronLeft size={19} /></button>
            <h2>{monthLabel(month)}</h2>
            <button className="icon-button" aria-label="Next month" type="button" onClick={() => void loadMonth(shiftMonth(month, 1))}><ChevronRight size={19} /></button>
          </div>
          <div className="calendar-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div className="weekday" key={day}>{day}</div>
            ))}
            {calendarDays.map((item) => (
              <button
                className={`calendar-day ${item.outside ? "outside" : ""} ${selectedDate === item.localDate ? "selected" : ""}`}
                key={item.localDate}
                type="button"
                aria-label={`${fullDateLabel(item.localDate)}, ${item.marked} of 3 planned meals marked${item.snacks ? `, ${item.snacks} snacks recorded` : ""}`}
                aria-pressed={selectedDate === item.localDate}
                disabled={item.outside}
                onClick={() => selectDay(item.localDate)}
              >
                <span className="day-number">{item.label}</span>
                <span className="meal-dots" aria-hidden="true">
                  {[0, 1, 2].map((dot) => <i className={dot < item.marked ? "complete" : ""} key={dot} />)}
                </span>
                {!item.outside ? <span className="completion-copy">{item.marked} of 3{item.snacks ? ` · +${item.snacks}` : ""}</span> : null}
              </button>
            ))}
          </div>
        </section>

        <aside className="card selected-day-panel">
          <span className="date-label">Selected day</span>
          <h2>{fullDateLabel(selectedDate)}</h2>
          <p>
            {selectedSummary.marked} of 3 planned meals marked
            {selectedSummary.skipped ? ` · ${selectedSummary.skipped} skipped` : ""}
            {selectedSnacks ? ` · ${selectedSnacks} snacks recorded` : ""}
          </p>
          <div className="day-meal-list">
            {selectedCheckin.slots.map((slot) => (
              <div className="day-meal" key={slot.mealType}>
                <div>
                  <strong>{MEAL_SLOT_LABELS[slot.mealType]}</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
                    <button
                      className={`check-button ${slot.status === "completed" ? "complete" : ""}`}
                      type="button"
                      disabled={saving || selectedDate > today}
                      aria-pressed={slot.status === "completed"}
                      onClick={() =>
                        void setMeal(
                          slot.mealType,
                          slot.status === "completed"
                            ? "not_marked"
                            : "completed",
                        )
                      }
                    >
                      {slot.status === "completed" ? <Check size={15} /> : <Circle size={14} />}
                      {slot.status === "completed" ? "Completed" : "Mark completed"}
                    </button>
                    <button
                      className="button button-quiet"
                      disabled={saving || selectedDate > today}
                      onClick={() => {
                        if (slot.status === "skipped") {
                          void setMeal(slot.mealType, "not_marked");
                        } else {
                          setSkipEditor(slot.mealType);
                          setSkipReason("");
                        }
                      }}
                      type="button"
                    >
                      {slot.status === "skipped" ? "Return to not marked" : "Skip"}
                    </button>
                  </div>
                </div>
                <span className="field-help">
                  {slot.status === "skipped"
                    ? `Skipped${slot.skipReason ? ` · ${slot.skipReason}` : " · no reason provided"}`
                    : SNACK_MEAL_TYPES.includes(slot.mealType as (typeof SNACK_MEAL_TYPES)[number])
                      ? "Optional snack space. Add foods from Today."
                      : "Plan details remain on My Plan."}
                </span>
                {skipEditor === slot.mealType ? (
                  <div>
                    <label className="field">
                      <span className="field-label">Optional skip reason</span>
                      <input
                        maxLength={500}
                        onChange={(event) => setSkipReason(event.target.value)}
                        placeholder="You can leave this blank"
                        value={skipReason}
                      />
                    </label>
                    <div className="header-actions">
                      <button
                        className="button button-dark"
                        disabled={saving}
                        onClick={() => void setMeal(slot.mealType, "skipped", skipReason.trim() || null)}
                        type="button"
                      >
                        Save skipped status
                      </button>
                      <button className="button button-quiet" onClick={() => setSkipEditor(null)} type="button">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <label className="field" style={{ marginTop: "1rem" }}>
            <span className="field-label">Optional note</span>
            <textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add context for your future self…" />
          </label>
          <button className="button button-dark form-submit" disabled={saving || selectedDate > today} type="button" onClick={saveNotes}>
            Save note
          </button>
          <button className="button button-quiet form-submit" disabled={!lastChange || saving} type="button" onClick={undo}>
            <Undo2 size={16} /> Undo last saved change
          </button>
          {selectedDate > today ? <p className="field-help">Future meal completion is disabled.</p> : null}
        </aside>
      </div>
    </div>
  );
}
