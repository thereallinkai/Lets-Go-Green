"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  LogOut,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AppReleaseCard } from "@/components/app-release-card";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { AppearanceControl } from "@/components/appearance-control";
import { FoodLabelUpload } from "@/components/food-label-upload";
import { MealPreferenceEditor } from "@/components/meal-preference-editor";
import {
  apiErrorFromPayload,
  clientApiError,
} from "@/src/lib/client-api-error";
import type { ApiError } from "@/src/lib/api-response";
import type { PrimaryMealType } from "@/src/lib/domain/meal-slots";

export type SettingsGoalType =
  | "fat_loss"
  | "muscle_gain"
  | "maintenance"
  | "body_recomposition";

export type SettingsInitialData = {
  mode: "authenticated" | "demo";
  account: {
    email: string;
    createdAt: string | null;
  };
  profile: {
    fullName: string;
    preferredWeightUnit: "kg" | "lb";
    timeZone: string;
    allergies: string[];
    dietaryRestrictions: string[];
    dislikedFoods: string[];
    trainingDaysPerWeek: number | null;
    safetyContext: string;
  };
  goal: {
    id: string;
    goalType: SettingsGoalType;
    targetWeightKg: number;
    targetDate: string;
  } | null;
  mealPreferences: Array<{
    mealType: PrimaryMealType;
    foodId: string;
    foodName: string;
    sortOrder: number;
  }>;
  privateLabelFoods: PrivateLabelFood[];
  activeLabelDrafts: Array<{
    id: string;
    status: "draft" | "needs_changes";
    brandName: string;
    productName: string;
    variantName: string | null;
    createdAt: string;
  }>;
  aiProviderMode: "mock" | "openai" | "unavailable";
  loadError: string | null;
};

type PrivateLabelFood = {
  id: string;
  name: string;
  verificationStatus:
    | "verified"
    | "user_label"
    | "source_reported"
    | "pending_verification"
    | "unavailable";
  createdAt: string;
  nutrition: {
    servingWeightGrams: number;
    calories: number;
    proteinGrams: number;
    carbohydrateGrams: number;
    fatGrams: number;
    fiberGrams: number | null;
    sodiumMilligrams: number | null;
    sourceNote: string;
  } | null;
};

type PendingAction =
  | "profile"
  | "goal"
  | "preferences"
  | "export"
  | "logout"
  | "label-draft"
  | null;

type StatusMessage = {
  kind: "success" | "error";
  text: string;
} | null;

type SaveResult = {
  saved: boolean;
  persisted: boolean;
  section: "profile" | "goal" | "preferences";
  displayMetadataUpdated?: boolean;
};

const sections = [
  ["appearance", "Appearance"],
  ["profile", "Profile"],
  ["preferences", "Preferences"],
  ["foods", "Label foods"],
  ["ai", "AI plan"],
  ["security", "Security"],
  ["data", "Your data"],
  ["about", "About"],
];

const goalLabels: Record<SettingsGoalType, string> = {
  fat_loss: "Fat loss",
  muscle_gain: "Muscle gain",
  maintenance: "Maintenance",
  body_recomposition: "Body recomposition",
};

function splitList(value: string) {
  const seen = new Set<string>();
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLocaleLowerCase("en-US");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatLabelDraftDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

async function updateSettings(body: unknown) {
  const response = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    data: SaveResult | null;
    error: { message: string } | null;
  } | null;
  const requestedSection =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { section?: unknown }).section
      : null;
  const result = payload?.data;
  const validResult =
    result !== null &&
    typeof result === "object" &&
    result.saved === true &&
    typeof result.persisted === "boolean" &&
    result.section === requestedSection &&
    (result.displayMetadataUpdated === undefined ||
      typeof result.displayMetadataUpdated === "boolean");
  if (!response.ok || !validResult) {
    throw new Error(
      !response.ok && payload?.error?.message
        ? payload.error.message
        : "The settings service returned an incomplete save confirmation. Your edits remain on this page, but account storage could not be confirmed; retry before leaving this page.",
    );
  }
  return result;
}

