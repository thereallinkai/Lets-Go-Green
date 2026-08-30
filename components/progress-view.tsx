"use client";

import { useMemo, useRef, useState } from "react";
import { Edit3, Scale, Trash2, TrendingDown } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { LazyWeightTrendChart } from "@/components/lazy-weight-trend-chart";
import { addLocalDays, localDateInTimeZone } from "@/src/lib/domain/dates";
import { buildSevenDayRollingAverageSeries } from "@/src/lib/domain/trends";
import { convertWeight } from "@/src/lib/domain/units";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromResponse,
  apiErrorFromThrown,
  clientApiError,
} from "@/src/lib/client-api-error";

const RANGE_OPTIONS = [
  { key: "4-weeks", label: "4 weeks", days: 28 },
  { key: "12-weeks", label: "12 weeks", days: 84 },
  { key: "all", label: "All", days: null },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProgressEntry = {
  id: string;
  date: string;
  isoDate: string;
  kg: number;
  isBaseline?: boolean;
};

const demoEntries: ProgressEntry[] = [
  { id: "00000000-0000-4000-8000-000000000101", date: "Jul 24", isoDate: "2026-07-24", kg: 80.7 },
  { id: "00000000-0000-4000-8000-000000000102", date: "Jul 23", isoDate: "2026-07-23", kg: 80.8 },
  { id: "00000000-0000-4000-8000-000000000103", date: "Jul 22", isoDate: "2026-07-22", kg: 80.9 },
  { id: "00000000-0000-4000-8000-000000000104", date: "Jul 21", isoDate: "2026-07-21", kg: 81.0 },
  { id: "00000000-0000-4000-8000-000000000105", date: "Jul 19", isoDate: "2026-07-19", kg: 81.3 },
  { id: "00000000-0000-4000-8000-000000000106", date: "Jul 18", isoDate: "2026-07-18", kg: 81.2 },
  { id: "00000000-0000-4000-8000-000000000107", date: "Jul 17", isoDate: "2026-07-17", kg: 81.4 },
];

function labelForDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function displayWeight(kg: number, unit: "kg" | "lb") {
  const amount = convertWeight(kg, "kg", unit);
  return `${amount.toFixed(1)} ${unit}`;
}

function isPersistedWeightId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function ProgressView({
  initialEntries,
  baselineKg,
  targetKg = 76,
  preferredUnit = "kg",
  timeZone = "America/New_York",
}: {
  initialEntries?: ProgressEntry[];
  baselineKg?: number | null;
  targetKg?: number | null;
  preferredUnit?: "kg" | "lb";
  timeZone?: string;
}) {
  const [entries, setEntries] = useState(
    (initialEntries ?? demoEntries).toSorted((a, b) =>
      b.isoDate.localeCompare(a.isoDate),
    ),
  );
  const [unit, setUnit] = useState<"kg" | "lb">(preferredUnit);
  const [value, setValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ProgressEntry | null>(
    null,
  );
  const [range, setRange] = useState<RangeKey>("4-weeks");
  const [message, setMessage] = useState("");
  const [operationError, setOperationError] = useState<ApiError | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const mutationSequenceRef = useRef(0);
  const activeMutationRef = useRef<number | null>(null);
  const todayIso = localDateInTimeZone(new Date(), timeZone);
  const selectedRange =
    RANGE_OPTIONS.find((option) => option.key === range) ?? RANGE_OPTIONS[0];
  const visibleEntries = useMemo(() => {
    if (!entries.length || selectedRange.days === null) return entries;
    const newestDate = entries[0].isoDate;
    const firstDate = addLocalDays(newestDate, -(selectedRange.days - 1));
    return entries.filter((entry) => entry.isoDate >= firstDate);
  }, [entries, selectedRange.days]);
  const chartData = useMemo(() => {
    if (!visibleEntries.length) return [];
    const oldestDate = visibleEntries.at(-1)!.isoDate;
    const newestDate = visibleEntries[0].isoDate;
    return buildSevenDayRollingAverageSeries(
      entries.map((entry) => ({
        localDate: entry.isoDate,
        weightKg: entry.kg,
      })),
      { startDate: oldestDate, endDate: newestDate },
    ).map((point) => ({
      day: labelForDate(point.localDate),
      isoDate: point.localDate,
      weight: point.weightKg,
      rollingAverage: point.rollingAverageKg,
    }));
  }, [entries, visibleEntries]);
  const rollingAveragePoints = chartData.filter(
    (point) => point.rollingAverage !== null,
  );
  const latestRollingAverage =
    rollingAveragePoints.at(-1)?.rollingAverage ?? null;
  const latest = entries[0] ?? null;
  const start = baselineKg ?? entries.at(-1)?.kg ?? null;
  const change = latest && start !== null ? latest.kg - start : null;
  const todayIsProtectedBaseline = entries.some(
    (entry) => entry.isBaseline && entry.isoDate === todayIso,
  );

  function beginMutation() {
    if (activeMutationRef.current !== null) return null;
    const token = mutationSequenceRef.current + 1;
    mutationSequenceRef.current = token;
    activeMutationRef.current = token;
    setMutationPending(true);
    return token;
  }

  function mutationIsCurrent(token: number) {
    return activeMutationRef.current === token;
  }

  function finishMutation(token: number) {
    if (!mutationIsCurrent(token)) return;
    activeMutationRef.current = null;
    setMutationPending(false);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (activeMutationRef.current !== null) return;
    const parsed = Number(value);
    if (
      !Number.isFinite(parsed) ||
      parsed <= 0 ||
      parsed > (unit === "kg" ? 500 : 1102)
    ) {
      setMessage("Enter a valid weight greater than zero.");
      return;
    }
    const kg = convertWeight(parsed, unit, "kg");
    const fallback = clientApiError(
      "WEIGHT_SAVE_UNAVAILABLE",
      "The weight entry could not be saved.",
      "Your previous history was restored. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try saving again" } },
    );
    setOperationError(null);
    const targetEditingId = editingId;
    const existing = entries.find((entry) => entry.id === targetEditingId);
    const next: ProgressEntry = existing
      ? { ...existing, kg: Number(kg.toFixed(3)) }
      : {
          id: crypto.randomUUID(),
          date: labelForDate(todayIso),
          isoDate: todayIso,
          kg: Number(kg.toFixed(3)),
        };
    const previous = entries;
    const mutationToken = beginMutation();
    if (mutationToken === null) return;
    setEntries(
      [next, ...entries.filter((entry) =>
        targetEditingId
          ? entry.id !== targetEditingId
          : entry.isoDate !== todayIso,
      )].toSorted((a, b) => b.isoDate.localeCompare(a.isoDate)),
    );
    setMessage("Saving…");
    try {
      const response = await fetch(
        targetEditingId
          ? `/api/weights/${targetEditingId}`
          : "/api/weights",
        {
          method: targetEditingId ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            targetEditingId
              ? { weight: parsed, unit }
              : { localDate: todayIso, weight: parsed, unit },
          ),
        },
      );
      if (!response.ok) {
        throw await apiErrorFromResponse(response, fallback);
      }
      if (!mutationIsCurrent(mutationToken)) return;
      const result =
        typeof response.json === "function"
          ? await response.json().catch(() => null)
          : null;
      if (!mutationIsCurrent(mutationToken)) return;
      const savedId = result?.data?.id;
      if (!targetEditingId && !isPersistedWeightId(savedId)) {
        throw clientApiError(
          "WEIGHT_SAVE_RESPONSE_INVALID",
          "The saved weight could not be confirmed.",
          "The server may have saved this reading, but it did not return a valid identifier. Refresh Progress before trying again.",
          {
            retryable: true,
            action: {
              kind: "navigate",
              label: "Refresh Progress",
              href: "/progress",
            },
          },
        );
      }
      if (!targetEditingId) {
        setEntries((current) =>
          current.map((entry) =>
            entry.id === next.id ? { ...entry, id: savedId } : entry,
          ),
        );
      }
      setMessage(`Saved ${parsed.toFixed(1)} ${unit}.`);
      setValue("");
      setEditingId(null);
    } catch (error) {
      if (!mutationIsCurrent(mutationToken)) return;
      const publicError = apiErrorFromThrown(error, fallback);
      setEntries(previous);
      setOperationError(publicError);
      setMessage(
        publicError.code === "WEIGHT_SAVE_RESPONSE_INVALID"
          ? "The saved entry could not be confirmed. Refresh Progress before trying again."
          : "The entry could not be saved. Your previous history was restored.",
      );
    } finally {
      finishMutation(mutationToken);
    }
  }

  async function remove(entry: ProgressEntry) {
    if (activeMutationRef.current !== null) return;
    if (entry.isBaseline) {
      setMessage(
        "The onboarding starting weight is protected. Remove or edit a later reading instead.",
      );
      return;
    }
    const previous = entries;
    const fallback = clientApiError(
      "WEIGHT_DELETE_UNAVAILABLE",
      "The weight entry could not be removed.",
      "Your previous history was restored. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try removing again" } },
    );
    const mutationToken = beginMutation();
    if (mutationToken === null) return;
    setOperationError(null);
    setEntries((current) => current.filter((item) => item.id !== entry.id));
    setMessage(`Removing ${entry.date}…`);
    try {
      const response = await fetch(`/api/weights/${entry.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw await apiErrorFromResponse(response, fallback);
      }
      if (!mutationIsCurrent(mutationToken)) return;
      setMessage(`Removed the ${entry.date} entry.`);
      if (editingId === entry.id) {
        setEditingId(null);
        setValue("");
      }
    } catch (error) {
      if (!mutationIsCurrent(mutationToken)) return;
      const publicError = apiErrorFromThrown(error, fallback);
      setEntries(previous);
      setOperationError(publicError);
      setMessage(
        "The entry could not be removed. Your previous history was restored.",
      );
    } finally {
      finishMutation(mutationToken);
    }
  }

  function edit(entry: ProgressEntry) {
    if (activeMutationRef.current !== null) return;
    if (entry.isBaseline) {
      setMessage(
        "The onboarding starting weight is protected. Add or edit a later reading instead.",
      );
      return;
    }
    setEditingId(entry.id);
    setOperationError(null);
    setValue(convertWeight(entry.kg, "kg", unit).toFixed(1));
    setMessage(`Editing the ${entry.date} entry.`);
  }

  function onValueChange(next: string) {
    setValue(next);
    setMessage("");
    setOperationError(null);
  }

  function changeUnit(nextUnit: "kg" | "lb") {
    if (value) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        const converted = convertWeight(numeric, unit, nextUnit);
        setValue(converted.toFixed(1));
      }
    }
    setUnit(nextUnit);
  }

  return (
    <div className="page-frame">
      <header className="page-header">
        <div>
          <span className="date-label">
            {initialEntries === undefined
              ? "Mock data — development only"
              : "Trend context, not daily judgment"}
          </span>
          <h1>Progress</h1>
          <p>Missing days remain gaps. One reading never changes your plan.</p>
        </div>
      </header>

      {operationError ? (
        <ApiErrorNotice
          error={operationError}
          heading="We could not update progress"
        />
      ) : null}

      <section className="progress-summary" aria-label="Progress summary">
        {[
          [
            "Latest",
            latest ? displayWeight(latest.kg, unit) : "No entry yet",
            latest?.date ?? "Add a reading when helpful",
          ],
          [
            "Start",
            start === null ? "Unavailable" : displayWeight(start, unit),
            "Provided by you",
          ],
          [
            "Change",
            change === null
              ? "Insufficient data"
              : `${change > 0 ? "+" : "−"}${displayWeight(Math.abs(change), unit)}`,
            "Calculated by the app",
          ],
          [
            "Target",
            targetKg === null ? "Not set" : displayWeight(targetKg, unit),
            latest && targetKg !== null
              ? `${displayWeight(Math.abs(latest.kg - targetKg), unit)} away`
              : "Add more data for context",
          ],
        ].map(([label, amount, note]) => (
          <article className="card summary-stat" key={label}>
            <span>{label}</span><strong>{amount}</strong><small>{note}</small>
          </article>
        ))}
      </section>

      <div className="progress-content">
        <section className="today-primary">
          <article className="card">
            <div className="card-title">
              <div><h2>Weight trend</h2><p>Daily readings with a goal reference</p></div>
              <span className="source-label"><TrendingDown size={14} /> Calculated by the app</span>
            </div>
            <div
              className="day-tabs"
              role="group"
              aria-label="Weight history range"
            >
              {RANGE_OPTIONS.map((option) => (
                <button
                  aria-pressed={range === option.key}
                  className={`day-tab ${range === option.key ? "active" : ""}`}
                  key={option.key}
                  onClick={() => setRange(option.key)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            {visibleEntries.length ? (
              <>
                <div
                  className="chart-wrap"
                  style={{ height: 290 }}
                  role="img"
                  aria-label={`${visibleEntries.length} weight reading${visibleEntries.length === 1 ? " is" : "s are"} shown for ${selectedRange.label}. Missing dates remain gaps, never zero.`}
                >
                  <LazyWeightTrendChart
                    data={chartData}
                    kind="progress"
                    targetKg={targetKg}
                  />
                </div>
                <p className="chart-alt">
                  {visibleEntries.length} reading{visibleEntries.length === 1 ? " is" : "s are"} available in this range. Missing dates remain gaps. Changes can reflect hydration, digestion, and other factors.
                </p>
                {latestRollingAverage === null ? (
                  <p className="chart-alt">Not enough data for a seven-day trend.</p>
                ) : (
                  <p className="chart-alt">
                    The latest seven-day average is{" "}
                    {latestRollingAverage.toFixed(1)} kg.
                  </p>
                )}
              </>
            ) : (
              <div className="empty-state">
                <strong>No weight entries yet.</strong>
                <p>Add a reading when it feels useful; missing days stay empty.</p>
              </div>
            )}
          </article>
        </section>

        <aside className="today-side">
          <article className="card">
            <div className="card-title"><div><h2>{editingId ? "Edit weight" : "Add weight"}</h2><p>{labelForDate(todayIso)}</p></div><Scale size={20} /></div>
            <form className="entry-form" onSubmit={save}>
              <div className="input-row">
                <label className="field">
                  <span className="field-label">Weight</span>
                  <input
                    disabled={mutationPending}
                    inputMode="decimal"
                    value={value}
                    onChange={(event) => onValueChange(event.target.value)}
                    placeholder={unit === "kg" ? "80.7" : "177.9"}
                    required
                  />
                </label>
                <label className="field">
                  <span className="field-label">Unit</span>
                  <select disabled={mutationPending} value={unit} onChange={(event) => changeUnit(event.target.value as "kg" | "lb")}>
                    <option value="kg">kg</option>
                    <option value="lb">lb</option>
                  </select>
                </label>
              </div>
              {value && Number.isFinite(Number(value)) ? (
                <p className="field-help">
                  Equivalent: {convertWeight(Number(value), unit, unit === "kg" ? "lb" : "kg").toFixed(1)} {unit === "kg" ? "lb" : "kg"}
                </p>
              ) : null}
              {todayIsProtectedBaseline && !editingId ? (
                <p className="field-help">
                  Today&apos;s reading is your protected onboarding starting
                  weight. Add the next reading on a later day.
                </p>
              ) : null}
              {message ? <p className={message.includes("could not") || message.startsWith("Enter") ? "field-error" : "field-help"} role="status">{message}</p> : null}
              <button
                className="button button-dark form-submit"
                disabled={
                  mutationPending ||
                  (todayIsProtectedBaseline && !editingId)
                }
                type="submit"
              >
                {editingId ? "Save changes" : "Save entry"}
              </button>
              {editingId ? (
                <button className="button button-quiet form-submit" disabled={mutationPending} type="button" onClick={() => { setEditingId(null); setValue(""); setMessage("Edit cancelled."); }}>
                  Cancel edit
                </button>
              ) : null}
            </form>
          </article>

          <article className="card">
            <div className="card-title"><div><h2>Entries in range</h2><p>One entry per local date · {selectedRange.label}</p></div></div>
            <div className="history-list">
              {visibleEntries.map((entry) => (
                <div className="history-row" key={entry.id}>
                  <span>{entry.date}</span>
                  <strong>{displayWeight(entry.kg, unit)}</strong>
                  {entry.isBaseline ? (
                    <span title="This starting point anchors plan history and cannot be edited or deleted.">
                      Starting point · protected
                    </span>
                  ) : (
                    <span>
                      <button className="icon-button" aria-label={`Edit weight for ${entry.date}`} disabled={mutationPending} type="button" onClick={() => edit(entry)}><Edit3 size={15} /></button>
                      <button className="icon-button" aria-haspopup="dialog" aria-label={`Delete weight for ${entry.date}`} disabled={mutationPending} type="button" onClick={() => setDeleteCandidate(entry)}><Trash2 size={15} /></button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </article>
        </aside>
      </div>

      <Dialog.Root
        open={deleteCandidate !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteCandidate(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>Delete weight entry?</Dialog.Title>
            <Dialog.Description>
              {deleteCandidate
                ? `Delete the ${deleteCandidate.date} entry of ${displayWeight(deleteCandidate.kg, unit)}? This cannot be undone.`
                : "Confirm deletion of this weight entry."}
            </Dialog.Description>
            <div
              className="header-actions"
              style={{ justifyContent: "flex-end", marginTop: "1rem" }}
            >
              <Dialog.Close asChild>
                <button className="button button-quiet" disabled={mutationPending} type="button">
                  Keep entry
                </button>
              </Dialog.Close>
              <button
                className="button button-dark"
                disabled={mutationPending}
                type="button"
                onClick={() => {
                  if (!deleteCandidate) return;
                  const entry = deleteCandidate;
                  setDeleteCandidate(null);
                  void remove(entry);
                }}
              >
                Delete entry
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
