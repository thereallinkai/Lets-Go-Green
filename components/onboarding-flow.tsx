"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromPayload,
  clientApiError,
} from "@/src/lib/client-api-error";
import { DEMO_CATALOG } from "@/src/lib/demo-catalog";
import {
  normalizeMealFoodSlugs,
  parseOptionalHeight,
} from "@/src/lib/onboarding-input";
import { BrandLink } from "@/components/brand-link";
import { AppearanceControl } from "@/components/appearance-control";
import { HeightPicker } from "@/components/height-picker";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { BRAND } from "@/src/lib/brand";
import {
  FoodSearchPicker,
  type FoodPickerItem,
} from "@/components/food-search-picker";
import type {
  FoodNutritionFacts,
  FoodSourceSummary,
} from "@/src/lib/domain/food-catalog";
import {
  normalizeRegistrationEmail,
  readRegistrationEmailHandoff,
  REGISTRATION_EMAIL_HANDOFF_KEY,
} from "@/src/lib/registration-email-handoff";

type Meal = "breakfast" | "lunch" | "dinner";
type Unit = "kg" | "lb";
type AcknowledgedWarning = {
  mealType: Meal;
  warningCode: string;
  contextVersion: "meal-composition-v1";
};

type PageError = {
  field: string;
  message: string;
};

type DraftPersistenceIssue = {
  operation: "load" | "save";
  error: ApiError;
};

type OnboardingFocusTarget = {
  step: 2 | 3 | 4 | 5 | 6;
  field: string;
  selector: string;
};

type Food = FoodPickerItem;

const ONBOARDING_DRAFT_KEY_PREFIX = "lets-go-green-onboarding-draft";
const UNSCOPED_ONBOARDING_DRAFT_KEY = "lets-go-green-onboarding-draft";
const LEGACY_ONBOARDING_DRAFT_KEY = "cutting-plan-onboarding-draft";
const REGISTRATION_DRAFT_KEY = "lets-go-green-registration-draft";
const LEGACY_REGISTRATION_DRAFT_KEY = "cutting-plan-registration-draft";

const GOAL_TYPES = new Set([
  "fat_loss",
  "muscle_gain",
  "maintenance",
  "recomposition",
]);
const ACTIVITY_LEVELS = new Set(["low", "light", "moderate", "high"]);
const MEALS = ["breakfast", "lunch", "dinner"] as const;
const WARNING_CODES = new Set([
  "missing_carbohydrate",
  "missing_protein",
  "missing_vegetable",
]);

function browserStorage(kind: "localStorage" | "sessionStorage") {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

function readStorage(storage: Storage | null, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage | null, key: string, value: string) {
  try {
    storage?.setItem(key, value);
    return storage !== null;
  } catch {
    return false;
  }
}

function removeStorage(storage: Storage | null, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // Account persistence still works when browser storage is unavailable.
  }
}

function scopedOnboardingDraftKey(ownerKey: string | null | undefined) {
  if (
    typeof ownerKey !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(ownerKey)
  ) {
    return null;
  }
  return `${ONBOARDING_DRAFT_KEY_PREFIX}:${ownerKey}`;
}

type Draft = {
  meals: Record<Meal, string[]>;
  currentWeight: string;
  targetWeight: string;
  unit: Unit;
  goalType: string;
  targetDate: string;
  height: string;
  activity: string;
  trainingDays: string;
  restrictions: string;
  allergies: string;
  timeZone: string;
  safety: string[];
  notes: string;
  acknowledgedWarnings: AcknowledgedWarning[];
};

type StoredDraft = {
  draft: Partial<Draft>;
  savedAt: number;
  currentStep: number | null;
  onboardingCompleted: boolean;
  generationKey: string | null;
};

const fallbackFoods: Food[] = DEMO_CATALOG.map((food) => ({
  id: food.slug,
  name: food.englishName,
  categories: food.categories,
  planEligible: true,
}));

const initialDraft: Draft = {
  meals: { breakfast: [], lunch: [], dinner: [] },
  currentWeight: "",
  targetWeight: "",
  unit: "kg",
  goalType: "fat_loss",
  targetDate: "",
  height: "",
  activity: "moderate",
  trainingDays: "3",
  restrictions: "",
  allergies: "",
  timeZone: "UTC",
  safety: [],
  notes: "",
  acknowledgedWarnings: [],
};

type ApiFailure = {
  error?: ApiError | null;
};

type OnboardingErrorContext =
  | "verify"
  | "resume-verify"
  | "resend"
  | "save-draft"
  | "complete-today"
  | "complete-generate"
  | "generate";

type PlanGenerationResult = ApiFailure & {
  data?: {
    planId?: string | null;
    status?: string;
  } | null;
};

function normalizeRestoredDraft(value: unknown): Partial<Draft> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const restored = value as Record<string, unknown>;
  const normalized: Partial<Draft> = {};
  const text = (key: string, maximumLength: number) =>
    typeof restored[key] === "string"
      ? restored[key].slice(0, maximumLength)
      : undefined;

  if (
    restored.meals &&
    typeof restored.meals === "object" &&
    !Array.isArray(restored.meals)
  ) {
    const meals = restored.meals as Record<string, unknown>;
    normalized.meals = MEALS.reduce((result, meal) => {
      const slugs = Array.isArray(meals[meal])
        ? meals[meal]
            .filter((slug): slug is string => typeof slug === "string")
            .map((slug) => slug.trim())
            .filter((slug) => slug.length > 0 && slug.length <= 120)
            .slice(0, 50)
        : [];
      result[meal] = normalizeMealFoodSlugs(slugs);
      return result;
    }, {} as Draft["meals"]);
  }

  const currentWeight = text("currentWeight", 30);
  const targetWeight = text("targetWeight", 30);
  const targetDate = text("targetDate", 10);
  const height = text("height", 30);
  const trainingDays = text("trainingDays", 2);
  const restrictions = text("restrictions", 1_000);
  const allergies = text("allergies", 1_000);
  const timeZone = text("timeZone", 100);
  const notes = text("notes", 2_000);
  if (currentWeight !== undefined) normalized.currentWeight = currentWeight;
  if (targetWeight !== undefined) normalized.targetWeight = targetWeight;
  if (targetDate !== undefined) normalized.targetDate = targetDate;
  if (height !== undefined) normalized.height = height;
  if (trainingDays !== undefined) normalized.trainingDays = trainingDays;
  if (restrictions !== undefined) normalized.restrictions = restrictions;
  if (allergies !== undefined) normalized.allergies = allergies;
  if (timeZone !== undefined) normalized.timeZone = timeZone;
  if (notes !== undefined) normalized.notes = notes;

  if (restored.unit === "kg" || restored.unit === "lb") {
    normalized.unit = restored.unit;
  }
  if (typeof restored.goalType === "string" && GOAL_TYPES.has(restored.goalType)) {
    normalized.goalType = restored.goalType;
  }
  if (typeof restored.activity === "string" && ACTIVITY_LEVELS.has(restored.activity)) {
    normalized.activity = restored.activity;
  }
  if (Array.isArray(restored.safety)) {
    normalized.safety = restored.safety
      .filter((flag): flag is string => typeof flag === "string")
      .map((flag) => flag.slice(0, 120))
      .slice(0, 10);
  }
  if (Array.isArray(restored.acknowledgedWarnings)) {
    normalized.acknowledgedWarnings = restored.acknowledgedWarnings
      .filter((warning): warning is Record<string, unknown> =>
        Boolean(warning) && typeof warning === "object" && !Array.isArray(warning),
      )
      .flatMap((warning) => {
        if (
          typeof warning.mealType !== "string" ||
          !MEALS.includes(warning.mealType as Meal) ||
          typeof warning.warningCode !== "string" ||
          !WARNING_CODES.has(warning.warningCode) ||
          warning.contextVersion !== "meal-composition-v1"
        ) {
          return [];
        }
        return [{
          mealType: warning.mealType as Meal,
          warningCode: warning.warningCode,
          contextVersion: "meal-composition-v1" as const,
        }];
      })
      .slice(0, 8);
  }
  return normalized;
}

function parseStoredDraft(raw: string): StoredDraft {
  const parsed = JSON.parse(raw) as unknown;
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).version === 1 &&
    "draft" in (parsed as Record<string, unknown>)
  ) {
    const envelope = parsed as Record<string, unknown>;
    const savedAt =
      typeof envelope.savedAt === "number" &&
      Number.isFinite(envelope.savedAt) &&
      envelope.savedAt >= 0
        ? envelope.savedAt
        : 0;
    const currentStep =
      typeof envelope.currentStep === "number" &&
      Number.isInteger(envelope.currentStep) &&
      envelope.currentStep >= 3 &&
      envelope.currentStep <= 6
        ? envelope.currentStep
        : null;
    const generationKey =
      typeof envelope.generationKey === "string" &&
      /^[A-Za-z0-9._:-]{8,128}$/.test(envelope.generationKey)
        ? envelope.generationKey
        : null;
    return {
      draft: normalizeRestoredDraft(envelope.draft),
      savedAt,
      currentStep,
      onboardingCompleted: envelope.onboardingCompleted === true,
      generationKey,
    };
  }
  return {
    draft: normalizeRestoredDraft(parsed),
    savedAt: 0,
    currentStep: null,
    onboardingCompleted: false,
    generationKey: null,
  };
}

