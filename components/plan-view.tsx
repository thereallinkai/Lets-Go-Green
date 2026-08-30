"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleAlert,
  Clock3,
  Droplets,
  History,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error-notice";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromResponse,
  apiErrorFromPayload,
  apiErrorFromThrown,
  clientApiError,
} from "@/src/lib/client-api-error";
import { interpretPlanGenerationResponse } from "@/src/lib/plan-generation-response";
import {
  getBrowserStorage,
  readStorageValue,
  removeStorageValue,
  writeStorageValue,
} from "@/src/lib/browser-storage";

type PlanFoodDisplay = [
  name: string,
  quantity: string,
  basis: string,
  verification: string,
  preparationNote?: string | null,
  substitutionGroup?: string | null,
];

type PlanMealDisplay = {
  title: string;
  summary: string;
  foods: PlanFoodDisplay[];
};

const PLAN_GENERATION_RECOVERY_KEY =
  "lets-go-green-plan-generation-idempotency-key";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export type PlanDayDisplay = {
  label: string;
  meals: PlanMealDisplay[];
};

export type PlanHistoryDisplay = {
  id: string;
  version: number;
  status: string;
  date: string;
  reviewable: boolean;
};

const demoMeals: PlanMealDisplay[] = [
  {
    title: "Breakfast",
    summary: "Mock meal composition — no live nutrition total is shown.",
    foods: [
      ["Rolled oats", "70 g", "dry", "Verified"],
      ["Eggs", "100 g", "as sold", "Verified"],
      ["Blueberries", "100 g", "raw", "Verified"],
    ],
  },
  {
    title: "Lunch",
    summary: "Mock meal composition — no live nutrition total is shown.",
    foods: [
      ["Brown rice", "220 g", "cooked", "Verified"],
      ["Chicken breast", "180 g", "cooked", "Verified"],
      ["Broccoli", "160 g", "cooked", "Verified"],
      ["Olive oil", "12 g", "as sold", "Verified"],
    ],
  },
  {
    title: "Dinner",
    summary: "Mock meal composition — no live nutrition total is shown.",
    foods: [
      ["Tofu", "180 g", "as sold", "Verified"],
      ["Potatoes", "280 g", "cooked", "Verified"],
      ["Spinach", "120 g", "cooked", "Verified"],
    ],
  },
];

const demoDays: PlanDayDisplay[] = Array.from({ length: 7 }, (_, index) => ({
  label: `Day ${index + 1}`,
  meals: demoMeals,
}));