export function SettingsView({
  initialData,
}: {
  initialData: SettingsInitialData;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [logoutError, setLogoutError] = useState<ApiError | null>(null);
  const [fullName, setFullName] = useState(initialData.profile.fullName);
  const [preferredWeightUnit, setPreferredWeightUnit] = useState(
    initialData.profile.preferredWeightUnit,
  );
  const [timeZone, setTimeZone] = useState(initialData.profile.timeZone);
  const [goalType, setGoalType] = useState<SettingsGoalType | "">(
    initialData.goal?.goalType ?? "",
  );
  const [allergies, setAllergies] = useState(
    initialData.profile.allergies.join(", "),
  );
  const [dietaryRestrictions, setDietaryRestrictions] = useState(
    initialData.profile.dietaryRestrictions.join(", "),
  );
  const [dislikedFoods, setDislikedFoods] = useState(
    initialData.profile.dislikedFoods.join(", "),
  );
  const [trainingDaysPerWeek, setTrainingDaysPerWeek] = useState(
    initialData.profile.trainingDaysPerWeek,
  );
  const [safetyContext, setSafetyContext] = useState(
    initialData.profile.safetyContext,
  );
  const [noAllergies, setNoAllergies] = useState(
    initialData.profile.allergies.length === 0,
  );
  const [noDietaryRestrictions, setNoDietaryRestrictions] = useState(
    initialData.profile.dietaryRestrictions.length === 0,
  );
  const [noDislikedFoods, setNoDislikedFoods] = useState(
    initialData.profile.dislikedFoods.length === 0,
  );
  const [noSafetyContext, setNoSafetyContext] = useState(
    initialData.profile.safetyContext.trim().length === 0,
  );
  const privateLabelFoods = initialData.privateLabelFoods;
  const [activeLabelDrafts, setActiveLabelDrafts] = useState(
    initialData.activeLabelDrafts,
  );
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [discardError, setDiscardError] = useState<ApiError | null>(null);
  const [labelCatalogAdditions, setLabelCatalogAdditions] = useState<
    Array<{ foodId: string; foodName: string }>
  >([]);
  const isDemo = initialData.mode === "demo";
  const savingBlocked = Boolean(initialData.loadError);

  useEffect(() => {
    if (window.location.hash !== "#preferences") return;
    window.requestAnimationFrame(() => {
      document.getElementById("preferences")?.focus();
    });
  }, []);

  function successMessage(persisted: boolean, authenticatedText: string) {
    return persisted
      ? authenticatedText
      : "Demo preview updated for this page only. Supabase is not configured, so no account data was saved.";
  }

  function useDeviceTimeZone() {
    const detected =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setTimeZone(detected);
    setStatus({
      kind: "success",
      text: `Detected ${detected} from this device. Select Save profile to keep it on your account.`,
    });
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingBlocked) return;
    setPending("profile");
    setStatus(null);
    try {
      const result = await updateSettings({
        section: "profile",
        fullName,
        preferredWeightUnit,
        timeZone,
      });
      setFullName(fullName.trim());
      setTimeZone(timeZone.trim());
      setStatus({
        kind: "success",
        text: successMessage(
          result.persisted,
          result.displayMetadataUpdated === false
            ? "Profile saved. The navigation name may update after your next sign-in."
            : "Profile settings saved.",
        ),
      });
      if (result.persisted) router.refresh();
    } catch (error) {
      setStatus({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Profile settings could not be saved.",
      });
    } finally {
      setPending(null);
    }
  }

  async function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goalType || savingBlocked) return;
    setPending("goal");
    setStatus(null);
    try {
      const result = await updateSettings({
        section: "goal",
        goalType,
      });
      setStatus({
        kind: "success",
        text: successMessage(
          result.persisted,
          "Goal type saved. Any accepted plan remains unchanged.",
        ),
      });
      if (result.persisted) router.refresh();
    } catch (error) {
      setStatus({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The active goal could not be saved.",
      });
    } finally {
      setPending(null);
    }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingBlocked) return;
    setPending("preferences");
    setStatus(null);
    const allergyItems = noAllergies ? [] : splitList(allergies);
    const restrictionItems = noDietaryRestrictions
      ? []
      : splitList(dietaryRestrictions);
    const dislikedItems = noDislikedFoods ? [] : splitList(dislikedFoods);
    const normalizedSafetyContext = noSafetyContext
      ? ""
      : safetyContext.trim();
    try {
      const result = await updateSettings({
        section: "preferences",
        allergies: allergyItems,
        dietaryRestrictions: restrictionItems,
        dislikedFoods: dislikedItems,
        trainingDaysPerWeek,
        safetyContext: normalizedSafetyContext,
      });
      setAllergies(allergyItems.join(", "));
      setDietaryRestrictions(restrictionItems.join(", "));
      setDislikedFoods(dislikedItems.join(", "));
      setSafetyContext(normalizedSafetyContext);
      setNoAllergies(allergyItems.length === 0);
      setNoDietaryRestrictions(restrictionItems.length === 0);
      setNoDislikedFoods(dislikedItems.length === 0);
      setNoSafetyContext(normalizedSafetyContext.length === 0);
      setStatus({
        kind: "success",
        text: successMessage(
          result.persisted,
          "Preferences saved. Any accepted plan remains unchanged.",
        ),
      });
      if (result.persisted) router.refresh();
    } catch (error) {
      setStatus({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Preferences could not be saved.",
      });
    } finally {
      setPending(null);
    }
  }

  async function downloadExport() {
    setPending("export");
    setStatus(null);
    try {
      const response = await fetch("/api/settings/export", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message ?? "Account data could not be exported.",
        );
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename =
        /filename="?([^";]+)"?/i.exec(disposition)?.[1] ??
        "lets-go-green-data.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus({
        kind: "success",
        text: isDemo
          ? "Sample demo data downloaded. This was not an account export."
          : "Your account data export was downloaded.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Account data could not be exported.",
      });
    } finally {
      setPending(null);
    }
  }

  async function logout() {
    setPending("logout");
    setStatus(null);
    setLogoutError(null);
    const fallback = clientApiError(
      "LOGOUT_UNAVAILABLE",
      "Logout could not be completed.",
      "Your session may still be active. Check the connection and try logging out again.",
      {
        retryable: true,
        action: { kind: "retry", label: "Try logging out again" },
      },
    );
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setLogoutError(apiErrorFromPayload(payload, fallback));
        setPending(null);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError(fallback);
      setPending(null);
    }
  }

  async function discardLabelDraft(draftId: string) {
    setPending("label-draft");
    setDiscardError(null);
    const fallback = clientApiError(
      "LABEL_DRAFT_DISCARD_UNAVAILABLE",
      "The private label draft could not be discarded.",
      "The request is safe to retry. An already-discarded draft is treated as success.",
      {
        retryable: true,
        action: { kind: "retry", label: "Retry discard" },
      },
    );
    try {
      const response = await fetch(`/api/food-labels/${draftId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      const result = payload?.data;
      const validResult =
        result !== null &&
        typeof result === "object" &&
        result.discarded === true &&
        typeof result.alreadyAbsent === "boolean" &&
        typeof result.cleanupPending === "boolean" &&
        result.persisted === !isDemo;
      if (!response.ok || !validResult) {
        setDiscardError(apiErrorFromPayload(payload, fallback));
        setPending(null);
        return;
      }
      setActiveLabelDrafts((drafts) =>
        drafts.filter((draft) => draft.id !== draftId),
      );
      setConfirmDiscardId(null);
      setStatus({
        kind: "success",
        text: result.cleanupPending
          ? "Draft discarded. Private-photo cleanup is queued and will retry when you return to package-label tools."
          : "Draft and its private photos were discarded.",
      });
      setPending(null);
      router.refresh();
    } catch {
      setDiscardError(fallback);
      setPending(null);
    }
  }

  async function refreshPrivateLabelState(foodId: string, displayName: string) {
    try {
      const draftsResponse = await fetch("/api/food-labels", {
        cache: "no-store",
      });
      const draftsPayload = await draftsResponse.json().catch(() => null);
      const savedFoodConfirmed =
        draftsResponse.ok &&
        Array.isArray(draftsPayload?.data) &&
        draftsPayload.data.some(
          (draft: { private_food_id?: unknown }) =>
            draft?.private_food_id === foodId,
        );
      if (!savedFoodConfirmed || !draftsResponse.ok) return false;
      if (!Array.isArray(draftsPayload?.data)) return false;

      setActiveLabelDrafts(
        draftsPayload.data.flatMap(
          (draft: {
            id?: unknown;
            status?: unknown;
            brand_name?: unknown;
            product_name?: unknown;
            variant_name?: unknown;
            created_at?: unknown;
          }) =>
            (draft.status === "draft" || draft.status === "needs_changes") &&
            typeof draft.id === "string" &&
            typeof draft.brand_name === "string" &&
            typeof draft.product_name === "string" &&
            typeof draft.created_at === "string"
              ? [
                  {
                    id: draft.id,
                    status: draft.status,
                    brandName: draft.brand_name,
                    productName: draft.product_name,
                    variantName:
                      typeof draft.variant_name === "string"
                        ? draft.variant_name
                        : null,
                    createdAt: draft.created_at,
                  },
                ]
              : [],
        ),
      );
      setLabelCatalogAdditions((current) => [
        ...current.filter((food) => food.foodId !== foodId),
        { foodId, foodName: displayName },
      ]);
      router.refresh();
      return true;
    } catch {
      return false;
    }
  }

  return (
    <div className="page-frame">
      <header className="page-header">
        <div>
          <span className="date-label">Account and plan controls</span>
          <h1>Settings</h1>
          <p>Update stored inputs without silently changing an accepted plan.</p>
        </div>
        <button
          className="button button-quiet"
          disabled={pending !== null}
          onClick={logout}
          type="button"
        >
          <LogOut size={17} /> {pending === "logout" ? "Logging out…" : "Log out"}
        </button>
      </header>

      {isDemo ? (
        <div className="message-box" role="status" style={{ marginBottom: "1rem" }}>
          <ShieldAlert size={18} />
          <span>
            Demo preview: Supabase is not configured. Saves affect this page only,
            and exports contain sample data rather than account data.
          </span>
        </div>
      ) : null}
      {initialData.loadError ? (
        <div
          className="message-box error"
          role="alert"
          style={{ marginBottom: "1rem" }}
        >
          <ShieldAlert size={18} />
          <span>{initialData.loadError}</span>
        </div>
      ) : null}
      {status ? (
        <div
          className={`message-box${status.kind === "error" ? " error" : ""}`}
          role={status.kind === "error" ? "alert" : "status"}
          style={{ marginBottom: "1rem" }}
        >
          <span>{status.text}</span>
        </div>
      ) : null}
      {logoutError ? (
        <ApiErrorNotice
          actionDisabled={pending !== null}
          error={logoutError}
          heading="You are still signed in."
          onAction={() => void logout()}
        />
      ) : null}

      <div className="settings-layout">
        <nav className="settings-index" aria-label="Settings sections">
          {sections.map(([id, label]) => (
            <a href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
        </nav>

        <div className="settings-content">
          <section className="card settings-section" id="appearance">
            <div className="card-title">
              <div>
                <h2>Appearance</h2>
                <p>Choose how Let&apos;s Go Green! looks on this device.</p>
              </div>
            </div>
            <AppearanceControl variant="full" />
          </section>

          <section className="card settings-section" id="profile">
            <div className="card-title">
              <div>
                <h2>Profile and display</h2>
                <p>
                  {isDemo
                    ? "Sample values for the local demo"
                    : `Signed in as ${initialData.account.email}`}
                </p>
              </div>
            </div>
            <form onSubmit={saveProfile}>
              <div className="field-grid">
                <label className="field">
                  <span>Full name</span>
                  <input
                    autoComplete="name"
                    disabled={pending !== null}
                    maxLength={120}
                    onChange={(event) => setFullName(event.target.value)}
                    required
                    value={fullName}
                  />
                </label>
                <label className="field">
                  <span>Preferred unit</span>
                  <select
                    disabled={pending !== null}
                    onChange={(event) =>
                      setPreferredWeightUnit(
                        event.target.value as "kg" | "lb",
                      )
                    }
                    value={preferredWeightUnit}
                  >
                    <option value="kg">Kilograms</option>
                    <option value="lb">Pounds</option>
                  </select>
                </label>
                <label className="field">
                  <span>Time zone</span>
                  <input
                    disabled={pending !== null}
                    list="time-zone-options"
                    maxLength={100}
                    onChange={(event) => setTimeZone(event.target.value)}
                    required
                    value={timeZone}
                  />
                  <small className="field-help">
                    Use an IANA name such as America/New_York or Europe/London.
                  </small>
                </label>
                <datalist id="time-zone-options">
                  <option value="UTC" />
                  <option value="America/New_York" />
                  <option value="America/Chicago" />
                  <option value="America/Denver" />
                  <option value="America/Los_Angeles" />
                  <option value="Europe/London" />
                  <option value="Europe/Paris" />
                  <option value="Asia/Tokyo" />
                  <option value="Australia/Sydney" />
                </datalist>
                <div className="field">
                  <span>Automatic time zone</span>
                  <button
                    className="button button-quiet"
                    disabled={pending !== null}
                    onClick={useDeviceTimeZone}
                    type="button"
                  >
                    Use this device&apos;s time zone
                  </button>
                  <small className="field-help">
                    Uses the browser&apos;s time-zone setting. Precise location
                    permission is not requested.
                  </small>
                </div>
              </div>
              <div className="section-actions">
                <button
                  className="button button-dark"
                  disabled={savingBlocked || pending !== null}
                  type="submit"
                >
                  {pending === "profile" ? "Saving…" : "Save profile"}
                </button>
              </div>
            </form>

            <form
              onSubmit={saveGoal}
              style={{
                borderTop: "1px solid var(--line)",
                marginTop: "1.2rem",
                paddingTop: "1.2rem",
              }}
            >
              <div className="field-grid">
                <label className="field">
                  <span>Active goal type</span>
                  <select
                    disabled={!initialData.goal || pending !== null}
                    onChange={(event) =>
                      setGoalType(event.target.value as SettingsGoalType)
                    }
                    value={goalType}
                  >
                    {!initialData.goal ? (
                      <option value="">No active goal</option>
                    ) : null}
                    {Object.entries(goalLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  <span>Stored target</span>
                  <strong style={{ fontSize: ".9rem", paddingTop: ".7rem" }}>
                    {initialData.goal
                      ? `${initialData.goal.targetWeightKg} kg by ${initialData.goal.targetDate}`
                      : "No active target"}
                  </strong>
                  <small className="field-help">
                    Target weight and date are shown but are not edited by this
                    control.
                  </small>
                </div>
              </div>
              <div className="message-box" style={{ marginTop: "1rem" }}>
                <ShieldAlert size={18} />
                <span>
                  Saving a goal type does not alter an accepted plan. Generate a
                  new version explicitly from My Plan if you want changed inputs
                  reflected.
                </span>
              </div>
              <div className="section-actions">
                <button
                  className="button button-dark"
                  disabled={
                    savingBlocked || !initialData.goal || pending !== null
                  }
                  type="submit"
                >
                  {pending === "goal" ? "Saving…" : "Save goal type"}
                </button>
              </div>
            </form>
          </section>

          <section
            aria-labelledby="settings-preferences-heading"
            className="card settings-section"
            id="preferences"
            tabIndex={-1}
          >
            <div className="card-title">
              <div>
                <h2 id="settings-preferences-heading">
                  Preferences and safety context
                </h2>
                <p>Stored account inputs used to filter future suggestions.</p>
              </div>
            </div>

            <MealPreferenceEditor
              catalogAdditions={labelCatalogAdditions}
              disabled={savingBlocked}
              initialPreferences={initialData.mealPreferences}
            />

            <form onSubmit={savePreferences}>
              <div className="field-grid">
                <div className="field preference-field">
                  <label className="field-label" htmlFor="settings-allergies">
                    Allergies
                  </label>
                  <input
                    id="settings-allergies"
                    disabled={pending !== null || noAllergies}
                    maxLength={1000}
                    onChange={(event) => {
                      setNoAllergies(false);
                      setAllergies(event.target.value);
                    }}
                    placeholder="Peanuts, milk"
                    value={allergies}
                  />
                  <label className="checkbox-row preference-none-option">
                    <input
                      checked={noAllergies}
                      disabled={pending !== null}
                      onChange={(event) => {
                        setNoAllergies(event.target.checked);
                        if (event.target.checked) setAllergies("");
                      }}
                      type="checkbox"
                    />
                    No known allergies
                  </label>
                  <small className="field-help">
                    Comma-separated and used as hard exclusions for future plans.
                  </small>
                </div>
                <div className="field preference-field">
                  <label
                    className="field-label"
                    htmlFor="settings-dietary-restrictions"
                  >
                    Dietary restrictions
                  </label>
                  <input
                    id="settings-dietary-restrictions"
                    disabled={pending !== null || noDietaryRestrictions}
                    maxLength={1000}
                    onChange={(event) => {
                      setNoDietaryRestrictions(false);
                      setDietaryRestrictions(event.target.value);
                    }}
                    placeholder="Vegetarian, gluten-free"
                    value={dietaryRestrictions}
                  />
                  <label className="checkbox-row preference-none-option">
                    <input
                      checked={noDietaryRestrictions}
                      disabled={pending !== null}
                      onChange={(event) => {
                        setNoDietaryRestrictions(event.target.checked);
                        if (event.target.checked) setDietaryRestrictions("");
                      }}
                      type="checkbox"
                    />
                    No dietary restrictions
                  </label>
                </div>
                <div className="field preference-field">
                  <label className="field-label" htmlFor="settings-disliked-foods">
                    Foods you dislike
                  </label>
                  <input
                    id="settings-disliked-foods"
                    disabled={pending !== null || noDislikedFoods}
                    maxLength={2000}
                    onChange={(event) => {
                      setNoDislikedFoods(false);
                      setDislikedFoods(event.target.value);
                    }}
                    placeholder="Mushrooms, olives"
                    value={dislikedFoods}
                  />
                  <label className="checkbox-row preference-none-option">
                    <input
                      checked={noDislikedFoods}
                      disabled={pending !== null}
                      onChange={(event) => {
                        setNoDislikedFoods(event.target.checked);
                        if (event.target.checked) setDislikedFoods("");
                      }}
                      type="checkbox"
                    />
                    No disliked foods
                  </label>
                </div>
                <label className="field">
                  <span>Strength training</span>
                  <select
                    disabled={pending !== null}
                    onChange={(event) =>
                      setTrainingDaysPerWeek(
                        event.target.value
                          ? Number(event.target.value)
                          : null,
                      )
                    }
                    value={
                      trainingDaysPerWeek === null
                        ? ""
                        : String(trainingDaysPerWeek)
                    }
                  >
                    <option value="">Not specified</option>
                    {Array.from({ length: 8 }, (_, days) => (
                      <option key={days} value={days}>
                        {days === 0
                          ? "None"
                          : `${days} ${days === 1 ? "day" : "days"} / week`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="field preference-field" style={{ marginTop: "1rem" }}>
                <label className="field-label" htmlFor="settings-safety-context">
                  Optional safety context
                </label>
                <textarea
                  id="settings-safety-context"
                  disabled={pending !== null || noSafetyContext}
                  maxLength={4000}
                  onChange={(event) => {
                    setNoSafetyContext(false);
                    setSafetyContext(event.target.value);
                  }}
                  placeholder="Share only what is useful for safer, non-restrictive guidance."
                  value={safetyContext}
                />
                <label className="checkbox-row preference-none-option">
                  <input
                    checked={noSafetyContext}
                    disabled={pending !== null}
                    onChange={(event) => {
                      setNoSafetyContext(event.target.checked);
                      if (event.target.checked) setSafetyContext("");
                    }}
                    type="checkbox"
                  />
                  No additional safety context
                </label>
                <small className="field-help">
                  Optional context is stored with your profile and used to avoid
                  unsuitable restrictive guidance.
                </small>
              </div>
              <div className="section-actions">
                <button
                  className="button button-dark"
                  disabled={savingBlocked || pending !== null}
                  type="submit"
                >
                  {pending === "preferences"
                    ? "Saving…"
                    : "Save preferences"}
                </button>
              </div>
            </form>
          </section>

          <section className="card settings-section" id="foods">
            <div className="card-title">
              <div>
                <h2>Private label foods</h2>
                <p>
                  Photograph the exact package label so this device can read the
                  nutrition facts for you. Compare and correct every value before
                  saving; your confirmed private copy can then be used in your
                  plan. If you explicitly share normalized facts, that separate
                  copy stays pending until catalog review.
                </p>
              </div>
            </div>

            {activeLabelDrafts.length ? (
              <div className="label-draft-panel">
                <div>
                  <strong>Unfinished private label drafts</strong>
                  <p>
                    These drafts count toward your upload allowance. Discard only
                    a draft you no longer need; its private photos are removed by
                    the trusted cleanup service.
                  </p>
                </div>
                <ul className="label-draft-list">
                  {activeLabelDrafts.map((draft) => {
                    const draftName = [
                      draft.brandName,
                      draft.productName,
                      draft.variantName,
                    ]
                      .filter(Boolean)
                      .join(" — ");
                    const confirming = confirmDiscardId === draft.id;
                    return (
                      <li className="label-draft-item" key={draft.id}>
                        <div>
                          <strong>{draftName}</strong>
                          <span>
                            {draft.status === "needs_changes"
                              ? "Needs changes"
                              : "Draft"}
                            {" · Created "}
                            {formatLabelDraftDate(draft.createdAt)}
                          </span>
                        </div>
                        {confirming ? (
                          <div
                            aria-label={`Confirm discarding ${draftName}`}
                            className="label-draft-confirmation"
                            role="group"
                          >
                            <span>This cannot be undone.</span>
                            <button
                              className="button button-quiet button-small"
                              disabled={pending !== null}
                              onClick={() => setConfirmDiscardId(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                            <button
                              className="button button-danger button-small"
                              disabled={pending !== null}
                              onClick={() => void discardLabelDraft(draft.id)}
                              type="button"
                            >
                              {pending === "label-draft"
                                ? "Discarding…"
                                : "Discard draft permanently"}
                            </button>
                          </div>
                        ) : (
                          <button
                            className="button button-danger button-small"
                            disabled={pending !== null}
                            onClick={() => {
                              setDiscardError(null);
                              setConfirmDiscardId(draft.id);
                            }}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={17} />
                            Discard draft
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {discardError ? (
                  <ApiErrorNotice
                    actionDisabled={pending !== null}
                    error={discardError}
                    heading="The draft is still listed."
                    onAction={
                      confirmDiscardId
                        ? () => void discardLabelDraft(confirmDiscardId)
                        : undefined
                    }
                  />
                ) : null}
              </div>
            ) : (
              <div className="message-box" style={{ marginBottom: "1rem" }}>
                No unfinished label drafts are using your upload allowance.
              </div>
            )}

            {privateLabelFoods.length ? (
              <div className="message-box" style={{ marginBottom: "1rem" }}>
                <div>
                  <strong>
                    {privateLabelFoods.length} saved private label{" "}
                    {privateLabelFoods.length === 1 ? "food" : "foods"}
                  </strong>
                  <ul style={{ margin: ".45rem 0 0", paddingLeft: "1.1rem" }}>
                    {privateLabelFoods.map((food) => (
                      <li key={food.id}>
                        <strong>{food.name}</strong>
                        {food.nutrition
                          ? ` — ${food.nutrition.calories} kcal, ${food.nutrition.servingWeightGrams} g per serving`
                          : " — serving nutrition is unavailable"}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="message-box" style={{ marginBottom: "1rem" }}>
                No private label foods are stored yet.
              </div>
            )}

            <FoodLabelUpload onCreated={refreshPrivateLabelState} />
          </section>

          <section className="card settings-section" id="ai">
            <div className="card-title">
              <div>
                <h2>AI plan settings</h2>
                <p>AI calls are explicit and run on the server.</p>
              </div>
              <Sparkles size={20} />
            </div>
            <div className="message-box">
              <div>
                <strong>
                  Configured provider:{" "}
                  {initialData.aiProviderMode === "openai"
                    ? "OpenAI"
                    : initialData.aiProviderMode === "mock"
                      ? "Deterministic mock"
                      : "Unavailable"}
                </strong>
                <p style={{ margin: ".35rem 0 0" }}>
                  Provider selection is deployment configuration, not a saved
                  account preference. Generating a plan still requires an explicit
                  action.
                </p>
              </div>
            </div>
          </section>

          <section className="card settings-section" id="security">
            <div className="card-title">
              <div>
                <h2>Security</h2>
                <p>Manage sign-in through the verified recovery flow.</p>
              </div>
            </div>
            <div className="form-row">
              <div>
                <strong style={{ fontSize: ".86rem" }}>Password</strong>
                <p className="field-help">
                  Request a recovery email for {initialData.account.email}.
                </p>
              </div>
              <Link className="button button-quiet" href="/forgot-password">
                Change password
              </Link>
            </div>
          </section>

          <section className="card settings-section" id="data">
            <div className="card-title">
              <div>
                <h2>Your data</h2>
                <p>
                  {isDemo
                    ? "Download the sample data currently represented by this demo."
                    : "Download a JSON copy of data associated with your authenticated account."}
                </p>
              </div>
            </div>
            <div className="form-row">
              <div>
                <strong style={{ fontSize: ".86rem" }}>
                  {isDemo ? "Sample download" : "Account export"}
                </strong>
                <p className="field-help">
                  {isDemo
                    ? "This is explicitly marked as demo data."
                    : "Includes profile, goals, preferences, private foods, plans, entries, and check-ins."}
                </p>
              </div>
              <button
                className="button button-quiet"
                disabled={pending !== null}
                onClick={downloadExport}
                type="button"
              >
                <Download size={16} />{" "}
                {pending === "export" ? "Preparing…" : "Download JSON"}
              </button>
            </div>
          </section>

          <AppReleaseCard />

          <section className="card settings-section danger-zone">
            <div className="card-title">
              <div>
                <h2>Delete account</h2>
                <p>No account-deletion endpoint is implemented in this build.</p>
              </div>
              <Trash2 size={19} />
            </div>
            <div className="message-box error" id="deletion-unavailable">
              <ShieldAlert size={18} />
              <span>
                Account deletion is currently unavailable. This control does not
                send a deletion request or claim that stored data was removed.
              </span>
            </div>
            <div className="section-actions">
              <button
                aria-describedby="deletion-unavailable"
                className="button button-danger"
                disabled
                type="button"
              >
                Account deletion unavailable
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