function completionFailure(
  result: ApiFailure | null,
): { field: string; heading: string; message: string } {
  const code = result?.error?.code;
  const serverMessage = result?.error?.message;
  if (code === "SESSION_EXPIRED") {
    return {
      field: "session",
      heading: "Your session expired.",
      message:
        "Log in again to finish onboarding. Your current information remains on this page; account-scoped browser storage may also retain it when available.",
    };
  }
  if (code === "EMAIL_VERIFICATION_REQUIRED") {
    return {
      field: "verificationCode",
      heading: "Verify your email first.",
      message:
        serverMessage
        ?? "Verify your email before completing onboarding.",
    };
  }
  if (code === "PROFILE_REQUIRED" || code === "LEGAL_ACCEPTANCE_REQUIRED") {
    return {
      field: "account",
      heading: "Review your account setup.",
      message:
        serverMessage
        ?? "The required account information could not be verified.",
    };
  }
  if (code === "ONBOARDING_DATABASE_OUTDATED") {
    return {
      field: "service",
      heading: "The local database needs to finish updating.",
      message:
        serverMessage
        ?? "Restart with npm run dev:all so the local database update can finish, then try again.",
    };
  }
  if (
    code === "FOOD_SELECTION_CHANGED" ||
    code === "FOOD_NOT_PLAN_ELIGIBLE" ||
    code === "DUPLICATE_MEAL_FOOD"
  ) {
    return {
      field: "mealPreferences",
      heading: "Review your meal selections.",
      message: `${serverMessage ?? "One or more meal selections need attention."} Choose Edit under Meals, review the foods, and try again.`,
    };
  }
  if (code === "INVALID_HEIGHT" || code === "MISSING_HEIGHT") {
    return {
      field: "height",
      heading: "Review your height.",
      message:
        serverMessage
        ?? "Choose your height from the list in Step 5 before completing onboarding.",
    };
  }
  if (
    code === "INVALID_CURRENT_WEIGHT" ||
    code === "INVALID_TARGET_WEIGHT"
  ) {
    return {
      field:
        code === "INVALID_CURRENT_WEIGHT"
          ? "currentWeight"
          : "targetWeight",
      heading: "Review your weights.",
      message:
        serverMessage
        ?? "Enter weights from 20 to 500 kg, or the equivalent in pounds.",
    };
  }
  if (code === "TARGET_DATE_REQUIRED" || code === "INVALID_TARGET_DATE") {
    return {
      field: "targetDate",
      heading: "Review your target date.",
      message:
        serverMessage
        ?? "Choose a target date that is today or later.",
    };
  }
  if (code === "INVALID_TIME_ZONE") {
    return {
      field: "timeZone",
      heading: "Review your time zone.",
      message:
        serverMessage
        ?? "Choose a supported IANA time zone before completing onboarding.",
    };
  }
  if (code === "TOO_MANY_RESTRICTIONS") {
    return {
      field: "restrictions",
      heading: "Review allergies and restrictions.",
      message:
        serverMessage
        ?? "Use no more than 50 comma-separated allergies or dietary restrictions.",
    };
  }
  if (code === "INVALID_ONBOARDING") {
    return {
      field: "profile",
      heading: "Review your onboarding information.",
      message:
        serverMessage
        ?? "Some required onboarding information needs attention.",
    };
  }
  return {
    field: "completion",
    heading: "We could not complete onboarding.",
    message:
      serverMessage
      ?? "We could not save the final step. Your information is still here; please try again.",
  };
}

const fieldFocusTargets: Record<string, OnboardingFocusTarget> = {
  verificationEmail: {
    step: 2,
    field: "verificationEmail",
    selector: "#onboarding-verification-email",
  },
  verificationCode: {
    step: 2,
    field: "verificationCode",
    selector: "#onboarding-verification-code-1",
  },
  mealPreferences: {
    step: 3,
    field: "mealPreferences",
    selector: ".food-picker input",
  },
  goalType: {
    step: 4,
    field: "goalType",
    selector: 'input[name="goal"]',
  },
  currentWeight: {
    step: 4,
    field: "currentWeight",
    selector: "#onboarding-current-weight",
  },
  targetWeight: {
    step: 4,
    field: "targetWeight",
    selector: "#onboarding-target-weight",
  },
  targetDate: {
    step: 4,
    field: "targetDate",
    selector: "#onboarding-target-date",
  },
  height: {
    step: 5,
    field: "height",
    selector: ".onboarding-height-field select",
  },
  activity: {
    step: 5,
    field: "activity",
    selector: "#onboarding-activity",
  },
  trainingDays: {
    step: 5,
    field: "trainingDays",
    selector: "#onboarding-training-days",
  },
  timeZone: {
    step: 5,
    field: "timeZone",
    selector: "#onboarding-time-zone",
  },
  allergies: {
    step: 5,
    field: "allergies",
    selector: "#onboarding-allergies",
  },
  restrictions: {
    step: 5,
    field: "restrictions",
    selector: "#onboarding-restrictions",
  },
  confirmation: {
    step: 6,
    field: "confirmation",
    selector: "#onboarding-confirmation",
  },
  profile: {
    step: 5,
    field: "profile",
    selector: "#onboarding-step-heading",
  },
};

const errorCodeFields: Record<string, keyof typeof fieldFocusTargets> = {
  INVALID_EMAIL: "verificationEmail",
  EMAIL_VERIFICATION_REQUIRED: "verificationCode",
  INVALID_OR_EXPIRED_CODE: "verificationCode",
  VERIFICATION_CODE_REQUIRED: "verificationCode",
  FOOD_SELECTION_CHANGED: "mealPreferences",
  FOOD_NOT_PLAN_ELIGIBLE: "mealPreferences",
  DUPLICATE_MEAL_FOOD: "mealPreferences",
  INSUFFICIENT_ELIGIBLE_FOODS: "mealPreferences",
  INVALID_CURRENT_WEIGHT: "currentWeight",
  INVALID_TARGET_WEIGHT: "targetWeight",
  TARGET_DATE_REQUIRED: "targetDate",
  INVALID_TARGET_DATE: "targetDate",
  INVALID_HEIGHT: "height",
  MISSING_HEIGHT: "height",
  PROFILE_HEIGHT_REQUIRED: "height",
  TRUSTED_PROFILE_INCOMPLETE: "profile",
  INVALID_TIME_ZONE: "timeZone",
  TOO_MANY_RESTRICTIONS: "restrictions",
};

const VERIFIED_PROFILE_RECOVERY_CODES = new Set([
  "VERIFIED_PROFILE_STATUS_UNAVAILABLE",
  "VERIFIED_PROFILE_NOT_READY",
  "VERIFIED_PROFILE_REPAIR_FAILED",
]);

const VERIFICATION_NEW_CODE_CODES = new Set([
  "INVALID_OR_EXPIRED_CODE",
]);

const stepLabels = [
  "Account and profile",
  "Verify email",
  "Food preferences",
  "Goal and timeline",
  "Lifestyle and safety",
  "Review and complete",
];

const LB_PER_KG = 2.2046226218;