export function PlanView({
  initialPlanId = null,
  initialStatus = "accepted",
  version = 2,
  acceptedVersion = 2,
  acceptedLabel = "Accepted July 20",
  providerLabel = "Mock AI plan — development only",
  days = demoDays,
  energyRange = { minimum: 2_050, maximum: 2_250 },
  proteinRange = { minimum: 130, maximum: 155 },
  goalAssessment = "This development example shows how a validated assessment will appear. It is not a guarantee.",
  startWeightKg = 82,
  targetWeightKg = 76,
  assumptions = [
    "Only application-approved foods may be selected.",
    "Unavailable nutrients remain pending rather than being estimated.",
  ],
  hydrationGuidance = "Keep water available with meals and adjust for weather, exercise, and professional guidance.",
  majorReasons = [
    "The rotation uses familiar foods across three daily meals.",
    "Portions stay within application-defined bounds.",
  ],
  weeklyReviewRules = [
    "Review complete trends and meal check-ins weekly rather than reacting to one reading.",
  ],
  safetyNotes = [
    "This plan provides general wellness information and is not medical advice.",
  ],
  serverBacked = false,
  history = [
    {
      id: "mock-plan-v2",
      version: 2,
      status: "Accepted",
      date: "July 20",
      reviewable: true,
    },
    {
      id: "mock-plan-v1",
      version: 1,
      status: "Superseded",
      date: "July 13",
      reviewable: true,
    },
  ],
}: {
  initialPlanId?: string | null;
  initialStatus?: "accepted" | "draft" | "historical";
  version?: number;
  acceptedVersion?: number | null;
  acceptedLabel?: string;
  providerLabel?: string;
  days?: PlanDayDisplay[];
  energyRange?: { minimum: number; maximum: number } | null;
  proteinRange?: { minimum: number; maximum: number } | null;
  goalAssessment?: string;
  startWeightKg?: number | null;
  targetWeightKg?: number | null;
  assumptions?: string[];
  hydrationGuidance?: string;
  majorReasons?: string[];
  weeklyReviewRules?: string[];
  safetyNotes?: string[];
  serverBacked?: boolean;
  history?: PlanHistoryDisplay[];
}) {
  const router = useRouter();
  const tabIdPrefix = useId();
  const [day, setDay] = useState(0);
  const [status, setStatus] = useState<
    "accepted" | "generating" | "draft" | "historical"
  >(initialStatus);
  const [reviewPlanId, setReviewPlanId] = useState<string | null>(
    initialStatus === "accepted" ? null : initialPlanId,
  );
  const [accepting, setAccepting] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [operationError, setOperationError] = useState<ApiError | null>(null);
  const [generationPending, setGenerationPending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const generationKeyRef = useRef<string | null>(null);
  const activeDayIndex = days.length ? Math.min(day, days.length - 1) : 0;
  const activeDay = days[activeDayIndex] ?? { label: "Day 1", meals: [] };
  const panelId = `${tabIdPrefix}-panel`;
  const activeTabId = days.length
    ? `${tabIdPrefix}-tab-${activeDayIndex}`
    : undefined;

  function clearGenerationKey() {
    generationKeyRef.current = null;
    removeStorageValue(
      getBrowserStorage("sessionStorage"),
      PLAN_GENERATION_RECOVERY_KEY,
    );
  }

  async function generate() {
    const fallback = clientApiError(
      "PLAN_GENERATION_UNAVAILABLE",
      "Plan generation could not finish.",
      "Your accepted plan is unchanged. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try generating again" } },
    );
    setOperationError(null);
    setGenerationPending(false);
    setStatus("generating");
    setAnnouncement("Plan generation started. You may navigate away safely.");
    try {
      const session = getBrowserStorage("sessionStorage");
      const storedKey = readStorageValue(
        session,
        PLAN_GENERATION_RECOVERY_KEY,
      );
      const idempotencyKey =
        generationKeyRef.current ??
        (storedKey && IDEMPOTENCY_KEY_PATTERN.test(storedKey)
          ? storedKey
          : crypto.randomUUID());
      generationKeyRef.current = idempotencyKey;
      writeStorageValue(
        session,
        PLAN_GENERATION_RECOVERY_KEY,
        idempotencyKey,
      );
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      });
      const payload =
        typeof response.json === "function"
          ? await response.json().catch(() => null)
          : null;
      const decision = interpretPlanGenerationResponse({
        ok: response.ok,
        status: response.status,
        payload,
      });
      if (
        decision.kind === "terminal_failure" ||
        decision.kind === "ambiguous_failure"
      ) {
        const publicError =
          response.ok && decision.kind === "ambiguous_failure"
            ? clientApiError(
                "PLAN_RESPONSE_INVALID",
                "The generated plan response was incomplete.",
                "Your accepted plan is unchanged. Check the same generation request again.",
                {
                  retryable: true,
                  action: {
                    kind: "retry",
                    label: "Check generation again",
                  },
                },
              )
            : apiErrorFromPayload(payload, fallback);
        if (decision.kind === "terminal_failure") {
          clearGenerationKey();
        }
        throw publicError;
      }
      if (decision.kind === "pending") {
        setStatus(initialStatus);
        setGenerationPending(true);
        setAnnouncement(
          "Plan generation is still processing. Check the same request again shortly.",
        );
        return;
      }
      clearGenerationKey();
      if (serverBacked) {
        setAnnouncement("A new draft is ready. Loading it for review.");
        router.replace("/plan");
        router.refresh();
        return;
      }
      setReviewPlanId(decision.planId);
      setStatus("draft");
      setAnnouncement(
        "A new draft is ready. Your accepted plan has not changed.",
      );
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      setStatus(initialStatus);
      setGenerationPending(false);
      setOperationError(publicError);
      setAnnouncement(
        "Plan generation could not finish. Your accepted plan is unchanged.",
      );
    }
  }

  async function acceptDraft() {
    if (!reviewPlanId || accepting) return;
    const fallback = clientApiError(
      "PLAN_ACCEPT_UNAVAILABLE",
      "This version could not be accepted.",
      "Your current accepted plan is unchanged. Check the connection and try again.",
      { retryable: true, action: { kind: "retry", label: "Try accepting again" } },
    );
    setOperationError(null);
    setAccepting(true);
    try {
      const response = await fetch(
        `/api/plans/${encodeURIComponent(reviewPlanId)}/accept`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw await apiErrorFromResponse(response, fallback);
      }
      const acceptedHistoricalVersion = status === "historical";
      setStatus("accepted");
      setReviewPlanId(null);
      setAnnouncement(
        acceptedHistoricalVersion
          ? "The prior version is now the current accepted plan."
          : "Draft accepted as the current plan.",
      );
      if (serverBacked) {
        router.replace("/plan?view=accepted");
        router.refresh();
      }
    } catch (error) {
      const publicError = apiErrorFromThrown(error, fallback);
      setOperationError(publicError);
      setAnnouncement(
        "This version could not be accepted. Your current accepted plan is unchanged.",
      );
    } finally {
      setAccepting(false);
    }
  }

  function keepAcceptedPlan() {
    if (serverBacked) {
      setAnnouncement("Loading your accepted plan.");
      router.replace("/plan?view=accepted");
      router.refresh();
      return;
    }
    setStatus(initialStatus);
    setReviewPlanId(initialStatus === "accepted" ? null : initialPlanId);
    setAnnouncement("Your accepted plan remains unchanged.");
  }

  function onDayTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!days.length) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % days.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + days.length) % days.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = days.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setDay(nextIndex);
    document.getElementById(`${tabIdPrefix}-tab-${nextIndex}`)?.focus();
  }

  return (
    <div className="page-frame">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <header className="page-header">
        <div>
          <span className="date-label">
            {version > 0
              ? `Plan version ${version} · ${
                  status === "draft"
                  || (status === "generating" && initialStatus === "draft")
                    ? "Draft"
                    : status === "historical" ||
                        (status === "generating" &&
                          initialStatus === "historical")
                      ? "Superseded · historical version"
                      : acceptedLabel
                }`
              : "No generated plan"}
          </span>
          <h1>My Plan</h1>
          <p>A seven-day meal rhythm shaped around your stated preferences.</p>
        </div>
        <div className="header-actions">
          <button
            aria-controls="plan-version-history"
            aria-expanded={showHistory}
            className="button button-quiet"
            onClick={() => setShowHistory((visible) => !visible)}
            type="button"
          >
            <History size={17} aria-hidden="true" /> Version history
          </button>
          <button className="button button-dark" disabled={status === "generating"} onClick={generate} type="button">
            <RotateCcw size={17} aria-hidden="true" />
            {status === "generating" ? "Generating draft…" : "Generate new draft"}
          </button>
        </div>
      </header>

      {operationError ? (
        <ApiErrorNotice
          error={operationError}
          heading="We could not complete that plan action"
        />
      ) : null}

      {generationPending ? (
        <div className="message-box" role="status">
          <Clock3 size={18} aria-hidden="true" />
          <span>
            Plan generation is still processing. Wait a moment, then choose
            Generate new draft again to check the same request.
          </span>
        </div>
      ) : null}

      {showHistory ? (
        <section id="plan-version-history" className="card" aria-label="Plan version history" style={{ marginBottom: "1rem" }}>
          <div className="card-title">
            <div>
              <h2>Version history</h2>
              <p>Generated plans remain separate until one is accepted.</p>
            </div>
          </div>
          {history.length ? (
            <ol style={{ margin: 0, paddingLeft: "1.3rem" }}>
              {history.map((entry) => (
                <li
                  key={entry.id}
                  style={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: ".75rem",
                    justifyContent: "space-between",
                  }}
                >
                  <span>
                    Version {entry.version} · {entry.status} · {entry.date}
                  </span>
                  {entry.id === initialPlanId ? (
                    <span aria-current="page" className="field-help">
                      Viewing
                    </span>
                  ) : serverBacked && entry.reviewable ? (
                    <Link
                      aria-label={`Review plan version ${entry.version}`}
                      className="text-link"
                      href={`/plan?version=${entry.version}`}
                    >
                      Review
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="field-help">No plan versions have been generated.</p>
          )}
        </section>
      ) : null}

      <div className="plan-notice" role="status">
        <Sparkles size={17} aria-hidden="true" />
        <div>
          <strong>{providerLabel}</strong>
          <br />
          Suggestions are validated before persistence. Nutrition totals are calculated by the application.
        </div>
      </div>

      {status === "draft" ? (
        <div className="message-box" role="status" style={{ marginBottom: "1rem" }}>
          <CircleAlert size={18} aria-hidden="true" />
          <span>
            A new draft is ready for review.
            {acceptedVersion
              ? ` Version ${acceptedVersion} remains accepted until you explicitly replace it.`
              : " No version becomes current until you explicitly accept it."}
          </span>
        </div>
      ) : null}
      {status === "historical" ? (
        <div className="message-box" role="status" style={{ marginBottom: "1rem" }}>
          <History size={18} aria-hidden="true" />
          <span>
            You are reviewing an earlier plan version.
            {acceptedVersion
              ? ` Version ${acceptedVersion} remains accepted unless you explicitly replace it.`
              : " No version becomes current until you explicitly accept one."}
          </span>
        </div>
      ) : null}

      <section className="plan-overview" aria-label="Plan overview">
        <article className="range-card">
          <div className="card-title">
            <div><h2>Estimated daily range</h2><p>Calculated by the app · Estimator v1</p></div>
            <span className="source-label" style={{ color: "#d5dfdc" }}><Clock3 size={14} /> 7-day rotation</span>
          </div>
          <div className="range-grid">
            <div><span>Energy</span><strong>{energyRange ? `${energyRange.minimum.toLocaleString()}–${energyRange.maximum.toLocaleString()} kcal` : "Insufficient data"}</strong></div>
            <div><span>Protein</span><strong>{proteinRange ? `${proteinRange.minimum}–${proteinRange.maximum} g` : "Insufficient data"}</strong></div>
          </div>
        </article>
        <article className="card">
          <div className="card-title"><div><h2>Goal assessment</h2><p>Suggested by AI · checked by application rules</p></div></div>
          <p style={{ margin: "0 0 1rem", color: "var(--ink-soft)", fontSize: ".86rem" }}>
            {goalAssessment}
          </p>
          <div className="metric-grid">
            <div className="metric"><span>Start</span><strong>{startWeightKg === null ? "Unavailable" : `${startWeightKg.toFixed(1)} kg`}</strong></div>
            <div className="metric"><span>Target</span><strong>{targetWeightKg === null ? "Unavailable" : `${targetWeightKg.toFixed(1)} kg`}</strong></div>
          </div>
        </article>
      </section>

      <div className="day-tabs" role="tablist" aria-label="Plan day">
        {days.map((planDay, index) => (
          <button
            className={`day-tab ${activeDayIndex === index ? "active" : ""}`}
            id={`${tabIdPrefix}-tab-${index}`}
            key={`${planDay.label}-${index}`}
            role="tab"
            aria-selected={activeDayIndex === index}
            aria-controls={panelId}
            onClick={() => setDay(index)}
            onKeyDown={(event) => onDayTabKeyDown(event, index)}
            tabIndex={activeDayIndex === index ? 0 : -1}
            type="button"
          >
            {planDay.label}
          </button>
        ))}
      </div>

      <section
        id={panelId}
        className="plan-meals"
        role="tabpanel"
        aria-label={activeTabId ? undefined : "Plan meals"}
        aria-labelledby={activeTabId}
        tabIndex={0}
      >
        {activeDay.meals.length === 0 ? (
          <article className="card">
            <h2>No plan meals yet</h2>
            <p className="field-help">
              Generate a draft after completing onboarding. It will remain a draft
              until you explicitly accept it.
            </p>
          </article>
        ) : activeDay.meals.map((meal) => (
          <article className="plan-meal-card" key={meal.title}>
            <h3>{meal.title}</h3>
            <p>{meal.summary}</p>
            {meal.foods.map(([
              name,
              quantity,
              basis,
              verification,
              preparationNote,
              substitutionGroup,
            ], index) => (
              <div className="food-line" key={`${name}-${index}`}>
                <div><strong>{name}</strong><span>{quantity}</span></div>
                <div>
                  <span className="basis-badge">{basis.replaceAll("_", " ")}</span>
                  <small className={verification === "Pending verification" ? "source-label pending" : ""}>
                    {verification}
                  </small>
                </div>
                {preparationNote || substitutionGroup ? (
                  <small>
                    Suggested by AI
                    {preparationNote ? ` · Preparation: ${preparationNote}` : ""}
                    {substitutionGroup
                      ? ` · Substitution group: ${substitutionGroup}`
                      : ""}
                  </small>
                ) : null}
              </div>
            ))}
          </article>
        ))}
      </section>

      <section
        className="plan-overview"
        style={{ marginTop: "1rem" }}
        aria-label="Plan rationale and safety notes"
      >
        <article className="card">
          <div className="card-title">
            <div>
              <h2>Major recommendation reasons</h2>
              <p>Suggested by AI</p>
            </div>
          </div>
          {majorReasons.length ? (
            <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--ink-soft)", fontSize: ".82rem" }}>
              {majorReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          ) : (
            <p className="field-help">No recommendation reasons are available.</p>
          )}
        </article>
        <article className="card">
          <div className="card-title">
            <div>
              <h2>Safety notes</h2>
              <p>Suggested by AI · general wellness only</p>
            </div>
            <CircleAlert size={20} aria-hidden="true" />
          </div>
          {safetyNotes.length ? (
            <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--ink-soft)", fontSize: ".82rem" }}>
              {safetyNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          ) : (
            <p className="field-help">No additional safety notes are available.</p>
          )}
        </article>
      </section>

      <section className="plan-overview" style={{ marginTop: "1rem" }}>
        <article className="card">
          <div className="card-title"><div><h2>Hydration and weekly review</h2><p>Suggested by AI</p></div><Droplets size={20} /></div>
          <p style={{ color: "var(--ink-soft)", fontSize: ".84rem" }}>{hydrationGuidance}</p>
          <ul style={{ paddingLeft: "1.2rem", color: "var(--ink-soft)", fontSize: ".82rem" }}>
            {weeklyReviewRules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </article>
        <article className="card">
          <div className="card-title"><div><h2>Assumptions and missing data</h2><p>Visible uncertainty</p></div></div>
          <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--ink-soft)", fontSize: ".82rem" }}>
            {assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
          </ul>
        </article>
      </section>

      <div className="disclaimer">
        <strong>This plan provides general wellness information and is not medical advice.</strong>{" "}
        Individual needs can vary. Consult a qualified healthcare professional or registered dietitian when appropriate.
      </div>
      {status === "draft" || status === "historical" ? (
        <div className="onboarding-actions">
          {acceptedVersion ? (
            <button
              className="button button-quiet"
              onClick={keepAcceptedPlan}
              type="button"
            >
              Keep accepted plan
            </button>
          ) : (
            <span className="field-help">
              No plan is current until you accept this version.
            </span>
          )}
          <div>
            <button className="button button-dark" disabled={accepting || !reviewPlanId} onClick={acceptDraft} type="button">
              <Check size={17} /> {accepting
                ? "Accepting…"
                : status === "historical"
                  ? "Accept this prior version"
                  : "Accept this version"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PlanLoadError() {
  const router = useRouter();

  return (
    <div className="page-frame">
      <header className="page-header">
        <div>
          <span className="date-label">Plan temporarily unavailable</span>
          <h1>My Plan</h1>
          <p>We could not load the complete plan safely.</p>
        </div>
      </header>
      <div className="message-box" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        <span>
          Some plan records did not load. Nothing was changed; retry when you
          are ready.
        </span>
      </div>
      <div className="header-actions" style={{ marginTop: "1rem" }}>
        <button
          className="button button-dark"
          onClick={() => router.refresh()}
          type="button"
        >
          Retry
        </button>
        <Link className="button button-quiet" href="/today">
          Back to Today
        </Link>
      </div>
    </div>
  );
}