function SortableFood({
  food,
  index,
  total,
  onRemove,
  onMove,
}: {
  food: Food;
  index: number;
  total: number;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: food.id });
  return (
    <div
      className="selected-food"
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
    >
      <button
        className="icon-button"
        type="button"
        aria-label={`Drag to reorder ${food.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <span style={{ flex: 1 }}>{food.name}</span>
      <button className="icon-button" type="button" aria-label={`Move ${food.name} up`} disabled={index === 0} onClick={() => onMove(-1)}>
        <ChevronUp size={15} />
      </button>
      <button className="icon-button" type="button" aria-label={`Move ${food.name} down`} disabled={index === total - 1} onClick={() => onMove(1)}>
        <ChevronDown size={15} />
      </button>
      <button className="icon-button" type="button" aria-label={`Remove ${food.name}`} onClick={onRemove}>
        <X size={15} />
      </button>
    </div>
  );
}

function MealDestination({
  meal,
  ids,
  foods,
  missingCategories,
  onChange,
  announce,
}: {
  meal: Meal;
  ids: string[];
  foods: Food[];
  missingCategories: string[];
  onChange: (ids: string[]) => void;
  announce: (message: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function dragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    const next = arrayMove(ids, oldIndex, newIndex);
    onChange(next);
    announce(`${foods.find((food) => food.id === active.id)?.name ?? "Food"} moved to position ${newIndex + 1} in ${meal}.`);
  }

  return (
    <section className="meal-dropzone" aria-labelledby={`${meal}-heading`}>
      <h3 id={`${meal}-heading`}>{meal[0].toUpperCase() + meal.slice(1)}</h3>
      {missingCategories.length > 0 ? (
        <p className="field-help" role="status">
          Consider adding: {missingCategories.join(", ").toLowerCase()}.
        </p>
      ) : null}
      {ids.length === 0 ? <p className="field-help">No foods added yet.</p> : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id, index) => {
            const food =
              foods.find((item) => item.id === id) ??
              fallbackFoods.find((item) => item.id === id);
            if (!food) return null;
            return (
              <SortableFood
                food={food}
                index={index}
                total={ids.length}
                key={id}
                onRemove={() => {
                  onChange(ids.filter((item) => item !== id));
                  announce(`${food.name} removed from ${meal}.`);
                }}
                onMove={(direction) => {
                  const nextIndex = index + direction;
                  if (nextIndex < 0 || nextIndex >= ids.length) return;
                  onChange(arrayMove(ids, index, nextIndex));
                  announce(`${food.name} moved to position ${nextIndex + 1} in ${meal}.`);
                }}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </section>
  );
}

export function OnboardingFlow({
  initialStep = 2,
  email = "",
  draftOwnerKey = null,
}: {
  initialStep?: number;
  email?: string;
  draftOwnerKey?: string | null;
}) {
  const router = useRouter();
  const safeInitialStep = Number.isInteger(initialStep)
    ? Math.min(6, Math.max(2, initialStep))
    : 2;
  const browserDraftKey = useMemo(
    () => scopedOnboardingDraftKey(draftOwnerKey),
    [draftOwnerKey],
  );
  const [step, setStep] = useState(safeInitialStep);
  const [stepDirection, setStepDirection] = useState<"forward" | "back">(
    "forward",
  );
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [accountDraftReadyForAutosave, setAccountDraftReadyForAutosave] =
    useState(false);
  const [localDraftDirty, setLocalDraftDirty] = useState(false);
  const [catalogFoods, setCatalogFoods] = useState<Food[]>(fallbackFoods);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationSessionEstablished, setVerificationSessionEstablished] =
    useState(false);
  const [search, setSearch] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [announcement, setAnnouncement] = useState("");
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningMeals, setWarningMeals] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [completionPhase, setCompletionPhase] = useState<
    "saving" | "generating" | null
  >(null);
  const [onboardingCompletionSaved, setOnboardingCompletionSaved] =
    useState(false);
  const [generationRecoveryKey, setGenerationRecoveryKey] = useState<
    string | null
  >(null);
  const [exitPending, setExitPending] = useState(false);
  const [pageErrors, setPageErrors] = useState<PageError[]>([]);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [apiErrorContext, setApiErrorContext] =
    useState<OnboardingErrorContext | null>(null);
  const [errorHeading, setErrorHeading] = useState("Please review this step.");
  const [draftPersistenceIssue, setDraftPersistenceIssue] =
    useState<DraftPersistenceIssue | null>(null);
  const [draftSyncState, setDraftSyncState] = useState<
    "checking" | "saved" | "browser-only"
  >("checking");
  const [browserDraftAvailable, setBrowserDraftAvailable] = useState(
    Boolean(browserDraftKey),
  );
  const [draftRetryPending, setDraftRetryPending] = useState(false);
  const [resendPending, setResendPending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftIssueSignatureRef = useRef<string | null>(null);
  const generationKeyRef = useRef<string | null>(null);
  const safeNavigationStartedRef = useRef(false);
  const registrationEmailRef = useRef<string | null | undefined>(undefined);
  const legacyEmailSanitizedRef = useRef(false);
  const localDraftChangedRef = useRef(false);

  function markDraftLocallyChanged() {
    localDraftChangedRef.current = true;
    setLocalDraftDirty(true);
    if (onboardingCompletionSaved) {
      setOnboardingCompletionSaved(false);
      generationKeyRef.current = null;
      setGenerationRecoveryKey(null);
    }
  }

  const reportDraftPersistenceIssue = useCallback(
    (operation: DraftPersistenceIssue["operation"], error: ApiError) => {
      const signature = `${operation}:${error.code}:${error.message}`;
      setDraftSyncState("browser-only");
      if (draftIssueSignatureRef.current === signature) return;
      draftIssueSignatureRef.current = signature;
      setDraftPersistenceIssue({ operation, error });
    },
    [],
  );

  const markDraftSynced = useCallback(() => {
    const recovered = draftIssueSignatureRef.current !== null;
    draftIssueSignatureRef.current = null;
    localDraftChangedRef.current = false;
    setDraftPersistenceIssue(null);
    setDraftSyncState("saved");
    setLocalDraftDirty(false);
    if (recovered) {
      setAnnouncement("Onboarding progress is saved to your account again.");
    }
  }, []);

  const clearDraftPersistenceIssue = useCallback(() => {
    draftIssueSignatureRef.current = null;
    setDraftPersistenceIssue(null);
    setDraftSyncState("checking");
  }, []);

  const loadCatalogFoods = useCallback(async (query = "") => {
    try {
      const response = await fetch(
        query
          ? `/api/foods?limit=100&q=${encodeURIComponent(query)}`
          : "/api/foods",
      );
      if (!response.ok) return false;
      const result = (await response.json()) as {
        data?: Array<{
          slug: string;
          english_name: string;
          categories?: string[];
          plan_eligible: boolean;
          brand_name?: string | null;
          variant_name?: string | null;
          gtin?: string | null;
          catalog_status?: FoodPickerItem["catalogStatus"];
          nutrition?: FoodNutritionFacts | null;
          source?: FoodSourceSummary | null;
        }>;
      };
      if (!Array.isArray(result.data)) return false;
      const nextFoods = result.data.map((food) => ({
          id: food.slug,
          name: food.english_name,
          categories: food.categories ?? [],
          planEligible: food.plan_eligible,
          brandName: food.brand_name,
          variantName: food.variant_name,
          gtin: food.gtin,
          catalogStatus: food.catalog_status,
          nutrition: food.nutrition,
          source: food.source,
        }));
      setCatalogFoods((current) => {
        if (!query) return nextFoods;
        const merged = new Map(current.map((food) => [food.id, food]));
        nextFoods.forEach((food) => merged.set(food.id, food));
        return [...merged.values()];
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const queueDraftPersistence = useCallback(
    (currentStep: number, draftSnapshot: Draft) => {
      const save = draftSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const fallback = clientApiError(
            "DRAFT_SAVE_NETWORK_ERROR",
            "Onboarding progress could not be saved to your account.",
            "The current information remains on this page. When account-scoped browser storage is available, it is retained there too; check the connection and try account sync again.",
            {
              retryable: true,
              action: { kind: "retry", label: "Try again" },
            },
          );
          try {
            const response = await fetch("/api/onboarding", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                currentStep,
                draft: draftSnapshot,
              }),
            });
            if (!response.ok) {
              const result =
                typeof response.json === "function"
                  ? await response.json().catch(() => null)
                  : null;
              throw apiErrorFromPayload(
                result,
                clientApiError(
                  "DRAFT_SAVE_RESPONSE_INVALID",
                  "The account did not accept this onboarding autosave.",
                  "The current information remains on this page. Review the sync code, then try account sync again.",
                  {
                    retryable: true,
                    action: { kind: "retry", label: "Try again" },
                  },
                ),
              );
            }
            markDraftSynced();
          } catch (error) {
            const publicError = apiErrorFromPayload({ error }, fallback);
            reportDraftPersistenceIssue("save", publicError);
            throw publicError;
          }
        });
      draftSaveQueueRef.current = save;
      return save;
    },
    [markDraftSynced, reportDraftPersistenceIssue],
  );

  const loadAccountDraft = useCallback(
    async (browserSavedAt: number) => {
      const fallback = clientApiError(
        "DRAFT_LOAD_NETWORK_ERROR",
        "Saved account progress could not be loaded.",
        "You can continue with the current information on this page. An account-scoped browser copy is used only when browser storage is available.",
        {
          retryable: true,
          action: { kind: "retry", label: "Try account sync" },
        },
      );
      setAccountDraftReadyForAutosave(false);
      try {
        const response = await fetch("/api/onboarding");
        const result =
          typeof response.json === "function"
            ? ((await response.json().catch(() => null)) as
                | {
                    data?: {
                      currentStep?: number;
                      draft?: Partial<Draft>;
                      updatedAt?: string | null;
                    };
                    error?: ApiError | null;
                  }
                | null)
            : null;
        if (!response.ok) {
          throw apiErrorFromPayload(result, fallback);
        }
        if (!result || !("data" in result)) {
          throw clientApiError(
            "DRAFT_LOAD_RESPONSE_INVALID",
            "The account returned an unreadable saved-progress response.",
            "You can continue with the current information on this page and try account sync again.",
            {
              retryable: true,
              action: { kind: "retry", label: "Try account sync" },
            },
          );
        }
        const accountUpdatedAt = result.data?.updatedAt
          ? Date.parse(result.data.updatedAt)
          : 0;
        const accountDraftWins =
          !localDraftChangedRef.current &&
          (!browserSavedAt ||
            (Number.isFinite(accountUpdatedAt) &&
              accountUpdatedAt >= browserSavedAt));
        if (result.data?.draft && accountDraftWins) {
          const restored = normalizeRestoredDraft(result.data.draft);
          setDraft((current) => ({ ...current, ...restored }));
        }
        const accountStep = result.data?.currentStep;
        if (
          accountDraftWins &&
          typeof accountStep === "number" &&
          Number.isInteger(accountStep) &&
          accountStep >= 3
        ) {
          const restoredStep = Math.min(6, accountStep);
          setStep((currentStep) => {
            setStepDirection(
              restoredStep < currentStep ? "back" : "forward",
            );
            return restoredStep;
          });
        }
        if (accountDraftWins) {
          localDraftChangedRef.current = false;
          setLocalDraftDirty(false);
        }
        clearDraftPersistenceIssue();
        setAccountDraftReadyForAutosave(true);
        return true;
      } catch (error) {
        reportDraftPersistenceIssue(
          "load",
          apiErrorFromPayload({ error }, fallback),
        );
        return false;
      } finally {
        setDraftHydrated(true);
      }
    },
    [clearDraftPersistenceIssue, reportDraftPersistenceIssue],
  );

  useEffect(() => {
    if (registrationEmailRef.current === undefined) {
      let storedHandoff: string | null = null;
      try {
        storedHandoff = window.sessionStorage.getItem(
          REGISTRATION_EMAIL_HANDOFF_KEY,
        );
        window.sessionStorage.removeItem(REGISTRATION_EMAIL_HANDOFF_KEY);
      } catch {
        // The verification email remains editable when storage is unavailable.
      }
      registrationEmailRef.current =
        readRegistrationEmailHandoff(storedHandoff) ??
        normalizeRegistrationEmail(email);
    }

    const handedOffEmail = registrationEmailRef.current;
    const timer = handedOffEmail
      ? window.setTimeout(() => {
          setVerificationEmail(handedOffEmail);
          setResendSeconds(60);
        }, 0)
      : null;

    if (email && !legacyEmailSanitizedRef.current) {
      legacyEmailSanitizedRef.current = true;
      router.replace(`/onboarding?step=${safeInitialStep}`);
    }

    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [email, router, safeInitialStep]);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
    const detectedTimeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setDraft((current) =>
      current.timeZone === "UTC"
        ? { ...current, timeZone: detectedTimeZone }
        : current,
    );

    const local = browserStorage("localStorage");
    // Unscoped pre-Beta.3 drafts cannot be safely attributed on a shared
    // browser, so remove them without restoring their sensitive contents.
    removeStorage(local, UNSCOPED_ONBOARDING_DRAFT_KEY);
    removeStorage(local, LEGACY_ONBOARDING_DRAFT_KEY);
    const saved = browserDraftKey ? readStorage(local, browserDraftKey) : null;
    let browserSavedAt = 0;
    setBrowserDraftAvailable(Boolean(local && browserDraftKey));
    setOnboardingCompletionSaved(false);
    generationKeyRef.current = null;
    setGenerationRecoveryKey(null);
    if (saved) {
      try {
        const restored = parseStoredDraft(saved);
        browserSavedAt = restored.savedAt;
        setDraft((current) => ({ ...current, ...restored.draft }));
        if (restored.currentStep !== null) {
          setStepDirection(
            restored.currentStep < safeInitialStep ? "back" : "forward",
          );
          setStep(restored.currentStep);
        }
        setOnboardingCompletionSaved(restored.onboardingCompleted);
        generationKeyRef.current = restored.generationKey;
        setGenerationRecoveryKey(restored.generationKey);
      } catch {
        if (browserDraftKey) removeStorage(local, browserDraftKey);
      }
    }
    if (safeInitialStep === 2 && !browserDraftKey) {
      // A newly registered account has no authenticated session until its OTP
      // is verified. That expected state must not look like a draft-load
      // failure. router.refresh() supplies the user scope after verification
      // and causes this effect to load the account draft then.
      setAccountDraftReadyForAutosave(false);
      setDraftHydrated(true);
    } else {
      void loadAccountDraft(browserSavedAt);
    }
    if (safeInitialStep >= 3) {
      window.setTimeout(() => {
        void loadCatalogFoods();
      }, 0);
    }
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, [browserDraftKey, loadAccountDraft, loadCatalogFoods, safeInitialStep]);

  useEffect(() => {
    if (safeNavigationStartedRef.current) return;
    if (!draftHydrated) return;
    if (!accountDraftReadyForAutosave && !localDraftDirty) return;
    if (!browserDraftKey) {
      const unavailableTimer = window.setTimeout(
        () => setBrowserDraftAvailable(false),
        0,
      );
      return () => window.clearTimeout(unavailableTimer);
    }
    const saved = writeStorage(
      browserStorage("localStorage"),
      browserDraftKey,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        currentStep: step,
        draft,
        onboardingCompleted: onboardingCompletionSaved,
        generationKey: generationRecoveryKey,
      }),
    );
    const availabilityTimer = window.setTimeout(
      () => setBrowserDraftAvailable(saved),
      0,
    );
    return () => window.clearTimeout(availabilityTimer);
  }, [
    accountDraftReadyForAutosave,
    browserDraftKey,
    draft,
    draftHydrated,
    localDraftDirty,
    onboardingCompletionSaved,
    generationRecoveryKey,
    step,
  ]);

  useEffect(() => {
    if (safeNavigationStartedRef.current) return;
    if (
      step < 3 ||
      !draftHydrated ||
      !accountDraftReadyForAutosave ||
      onboardingCompletionSaved
    ) {
      return;
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      draftSaveTimerRef.current = null;
      void queueDraftPersistence(step, draft).catch(() => undefined);
    }, 450);
    return () => {
      if (draftSaveTimerRef.current !== null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [
    accountDraftReadyForAutosave,
    draft,
    draftHydrated,
    onboardingCompletionSaved,
    queueDraftPersistence,
    step,
  ]);

  useEffect(() => {
    if (step !== 2 || resendSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setResendSeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [resendSeconds, step]);

  const currentKg = useMemo(() => {
    const value = Number(draft.currentWeight);
    if (!Number.isFinite(value)) return null;
    return draft.unit === "kg" ? value : value / LB_PER_KG;
  }, [draft.currentWeight, draft.unit]);
  const targetKg = useMemo(() => {
    const value = Number(draft.targetWeight);
    if (!Number.isFinite(value)) return null;
    return draft.unit === "kg" ? value : value / LB_PER_KG;
  }, [draft.targetWeight, draft.unit]);

  function showPageErrors(
    errors: PageError[],
    heading = "Please review this step.",
  ) {
    setApiError(null);
    setApiErrorContext(null);
    setErrorHeading(heading);
    setPageErrors(errors);
    setAnnouncement("");
    window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
  }

  function showApiError(
    error: ApiError,
    heading: string,
    context: OnboardingErrorContext,
    field?: string,
  ) {
    setPageErrors(field ? [{ field, message: error.message }] : []);
    setErrorHeading(heading);
    setApiError(error);
    setApiErrorContext(context);
    setAnnouncement("");
    window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
  }

  function hasPageError(field: string) {
    return pageErrors.some((error) => error.field === field);
  }

  function goToStep(nextStep: number, focusHeading = true) {
    if (completionPhase !== null) return;
    markDraftLocallyChanged();
    setPageErrors([]);
    setApiError(null);
    setApiErrorContext(null);
    setStepDirection(nextStep < step ? "back" : "forward");
    setStep(nextStep);
    if (focusHeading) {
      window.requestAnimationFrame(() => {
        document.getElementById("onboarding-step-heading")?.focus();
      });
    }
  }

  function goToStepWithErrors(
    nextStep: number,
    errors: PageError[],
    heading: string,
  ) {
    markDraftLocallyChanged();
    setStepDirection(nextStep < step ? "back" : "forward");
    setStep(nextStep);
    showPageErrors(errors, heading);
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (completionPhase !== null) return;
    markDraftLocallyChanged();
    setPageErrors([]);
    setApiError(null);
    setApiErrorContext(null);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function validateGoalStep(): PageError[] {
    const errors: PageError[] = [];
    const currentWeight = Number(draft.currentWeight);
    const targetWeight = Number(draft.targetWeight);
    if (!draft.currentWeight.trim()) {
      errors.push({
        field: "currentWeight",
        message: "Enter your current weight.",
      });
    } else if (!Number.isFinite(currentWeight) || currentWeight <= 0) {
      errors.push({
        field: "currentWeight",
        message: "Current weight must be greater than zero.",
      });
    }
    if (!draft.targetWeight.trim()) {
      errors.push({
        field: "targetWeight",
        message: "Enter your target weight.",
      });
    } else if (!Number.isFinite(targetWeight) || targetWeight <= 0) {
      errors.push({
        field: "targetWeight",
        message: "Target weight must be greater than zero.",
      });
    }
    if (!draft.goalType) {
      errors.push({
        field: "goalType",
        message: "Choose a goal type.",
      });
    }
    if (!draft.targetDate) {
      errors.push({
        field: "targetDate",
        message: "Choose a target date.",
      });
    }
    return errors;
  }

  function validateLifestyleStep(): PageError[] {
    const errors: PageError[] = [];
    const trainingDays = Number(draft.trainingDays);
    const parsedHeight = parseOptionalHeight(draft.height);
    if (!draft.height.trim()) {
      errors.push({
        field: "height",
        message: "Choose your height from the list.",
      });
    } else if (!parsedHeight.ok || parsedHeight.heightCm === null) {
      errors.push({
        field: "height",
        message:
          "Choose a height from 50 to 300 cm using the centimeters or feet-and-inches lists.",
      });
    }
    if (!draft.activity) {
      errors.push({
        field: "activity",
        message: "Choose an activity level.",
      });
    }
    if (
      !draft.trainingDays.trim() ||
      !Number.isInteger(trainingDays) ||
      trainingDays < 0 ||
      trainingDays > 7
    ) {
      errors.push({
        field: "trainingDays",
        message: "Strength training days must be a whole number from 0 to 7.",
      });
    }
    if (!draft.timeZone) {
      errors.push({
        field: "timeZone",
        message: "Choose a time zone.",
      });
    }
    return errors;
  }

  function continueFromGoal() {
    const errors = validateGoalStep();
    if (errors.length > 0) {
      showPageErrors(errors);
      return;
    }
    goToStep(5);
  }

  function continueFromLifestyle() {
    const errors = validateLifestyleStep();
    if (errors.length > 0) {
      showPageErrors(errors);
      return;
    }
    goToStep(6);
  }

  function addFood(meal: Meal, food: Food) {
    if (!food.planEligible) {
      setAnnouncement(
        `${food.name} is saved for reference but is not yet eligible for generated plans.`,
      );
      return;
    }
    markDraftLocallyChanged();
    setDraft((current) => ({
      ...current,
      meals: {
        ...current.meals,
        [meal]: normalizeMealFoodSlugs([...current.meals[meal], food.id]),
      },
    }));
    setAnnouncement(
      draft.meals[meal].includes(food.id)
        ? `${food.name} is already in ${meal}.`
        : `${food.name} added to ${meal}.`,
    );
  }

  function setMeal(meal: Meal, ids: string[]) {
    markDraftLocallyChanged();
    setDraft((current) => ({
      ...current,
      meals: { ...current.meals, [meal]: normalizeMealFoodSlugs(ids) },
      acknowledgedWarnings: [],
    }));
  }

  function missingCategories(meal: Meal) {
    const required: Record<Meal, string[]> = {
      breakfast: ["Carbohydrate", "Protein"],
      lunch: ["Carbohydrate", "Protein", "Vegetable"],
      dinner: ["Carbohydrate", "Protein", "Vegetable"],
    };
    const categories = new Set(
      draft.meals[meal].flatMap(
        (id) =>
          catalogFoods.find((food) => food.id === id)?.categories ?? [],
      ),
    );
    return required[meal].filter((category) => !categories.has(category));
  }

  function mealWarnings(): AcknowledgedWarning[] {
    return (Object.keys(draft.meals) as Meal[]).flatMap((meal) =>
      missingCategories(meal).map((category) => ({
        mealType: meal,
        warningCode: `missing_${category.toLowerCase()}`,
        contextVersion: "meal-composition-v1" as const,
      })),
    );
  }

  function mealEligibilityErrors(): PageError[] {
    const selectedIds = [
      ...new Set((Object.values(draft.meals) as string[][]).flat()),
    ];
    const ineligibleNames = selectedIds.flatMap((id) => {
      const food = catalogFoods.find((item) => item.id === id);
      if (food?.planEligible) return [];
      return [food?.name ?? id];
    });
    return ineligibleNames.length
      ? [
          {
            field: "mealPreferences",
            message: `${ineligibleNames.join(", ")} cannot be used for generated plans yet. Remove ${ineligibleNames.length === 1 ? "it" : "them"} from meal preferences.`,
          },
        ]
      : [];
  }

  function warningMessages(warnings: AcknowledgedWarning[]) {
    return (Object.keys(draft.meals) as Meal[]).flatMap((meal) => {
      const categories = warnings
        .filter((warning) => warning.mealType === meal)
        .map((warning) => warning.warningCode.replace("missing_", ""));
      if (!categories.length) return [];
      const formatted =
        categories.length === 1
          ? categories[0]
          : `${categories.slice(0, -1).join(", ")} and ${categories.at(-1)}`;
      return [
        `${meal[0].toUpperCase() + meal.slice(1)} is missing ${formatted}`,
      ];
    });
  }

  async function verifyOtp(resumeVerifiedSession = false) {
    if (
      !resumeVerifiedSession &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verificationEmail.trim())
    ) {
      showPageErrors([
        {
          field: "verificationEmail",
          message: "Enter the email address awaiting verification.",
        },
      ]);
      return;
    }
    if (!resumeVerifiedSession && otp.join("").length !== 6) {
      showPageErrors([
        {
          field: "verificationCode",
          message: "Enter all six verification digits.",
        },
      ]);
      return;
    }
    setPageErrors([]);
    setApiError(null);
    setApiErrorContext(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          resumeVerifiedSession
            ? { resume: true }
            : {
                email: verificationEmail.trim(),
                token: otp.join(""),
              },
        ),
      });
      if (!response.ok) {
        const result =
          typeof response.json === "function"
            ? await response.json().catch(() => null)
            : null;
        const parsed = apiErrorFromPayload(
          result,
          clientApiError(
            "VERIFICATION_RESPONSE_INVALID",
            "Email verification could not be completed.",
            "Try the same verification again. Request a new code only if the current code is reported as invalid or expired.",
            {
              retryable: true,
              action: { kind: "retry", label: "Try verification again" },
            },
          ),
        );
        const profileRecovery = VERIFIED_PROFILE_RECOVERY_CODES.has(
          parsed.code,
        );
        if (profileRecovery) {
          setVerificationSessionEstablished(true);
        }
        showApiError(
          parsed.action
            ? parsed
            : {
                ...parsed,
                action: { kind: "retry", label: "Try verification again" },
              },
          "We could not verify your email.",
          resumeVerifiedSession ? "resume-verify" : "verify",
          profileRecovery || resumeVerifiedSession
            ? undefined
            : "verificationCode",
        );
        return;
      }
      await loadCatalogFoods();
      const local = browserStorage("localStorage");
      removeStorage(local, REGISTRATION_DRAFT_KEY);
      removeStorage(local, LEGACY_REGISTRATION_DRAFT_KEY);
      // Email verification may establish the first authenticated server
      // session. Refresh the server props so subsequent browser drafts receive
      // this account's private storage scope without exposing it in the URL.
      router.refresh();
      goToStep(3);
      setAnnouncement("Email verified. Food preferences are next.");
    } catch {
      showApiError(
        clientApiError(
          "VERIFICATION_NETWORK_ERROR",
          "The account service could not be reached.",
          resumeVerifiedSession
            ? "Your verified session is unchanged. Check the connection, then check profile setup again."
            : "Check your connection, then try the same verification again. Request a new code only if this code is reported as invalid or expired.",
          {
            retryable: true,
            action: {
              kind: "retry",
              label: resumeVerifiedSession
                ? "Check profile setup again"
                : "Try verification again",
            },
          },
        ),
        "We could not verify your email.",
        resumeVerifiedSession ? "resume-verify" : "verify",
      );
    } finally {
      setPending(false);
    }
  }

  async function resendOtp() {
    const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      verificationEmail.trim(),
    );
    if (!emailIsValid || resendSeconds > 0 || resendPending) {
      if (!emailIsValid) {
        showPageErrors([
          {
            field: "verificationEmail",
            message: "Enter the email address awaiting verification.",
          },
        ]);
      }
      return;
    }
    setResendPending(true);
    try {
      const response = await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: verificationEmail.trim() }),
      });
      if (!response.ok) {
        const result =
          typeof response.json === "function"
            ? await response.json().catch(() => null)
            : null;
        showApiError(
          apiErrorFromPayload(
            result,
            clientApiError(
              "VERIFICATION_EMAIL_RESPONSE_INVALID",
              "A verification email could not be sent right now.",
              "This response does not indicate whether an account exists. Wait briefly and request one new code.",
              {
                retryable: true,
                action: { kind: "retry", label: "Try again" },
              },
            ),
          ),
          "We could not request a new code.",
          "resend",
        );
        return;
      }
      setApiError(null);
      setApiErrorContext(null);
      setResendSeconds(60);
      setAnnouncement(
        "A new verification code was requested. Check the latest email.",
      );
    } catch {
      showApiError(
        clientApiError(
          "VERIFICATION_EMAIL_NETWORK_ERROR",
          "The account service could not be reached.",
          "This does not indicate whether an account exists. Check the connection, wait briefly, and request one new code.",
          {
            retryable: true,
            action: { kind: "retry", label: "Try again" },
          },
        ),
        "We could not request a new code.",
        "resend",
      );
    } finally {
      setResendPending(false);
    }
  }

  function continueFromMeals() {
    const eligibilityErrors = mealEligibilityErrors();
    if (eligibilityErrors.length) {
      showPageErrors(
        eligibilityErrors,
        "Remove foods that are not plan eligible.",
      );
      return;
    }
    const warnings = mealWarnings();
    if (warnings.length) {
      setWarningMeals(warningMessages(warnings));
      setWarningOpen(true);
      return;
    }
    goToStep(4);
  }

  function switchUnit(next: Unit) {
    if (next === draft.unit) return;
    markDraftLocallyChanged();
    setPageErrors([]);
    const convert = (raw: string) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return raw;
      return (next === "lb" ? value * LB_PER_KG : value / LB_PER_KG).toFixed(1);
    };
    setDraft((current) => ({
      ...current,
      unit: next,
      currentWeight: convert(current.currentWeight),
      targetWeight: convert(current.targetWeight),
    }));
  }

  function persistCompletionRecovery(generationKey: string | null) {
    if (!browserDraftKey) return;
    const saved = writeStorage(
      browserStorage("localStorage"),
      browserDraftKey,
      JSON.stringify({
        version: 1,
        savedAt: 0,
        currentStep: 6,
        draft,
        onboardingCompleted: true,
        generationKey,
      }),
    );
    setBrowserDraftAvailable(saved);
  }

  async function saveAndExit() {
    if (onboardingCompletionSaved) {
      safeNavigationStartedRef.current = true;
      if (browserDraftKey) {
        removeStorage(browserStorage("localStorage"), browserDraftKey);
      }
      router.push("/today");
      return;
    }
    if (!accountDraftReadyForAutosave) return;
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    setExitPending(true);
    setPageErrors([]);
    setApiError(null);
    setApiErrorContext(null);
    try {
      await queueDraftPersistence(step, draft);
      router.push("/today");
    } catch (error) {
      showApiError(
        apiErrorFromPayload(
          { error },
          clientApiError(
            "DRAFT_SAVE_NETWORK_ERROR",
            "Onboarding progress could not be saved.",
            "The current form values are unchanged. Check the connection and try again.",
            {
              retryable: true,
              action: { kind: "retry", label: "Try again" },
            },
          ),
        ),
        "We could not save and exit.",
        "save-draft",
      );
    } finally {
      setExitPending(false);
    }
  }

  async function retryDraftPersistence() {
    if (draftRetryPending) return;
    setDraftRetryPending(true);
    setAnnouncement("Retrying account draft sync.");
    try {
      if (draftPersistenceIssue?.operation === "load") {
        let browserSavedAt = 0;
        if (browserDraftKey) {
          const local = browserStorage("localStorage");
          const saved = readStorage(local, browserDraftKey);
          if (saved) {
            try {
              browserSavedAt = parseStoredDraft(saved).savedAt;
            } catch {
              removeStorage(local, browserDraftKey);
            }
          }
        }
        await loadAccountDraft(browserSavedAt);
      } else {
        await queueDraftPersistence(step, draft);
      }
    } catch {
      // Persistence helpers keep one visible browser-only status and avoid
      // turning background sync retries into repeated assertive alerts.
    } finally {
      setDraftRetryPending(false);
    }
  }

  async function finish(generate: boolean) {
    const mealErrors = mealEligibilityErrors();
    if (mealErrors.length > 0) {
      goToStepWithErrors(
        3,
        mealErrors,
        "Review your meal selections before finishing.",
      );
      return;
    }
    const goalErrors = validateGoalStep();
    if (goalErrors.length > 0) {
      goToStepWithErrors(
        4,
        goalErrors,
        "Complete your goal and timeline before finishing.",
      );
      return;
    }
    const lifestyleErrors = validateLifestyleStep();
    if (lifestyleErrors.length > 0) {
      goToStepWithErrors(
        5,
        lifestyleErrors,
        "Complete the required lifestyle details before finishing.",
      );
      return;
    }
    if (!confirmed) {
      showPageErrors([
        {
          field: "confirmation",
          message:
            "Confirm that the information is ready before completing onboarding.",
        },
      ]);
      return;
    }
    setPageErrors([]);
    setApiError(null);
    setApiErrorContext(null);
    setPending(true);
    setCompletionPhase(
      onboardingCompletionSaved && generate ? "generating" : "saving",
    );
    if (!onboardingCompletionSaved) {
      try {
        if (draftSaveTimerRef.current !== null) {
          window.clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
        await draftSaveQueueRef.current.catch(() => undefined);
        const response = await fetch("/api/onboarding", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...draft,
            completed: true,
          }),
        });
        const result =
          typeof response.json === "function"
            ? ((await response.json().catch(() => null)) as ApiFailure | null)
            : null;
        if (!response.ok) {
          const failure = completionFailure(result);
          if (result?.error?.code === "TOO_MANY_RESTRICTIONS") {
            const allergyCount = draft.allergies
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean).length;
            failure.field = allergyCount > 50 ? "allergies" : "restrictions";
          }
          const parsedError = apiErrorFromPayload(
            result,
            clientApiError(
              "ONBOARDING_RESPONSE_INVALID",
              "The final onboarding step could not be saved.",
              "Your information remains on this page. Wait briefly and try again.",
              {
                retryable: true,
                action: { kind: "retry", label: "Try again" },
              },
            ),
          );
          const structuredField = errorCodeFields[parsedError.code];
          if (
            structuredField &&
            parsedError.code !== "TOO_MANY_RESTRICTIONS"
          ) {
            failure.field = structuredField;
          }
          const contextualDetails = failure.message.startsWith(
            `${parsedError.message} `,
          )
            ? failure.message.slice(parsedError.message.length + 1)
            : failure.message === parsedError.message
              ? undefined
              : failure.message;
          const failureStep = fieldFocusTargets[failure.field]?.step ?? step;
          setStepDirection(failureStep < step ? "back" : "forward");
          setStep(failureStep);
          showApiError(
            parsedError.details || !contextualDetails
              ? parsedError
              : { ...parsedError, details: contextualDetails },
            failure.heading,
            generate ? "complete-generate" : "complete-today",
            failure.field,
          );
          setPending(false);
          setCompletionPhase(null);
          return;
        }
        setOnboardingCompletionSaved(true);
        persistCompletionRecovery(null);
      } catch {
        showApiError(
          clientApiError(
            "ONBOARDING_NETWORK_ERROR",
            "Onboarding services could not be reached.",
            "The final step was not confirmed. Your information remains on this page.",
            {
              retryable: true,
              action: { kind: "retry", label: "Try again" },
            },
          ),
          "We could not complete onboarding.",
          generate ? "complete-generate" : "complete-today",
        );
        setPending(false);
        setCompletionPhase(null);
        return;
      }
    }

    if (!generate) {
      safeNavigationStartedRef.current = true;
      if (browserDraftKey) {
        removeStorage(browserStorage("localStorage"), browserDraftKey);
      }
      router.push("/today");
      return;
    }

    setCompletionPhase("generating");
    try {
      const idempotencyKey =
        generationKeyRef.current ?? crypto.randomUUID();
      generationKeyRef.current = idempotencyKey;
      setGenerationRecoveryKey(idempotencyKey);
      persistCompletionRecovery(idempotencyKey);
      const generationResponse = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      });
      const generationResult =
        typeof generationResponse.json === "function"
          ? ((await generationResponse.json().catch(() => null)) as
              | PlanGenerationResult
              | null)
          : null;
      if (!generationResponse.ok) {
        generationKeyRef.current = null;
        setGenerationRecoveryKey(null);
        persistCompletionRecovery(null);
        showApiError(
          apiErrorFromPayload(
            generationResult,
            clientApiError(
              "PLAN_RESPONSE_INVALID",
              "A new plan could not be generated.",
              "Your profile is saved and any accepted plan is unchanged. Try one new generation request, or go to Today.",
              {
                retryable: true,
                action: { kind: "retry", label: "Generate again" },
              },
            ),
          ),
          "Your profile is complete.",
          "generate",
        );
        return;
      }
      if (
        generationResponse.status === 202 ||
        generationResult?.data?.status === "pending" ||
        generationResult?.data?.status === "processing"
      ) {
        showPageErrors(
          [
            {
              field: "generation",
              message:
                "Your profile is saved and plan generation is still processing. Wait a moment, then choose Generate my plan again to check the same request.",
            },
          ],
          "Your plan is still being generated.",
        );
        return;
      }
      const planId = generationResult?.data?.planId;
      if (typeof planId !== "string" || !planId.trim()) {
        generationKeyRef.current = null;
        setGenerationRecoveryKey(null);
        persistCompletionRecovery(null);
        showApiError(
          clientApiError(
            "PLAN_RESULT_MISSING",
            "The completed request did not include a plan.",
            "Your profile is saved and any accepted plan is unchanged. Try one new generation request, or go to Today.",
            {
              retryable: true,
              action: { kind: "retry", label: "Generate again" },
            },
          ),
          "Your profile is complete.",
          "generate",
        );
        return;
      }
      generationKeyRef.current = null;
      safeNavigationStartedRef.current = true;
      if (browserDraftKey) {
        removeStorage(browserStorage("localStorage"), browserDraftKey);
      }
      router.push("/plan");
    } catch {
      showApiError(
        clientApiError(
          "PLAN_NETWORK_ERROR",
          "Plan generation could not start.",
          "Your profile is saved and any accepted plan is unchanged. Check the connection, then try Generate my plan again or go to Today.",
          {
            retryable: true,
            action: { kind: "retry", label: "Generate again" },
          },
        ),
        "Your profile is complete.",
        "generate",
      );
    } finally {
      setPending(false);
      setCompletionPhase(null);
    }
  }

  function onboardingErrorFocusTarget(): OnboardingFocusTarget | null {
    const code = apiError?.code ?? "";
    const mappedField = errorCodeFields[code];
    if (mappedField) {
      if (code === "TOO_MANY_RESTRICTIONS") {
        const field = pageErrors[0]?.field;
        if (field === "allergies" || field === "restrictions") {
          return fieldFocusTargets[field];
        }
      }
      return fieldFocusTargets[mappedField];
    }

    const explicitField = pageErrors.find(
      (error) => fieldFocusTargets[error.field],
    )?.field;
    if (explicitField) return fieldFocusTargets[explicitField];

    if (code === "INVALID_ONBOARDING") {
      const localError = validateGoalStep()[0] ?? validateLifestyleStep()[0];
      return localError
        ? fieldFocusTargets[localError.field]
        : fieldFocusTargets.profile;
    }

    if (apiErrorContext === "verify") {
      if (VERIFIED_PROFILE_RECOVERY_CODES.has(code)) return null;
      return fieldFocusTargets.verificationCode;
    }
    if (apiErrorContext === "resume-verify") return null;
    if (apiErrorContext === "resend") {
      return fieldFocusTargets.verificationEmail;
    }
    return null;
  }

  function focusOnboardingErrorTarget() {
    const target = onboardingErrorFocusTarget();
    if (!target) {
      errorSummaryRef.current?.focus();
      return;
    }
    setStepDirection(target.step < step ? "back" : "forward");
    setStep(target.step);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(target.selector)?.focus();
    });
  }

  function handleApiErrorAction() {
    if (apiError?.code === "CAPTCHA_FAILED") {
      window.location.reload();
      return;
    }
    const localTarget = onboardingErrorFocusTarget();
    const internalOnboardingAction =
      apiError?.action?.href?.startsWith("/onboarding") === true;
    if (
      localTarget &&
      (apiError?.action?.kind === "edit" || internalOnboardingAction)
    ) {
      focusOnboardingErrorTarget();
      return;
    }
    switch (apiErrorContext) {
      case "verify":
        if (VERIFIED_PROFILE_RECOVERY_CODES.has(apiError?.code ?? "")) {
          void verifyOtp(true);
        } else if (VERIFICATION_NEW_CODE_CODES.has(apiError?.code ?? "")) {
          void resendOtp();
        } else {
          void verifyOtp();
        }
        break;
      case "resume-verify":
        void verifyOtp(true);
        break;
      case "resend":
        void resendOtp();
        break;
      case "save-draft":
        void saveAndExit();
        break;
      case "complete-today":
        void finish(false);
        break;
      case "complete-generate":
      case "generate":
        void finish(true);
        break;
    }
  }

  const safetyFlag = draft.safety.length > 0;
  const apiFocusTarget = onboardingErrorFocusTarget();
  const apiActionIsLocal = Boolean(
    apiError?.action &&
      apiFocusTarget &&
      (apiError.action.kind === "edit" ||
        apiError.action.href?.startsWith("/onboarding")),
  );
  const displayedApiError =
    apiError && apiActionIsLocal && apiError.action
      ? {
          ...apiError,
          action: {
            kind: "edit" as const,
            label: apiError.action.label,
          },
        }
      : apiError;
  const apiActionCanRun =
    apiError?.action?.kind === "retry" ||
    apiActionIsLocal;
  const apiActionNeedsResendCooldown =
    apiErrorContext === "resend" ||
    (apiErrorContext === "verify" &&
      VERIFICATION_NEW_CODE_CODES.has(apiError?.code ?? ""));
  const topLevelContentClass = `onboarding-content${
    step === 3 ? " onboarding-content-food" : ""
  }`;
  const progressSaveLabel =
    step <= 2
      ? "Progress saves after verification"
      : draftSyncState === "saved"
        ? browserDraftAvailable
          ? "Saved in this browser and your account"
          : "Saved to your account · browser storage unavailable"
        : draftSyncState === "browser-only"
          ? browserDraftAvailable
            ? "Saved in this browser only"
            : "Not saved · browser storage and account sync unavailable"
          : browserDraftAvailable
            ? "Browser draft protected · checking account sync"
            : "Browser storage unavailable · checking account sync";

  return (
    <div className="onboarding-shell">
      <aside className="onboarding-rail">
        <div className="onboarding-rail-top">
          <BrandLink />
          <AppearanceControl />
        </div>
        <ol className="step-list">
          {stepLabels.map((label, index) => {
            const number = index + 1;
            return (
              <li className={`step-item ${number === step ? "active" : ""} ${number < step ? "complete" : ""}`} key={label} aria-current={number === step ? "step" : undefined}>
                <span className="step-number">{number < step ? <Check size={15} /> : number}</span>
                <span>{label}</span>
              </li>
            );
          })}
        </ol>
      </aside>

      <main id="main-content" className="onboarding-main">
        <div className="onboarding-header">
          <span className="mobile-progress">Step {step} of 6 · {stepLabels[step - 1]}</span>
          <span className="date-label">{progressSaveLabel}</span>
          {step > 2 ? <button className="text-link" disabled={exitPending || pending || (!accountDraftReadyForAutosave && !onboardingCompletionSaved)} type="button" onClick={saveAndExit}>{exitPending ? "Saving draft…" : "Save and exit"}</button> : <span />}
        </div>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
        {apiError || pageErrors.length > 0 || draftPersistenceIssue ? (
          <div className={topLevelContentClass} style={{ marginBottom: "1rem" }}>
            {displayedApiError ? (
              <ApiErrorNotice
                actionDisabled={
                  pending ||
                  exitPending ||
                  resendPending ||
                  (apiActionNeedsResendCooldown && resendSeconds > 0)
                }
                error={displayedApiError}
                heading={errorHeading}
                onAction={apiActionCanRun ? handleApiErrorAction : undefined}
                ref={errorSummaryRef}
              />
            ) : pageErrors.length > 0 ? (
              <div
                className="message-box error"
                ref={errorSummaryRef}
                role="alert"
                tabIndex={-1}
                style={{ marginBottom: "1rem" }}
              >
                <div>
                  <strong>{errorHeading}</strong>
                  <ul style={{ margin: ".35rem 0 0", paddingLeft: "1.2rem" }}>
                    {pageErrors.map((error) => (
                      <li key={`${error.field}:${error.message}`}>{error.message}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : draftPersistenceIssue ? (
              <div
                aria-atomic="true"
                className="message-box"
                role="status"
                style={{ marginBottom: "1rem" }}
              >
                <div>
                  <strong>
                    {draftPersistenceIssue.operation === "load"
                      ? "Account progress could not be loaded."
                      : browserDraftAvailable
                        ? "Saved in this browser only."
                        : "Progress is not saved yet."}
                  </strong>
                  <p>{draftPersistenceIssue.error.message}</p>
                  {draftPersistenceIssue.error.details ? (
                    <p>{draftPersistenceIssue.error.details}</p>
                  ) : null}
                  <code>Sync code: {draftPersistenceIssue.error.code}</code>
                  <div style={{ marginTop: ".75rem" }}>
                    {draftPersistenceIssue.error.action?.href ? (
                      <button
                        className="button button-quiet"
                        onClick={() =>
                          router.push(draftPersistenceIssue.error.action!.href!)
                        }
                        type="button"
                      >
                        {draftPersistenceIssue.error.action.label}
                      </button>
                    ) : (
                      <button
                        className="button button-quiet"
                        disabled={draftRetryPending}
                        onClick={() => void retryDraftPersistence()}
                        type="button"
                      >
                        {draftRetryPending ? "Syncing…" : "Try account sync"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div
          className={topLevelContentClass}
        >
          <div
            className="onboarding-step-transition"
            data-direction={stepDirection}
            key={step}
          >
          {step === 2 ? (
            <>
              <p className="eyebrow">Step 2 of 6</p>
              <h1 id="onboarding-step-heading" tabIndex={-1}>Check your email.</h1>
              <p>
                Enter the six-digit code for the account below. Returning later is
                safe: request a new code without creating another account. In local
                development, retrieve it from the captured-email service.
              </p>
              <label className="field" style={{ marginBottom: "1rem" }}>
                <span>Account email</span>
                <input
                  id="onboarding-verification-email"
                  aria-invalid={hasPageError("verificationEmail") || undefined}
                  autoComplete="email"
                  inputMode="email"
                  onChange={(event) => {
                    setPageErrors([]);
                    setApiError(null);
                    setApiErrorContext(null);
                    setVerificationEmail(event.target.value);
                    setResendSeconds(0);
                  }}
                  type="email"
                  value={verificationEmail}
                />
              </label>
              <div className="otp-grid" role="group" aria-label="Six-digit verification code" aria-invalid={hasPageError("verificationCode") || undefined}>
                {otp.map((digit, index) => (
                  <input
                    id={`onboarding-verification-code-${index + 1}`}
                    key={index}
                    ref={(element) => { otpRefs.current[index] = element; }}
                    aria-label={`Digit ${index + 1}`}
                    inputMode="numeric"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    maxLength={1}
                    value={digit}
                    onChange={(event) => {
                      const value = event.target.value.replace(/\D/g, "").slice(-1);
                      const next = [...otp];
                      next[index] = value;
                      setPageErrors([]);
                      setApiError(null);
                      setApiErrorContext(null);
                      setOtp(next);
                      if (value && index < 5) otpRefs.current[index + 1]?.focus();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Backspace" && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
                    }}
                    onPaste={(event) => {
                      const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                      if (pasted.length === 6) {
                        event.preventDefault();
                        setOtp(pasted.split(""));
                        otpRefs.current[5]?.focus();
                      }
                    }}
                  />
                ))}
              </div>
              <div className="form-row" style={{ marginTop: "1rem" }}>
                <span className="field-help">
                  Code requests use a generic response to protect account privacy.
                </span>
                <button
                  className="text-link"
                  type="button"
                  disabled={
                    !verificationEmail.trim() ||
                    resendSeconds > 0 ||
                    resendPending
                  }
                  onClick={resendOtp}
                >
                  {resendPending
                    ? "Requesting new code…"
                    : resendSeconds > 0
                      ? `Resend code in 00:${String(resendSeconds).padStart(2, "0")}`
                      : "Resend code"}
                </button>
              </div>
              <p className="field-help" style={{ marginTop: ".75rem" }}>
                Email already verified in this browser?{" "}
                <button
                  className="text-link"
                  disabled={pending}
                  onClick={() => void verifyOtp(true)}
                  type="button"
                >
                  Continue account setup
                </button>
              </p>
              <div className="onboarding-actions">
                <button className="button button-quiet" type="button" onClick={() => router.push(verificationSessionEstablished ? "/login" : "/register")}><ArrowLeft size={17} /> {verificationSessionEstablished ? "Use another account" : "Back"}</button>
                <div><button className="button button-dark" disabled={pending} type="button" onClick={() => void verifyOtp()}>{pending ? "Verifying…" : "Verify and continue"} <ArrowRight size={17} /></button></div>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <p className="eyebrow">Step 3 of 6</p>
              <h1 id="onboarding-step-heading" tabIndex={-1}>What works on your plate?</h1>
              <p>Add foods to each meal. Search, buttons, keyboard reordering, and drag-and-drop all lead to the same result.</p>
              <div className="food-picker">
                <FoodSearchPicker
                  foods={catalogFoods}
                  search={search}
                  onSearchChange={setSearch}
                  onAdd={addFood}
                  onCatalogChanged={loadCatalogFoods}
                />
                <div className="meal-destinations">
                  {(["breakfast", "lunch", "dinner"] as Meal[]).map((meal) => (
                    <MealDestination key={meal} meal={meal} ids={draft.meals[meal]} foods={catalogFoods} missingCategories={missingCategories(meal)} onChange={(ids) => setMeal(meal, ids)} announce={setAnnouncement} />
                  ))}
                </div>
              </div>
              <div className="onboarding-actions">
                <button className="button button-quiet" type="button" onClick={() => goToStep(2)}><ArrowLeft size={17} /> Back</button>
                <div><button className="button button-dark" type="button" onClick={continueFromMeals}>Continue <ArrowRight size={17} /></button></div>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <p className="eyebrow">Step 4 of 6</p>
              <h1 id="onboarding-step-heading" tabIndex={-1}>Set a direction, not a promise.</h1>
              <p>We&apos;ll show the implied pace and flag conflicts without forcing restriction to meet a date.</p>
              <div className="option-grid" style={{ marginBottom: "1rem" }}>
                {[
                  ["fat_loss", "Fat loss"], ["muscle_gain", "Muscle gain"], ["maintenance", "Maintenance"], ["recomposition", "Recomposition"],
                ].map(([value, label]) => (
                  <label className="option-card" key={value}><input type="radio" name="goal" checked={draft.goalType === value} onChange={() => update("goalType", value)} />{label}</label>
                ))}
              </div>
              <div className="field-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <label className="field"><span>Current weight</span><input id="onboarding-current-weight" inputMode="decimal" aria-invalid={hasPageError("currentWeight") || undefined} value={draft.currentWeight} onChange={(event) => update("currentWeight", event.target.value)} /></label>
                <label className="field"><span>Target weight</span><input id="onboarding-target-weight" inputMode="decimal" aria-invalid={hasPageError("targetWeight") || undefined} value={draft.targetWeight} onChange={(event) => update("targetWeight", event.target.value)} /></label>
                <label className="field"><span>Display unit</span><select value={draft.unit} onChange={(event) => switchUnit(event.target.value as Unit)}><option value="kg">kg</option><option value="lb">lb</option></select></label>
                <label className="field"><span>Target date</span><input id="onboarding-target-date" type="date" aria-invalid={hasPageError("targetDate") || undefined} value={draft.targetDate} onChange={(event) => update("targetDate", event.target.value)} /></label>
              </div>
              {currentKg && targetKg ? (
                <div className="message-box" style={{ marginTop: "1rem" }}>
                  <span>
                    Desired change: {Math.abs(currentKg - targetKg).toFixed(1)} kg.{" "}
                    {draft.goalType === "fat_loss" && targetKg > currentKg ? "The target direction conflicts with a fat-loss goal. Review either the goal type or target weight." : "The app will calculate the remaining days and implied weekly change from the selected date."}
                  </span>
                </div>
              ) : null}
              <div className="onboarding-actions">
                <button className="button button-quiet" type="button" onClick={() => goToStep(3)}><ArrowLeft size={17} /> Back</button>
                <div><button className="button button-dark" type="button" onClick={continueFromGoal}>Continue <ArrowRight size={17} /></button></div>
              </div>
            </>
          ) : null}

          {step === 5 ? (
            <>
              <p className="eyebrow">Step 5 of 6</p>
              <h1 id="onboarding-step-heading" tabIndex={-1}>Add the context your plan needs.</h1>
              <p>Height, activity, training, and time zone shape the deterministic plan estimate. Allergies, restrictions, safety context, and notes help avoid unsuitable suggestions.</p>
              <div className="field-grid onboarding-field-grid">
                <div className="onboarding-height-field">
                  <HeightPicker
                    invalid={hasPageError("height")}
                    onChange={(value) => update("height", value)}
                    preferredUnit={draft.unit}
                    value={draft.height}
                  />
                </div>
                <label className="field"><span>Activity level</span><select id="onboarding-activity" aria-invalid={hasPageError("activity") || undefined} value={draft.activity} onChange={(event) => update("activity", event.target.value)}><option value="low">Mostly seated</option><option value="light">Lightly active</option><option value="moderate">Moderately active</option><option value="high">Highly active</option></select></label>
                <label className="field"><span>Strength training days / week</span><input id="onboarding-training-days" type="number" min="0" max="7" aria-invalid={hasPageError("trainingDays") || undefined} value={draft.trainingDays} onChange={(event) => update("trainingDays", event.target.value)} /></label>
                <label className="field">
                  <span>IANA time zone</span>
                  <input
                    id="onboarding-time-zone"
                    aria-invalid={hasPageError("timeZone") || undefined}
                    list="onboarding-time-zones"
                    value={draft.timeZone}
                    onChange={(event) => update("timeZone", event.target.value)}
                    placeholder="America/New_York"
                  />
                  <datalist id="onboarding-time-zones">
                    {["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Asia/Shanghai"].map((zone) => <option value={zone} key={zone} />)}
                  </datalist>
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => {
                      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
                      update("timeZone", detected);
                      setAnnouncement(`Device time zone set to ${detected}.`);
                    }}
                  >
                    Use device time zone
                  </button>
                  <span className="field-help">
                    Detected automatically when possible. You can enter any valid IANA zone.
                  </span>
                </label>
                <label className="field"><span>Allergies</span><input id="onboarding-allergies" aria-invalid={hasPageError("allergies") || undefined} value={draft.allergies} onChange={(event) => update("allergies", event.target.value)} placeholder="Hard exclusions" /></label>
                <label className="field"><span>Dietary restrictions</span><input id="onboarding-restrictions" aria-invalid={hasPageError("restrictions") || undefined} value={draft.restrictions} onChange={(event) => update("restrictions", event.target.value)} /></label>
              </div>
              <fieldset style={{ border: 0, margin: "1.5rem 0 0", padding: 0 }}>
                <legend className="field-label">Optional safety context</legend>
                <p className="field-help">Choose any that apply so we can keep guidance non-restrictive and suggest professional support when appropriate.</p>
                <div className="option-grid" style={{ marginTop: ".7rem" }}>
                  {["Under 18", "Pregnant or nursing", "Eating-disorder history", "Relevant medical concern", "Dizziness, fainting, palpitations, or severe weakness"].map((label) => (
                    <label className="option-card" key={label}>
                      <input
                        type="checkbox"
                        checked={draft.safety.includes(label)}
                        onChange={(event) => update("safety", event.target.checked ? [...draft.safety, label] : draft.safety.filter((item) => item !== label))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="field" style={{ marginTop: "1rem" }}><span>Optional notes</span><textarea value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
              {safetyFlag ? (
                <div className="message-box" style={{ marginTop: "1rem" }}>
                  <ShieldCheck size={19} />
                  <span>Thank you for sharing. {BRAND.name} will not generate an aggressive calorie-restriction plan. Safe, non-restrictive tracking remains available, and a qualified healthcare professional or registered dietitian can help with individual guidance. Concerning symptoms such as fainting or heart palpitations warrant prompt medical attention.</span>
                </div>
              ) : null}
              <div className="onboarding-actions">
                <button className="button button-quiet" type="button" onClick={() => goToStep(4)}><ArrowLeft size={17} /> Back</button>
                <div><button className="button button-dark" type="button" onClick={continueFromLifestyle}>Review <ArrowRight size={17} /></button></div>
              </div>
            </>
          ) : null}

          {step === 6 ? (
            <>
              <p className="eyebrow">Step 6 of 6</p>
              <h1 id="onboarding-step-heading" tabIndex={-1}>Congratulations — your account and profile are ready. Let’s build your plan.</h1>
              <p>Review what you provided, what the app calculates, and exactly what may be sent to the selected AI provider.</p>
              <div className="settings-content">
                <section className="card">
                  <div className="card-title"><div><h2>Meals</h2><p>Provided by you</p></div><button className="text-link" disabled={completionPhase !== null} onClick={() => goToStep(3)} type="button">Edit</button></div>
                  <p className="field-help">{(["breakfast", "lunch", "dinner"] as Meal[]).map((meal) => `${meal}: ${draft.meals[meal].length} foods`).join(" · ")}</p>
                </section>
                <section className="card">
                  <div className="card-title"><div><h2>Goal and timeline</h2><p>Provided by you + calculated by the app</p></div><button className="text-link" disabled={completionPhase !== null} onClick={() => goToStep(4)} type="button">Edit</button></div>
                  <p className="field-help">{draft.goalType.replace("_", " ")} · {draft.currentWeight || "Missing"} {draft.unit} → {draft.targetWeight || "Missing"} {draft.unit} · {draft.targetDate || "No target date"}</p>
                </section>
                <section className="card">
                  <div className="card-title"><div><h2>Lifestyle, restrictions, and warnings</h2><p>Provided by you</p></div><button className="text-link" disabled={completionPhase !== null} onClick={() => goToStep(5)} type="button">Edit</button></div>
                  <p className="field-help">Height: {draft.height || "missing"} · Activity: {draft.activity} · Allergies: {draft.allergies || "none provided"} · Restrictions: {draft.restrictions || "none provided"} · Safety flags: {draft.safety.length}</p>
                </section>
                <section className="card">
                  <div className="card-title"><div><h2>Sent for plan generation</h2><p>Only after you choose Generate my plan</p></div></div>
                  <ul style={{ color: "var(--ink-soft)", fontSize: ".82rem", paddingLeft: "1.2rem" }}>
                    <li>Age, optional gender, confirmed height, preferred unit, and time zone.</li>
                    <li>Start/latest/target weights, goal, target date, activity, and training.</li>
                    <li>Exact verified food names and catalog IDs, including brand, product, and flavor names when selected; plus allergies, restrictions, and acknowledged warnings.</li>
                    <li>App-calculated ranges and safety flags. Passwords and raw OTP codes are never included.</li>
                  </ul>
                </section>
              </div>
              <label className="checkbox-row" style={{ marginTop: "1.2rem" }}>
                <input id="onboarding-confirmation" type="checkbox" disabled={completionPhase !== null} aria-invalid={hasPageError("confirmation") || undefined} checked={confirmed} onChange={(event) => { setPageErrors([]); setApiError(null); setApiErrorContext(null); setConfirmed(event.target.checked); }} />
                <span>I have reviewed this information and want to complete onboarding.</span>
              </label>
              <div className="disclaimer">
                <strong>This plan provides general wellness information and is not medical advice.</strong>{" "}
                Individual needs can vary. Consult a qualified healthcare professional or registered dietitian when appropriate.
              </div>
              <div className="onboarding-actions">
                <button className="button button-quiet" disabled={completionPhase !== null} type="button" onClick={() => goToStep(5)}><ArrowLeft size={17} /> Back</button>
                <div>
                  <button className="button button-quiet" disabled={pending || exitPending} type="button" onClick={() => finish(false)}>Go to Today</button>
                  <button className="button button-dark" disabled={pending || exitPending} type="button" onClick={() => finish(true)}>{completionPhase === "saving" ? "Saving profile…" : completionPhase === "generating" ? "Generating plan…" : "Generate my plan"} <ArrowRight size={17} /></button>
                </div>
              </div>
            </>
          ) : null}
          </div>
        </div>
      </main>

      <Dialog.Root open={warningOpen} onOpenChange={setWarningOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" aria-describedby="meal-warning-description">
            <Dialog.Title>Review meal balance?</Dialog.Title>
            <Dialog.Description id="meal-warning-description">
              These are gentle composition checks, not medical judgments.
            </Dialog.Description>
            <ul>{warningMeals.map((warning) => <li key={warning}>{warning}.</li>)}</ul>
            <div className="header-actions" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <Dialog.Close asChild><button className="button button-quiet" type="button">Review meals</button></Dialog.Close>
              <button className="button button-dark" type="button" onClick={() => {
                const warnings = mealWarnings();
                update("acknowledgedWarnings", warnings);
                setWarningOpen(false);
                goToStep(4);
                setAnnouncement("Meal composition warning acknowledged.");
              }}>Continue anyway</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
