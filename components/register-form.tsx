"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { LoaderCircle } from "lucide-react";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromPayload,
  clientApiError,
} from "@/src/lib/client-api-error";
import {
  calculateAgeOnDate,
  MAXIMUM_REGISTRATION_AGE,
  MINIMUM_REGISTRATION_AGE,
  isValidIanaTimeZone,
  localDateInTimeZone,
  parseLocalDate,
  registrationDateOfBirthBounds,
  validateRegistrationDateOfBirth,
} from "@/src/lib/domain";
import { PasswordField } from "./password-field";
import { ApiErrorNotice } from "./api-error-notice";
import { useClientReady } from "@/src/lib/client-ready";
import {
  createRegistrationEmailHandoff,
  REGISTRATION_EMAIL_HANDOFF_KEY,
} from "@/src/lib/registration-email-handoff";

type RegistrationField =
  | "fullName"
  | "gender"
  | "dateOfBirth"
  | "email"
  | "password"
  | "passwordConfirmation"
  | "terms"
  | "privacy";

type RegistrationErrors = Partial<Record<RegistrationField, string>>;

const REGISTRATION_DRAFT_KEY = "lets-go-green-registration-draft";
const LEGACY_REGISTRATION_DRAFT_KEY = "cutting-plan-registration-draft";
const REGISTRATION_DRAFT_VERSION = 2;

type AgeConfirmation = {
  dateOfBirth: string;
  age: number;
  referenceDate: string;
  timeZone: string;
  requiresReconfirmation: boolean;
};

type SafeRegistrationDraft = {
  version: typeof REGISTRATION_DRAFT_VERSION;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  email: string;
};

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

function removeStorage(storage: Storage | null, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // Registration still works when browser storage is unavailable.
  }
}

function writeStorage(storage: Storage | null, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Registration still works when browser storage is unavailable.
  }
}

function safeDraftFromJson(raw: string | null): SafeRegistrationDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const draft = parsed as Record<string, unknown>;
    const text = (name: string, maximumLength: number) =>
      typeof draft[name] === "string"
        ? draft[name].slice(0, maximumLength)
        : "";
    const gender = text("gender", 32);
    return {
      version: REGISTRATION_DRAFT_VERSION,
      fullName: text("fullName", 120),
      gender: [
        "male",
        "female",
        "another_identity",
        "prefer_not_to_say",
      ].includes(gender)
        ? gender
        : "",
      dateOfBirth: text("dateOfBirth", 10),
      email: text("email", 320),
    };
  } catch {
    return null;
  }
}

function resolveDeviceTimeZone() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone && isValidIanaTimeZone(timeZone) ? timeZone : "UTC";
  } catch {
    return "UTC";
  }
}

function subscribeToDeviceTimeZone() {
  return () => {};
}

function serverTimeZone() {
  return "UTC";
}

function dateOfBirthError(dateOfBirth: string, referenceDate: string) {
  const validation = validateRegistrationDateOfBirth(
    dateOfBirth,
    referenceDate,
  );
  if (validation.valid) return null;

  let unboundedAge: number | null = null;
  try {
    unboundedAge = calculateAgeOnDate(dateOfBirth, referenceDate);
  } catch {
    // The shared validator remains the source of truth for malformed dates.
  }

  if (!dateOfBirth) return "Enter your date of birth.";
  if (dateOfBirth > referenceDate) {
    return "Date of birth cannot be in the future.";
  }
  if (unboundedAge !== null && unboundedAge < MINIMUM_REGISTRATION_AGE) {
    return "You must be at least 13 years old to create an account.";
  }
  if (unboundedAge !== null && unboundedAge > MAXIMUM_REGISTRATION_AGE) {
    return "Enter a date of birth that gives an age from 13 to 120.";
  }
  return "Enter a valid date of birth.";
}

function readableDate(dateOfBirth: string) {
  const { year, month, day } = parseLocalDate(dateOfBirth);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function apiErrorMatchesRegistrationField(
  error: ApiError,
  field: RegistrationField,
) {
  switch (error.code) {
    case "INVALID_EMAIL":
    case "EMAIL_ALREADY_REGISTERED":
      return field === "email";
    case "WEAK_PASSWORD":
    case "PASSWORD_COMPROMISED":
      return field === "password";
    case "INVALID_DATE_OF_BIRTH":
      return field === "dateOfBirth";
    case "REGISTRATION_CONSENT_REQUIRED":
      return field === "terms" || field === "privacy";
    default:
      return false;
  }
}

export function RegisterForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const createAccountButtonRef = useRef<HTMLButtonElement>(null);
  const cancelConfirmationRef = useRef<HTMLButtonElement>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RegistrationErrors>({});
  const [pending, setPending] = useState(false);
  const [ageConfirmation, setAgeConfirmation] =
    useState<AgeConfirmation | null>(null);
  const clientReady = useClientReady();
  const timeZone = useSyncExternalStore(
    subscribeToDeviceTimeZone,
    resolveDeviceTimeZone,
    serverTimeZone,
  );

  const referenceDate = localDateInTimeZone(new Date(), timeZone);
  const dateOfBirthBounds = registrationDateOfBirthBounds(referenceDate);

  useEffect(() => {
    const session = browserStorage("sessionStorage");
    const local = browserStorage("localStorage");
    const draft =
      safeDraftFromJson(readStorage(session, REGISTRATION_DRAFT_KEY)) ??
      safeDraftFromJson(readStorage(local, REGISTRATION_DRAFT_KEY)) ??
      safeDraftFromJson(readStorage(local, LEGACY_REGISTRATION_DRAFT_KEY));

    removeStorage(local, REGISTRATION_DRAFT_KEY);
    removeStorage(local, LEGACY_REGISTRATION_DRAFT_KEY);

    if (!draft) {
      removeStorage(session, REGISTRATION_DRAFT_KEY);
      return;
    }
    writeStorage(session, REGISTRATION_DRAFT_KEY, JSON.stringify(draft));

    const formElement = formRef.current;
    if (!formElement) return;
    for (const name of ["fullName", "gender", "dateOfBirth", "email"] as const) {
      const control = formElement.elements.namedItem(name);
      if (
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement
      ) {
        control.value = draft[name];
      }
    }
  }, []);

  function saveSafeDraft(formElement: HTMLFormElement) {
    const form = new FormData(formElement);
    writeStorage(
      browserStorage("sessionStorage"),
      REGISTRATION_DRAFT_KEY,
      JSON.stringify({
        version: REGISTRATION_DRAFT_VERSION,
        fullName: form.get("fullName") ?? "",
        gender: form.get("gender") ?? "",
        dateOfBirth: form.get("dateOfBirth") ?? "",
        email: form.get("email") ?? "",
      }),
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || ageConfirmation) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    const passwordConfirmation = String(
      form.get("passwordConfirmation") ?? "",
    );
    setApiError(null);
    const validationErrors: RegistrationErrors = {};
    const fullName = String(form.get("fullName") ?? "").trim();
    const gender = String(form.get("gender") ?? "");
    const dateOfBirthValue = String(form.get("dateOfBirth") ?? "");
    const confirmationTimeZone = resolveDeviceTimeZone();
    const confirmationReferenceDate = localDateInTimeZone(
      new Date(),
      confirmationTimeZone,
    );
    const dateOfBirthValidation = validateRegistrationDateOfBirth(
      dateOfBirthValue,
      confirmationReferenceDate,
    );
    const age = dateOfBirthValidation.valid
      ? dateOfBirthValidation.age
      : null;
    const email = String(form.get("email") ?? "").trim();

    if (fullName.length < 2) {
      validationErrors.fullName = "Enter your full name.";
    }
    if (
      !["male", "female", "another_identity", "prefer_not_to_say"].includes(
        gender,
      )
    ) {
      validationErrors.gender = "Choose a gender option.";
    }
    if (!dateOfBirthValidation.valid) {
      validationErrors.dateOfBirth = dateOfBirthError(
        dateOfBirthValue,
        confirmationReferenceDate,
      )!;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationErrors.email = "Enter a valid email address.";
    }
    if (password.length < 10) {
      validationErrors.password =
        "Use at least 10 characters for your password.";
    }
    if (!passwordConfirmation) {
      validationErrors.passwordConfirmation = "Confirm your password.";
    } else if (password !== passwordConfirmation) {
      validationErrors.passwordConfirmation = "The passwords do not match.";
    }
    if (form.get("terms") !== "on") {
      validationErrors.terms = "Accept the Terms of Use to continue.";
    }
    if (form.get("privacy") !== "on") {
      validationErrors.privacy = "Accept the Privacy Notice to continue.";
    }

    saveSafeDraft(formElement);

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      if (validationErrors.passwordConfirmation === "The passwords do not match.") {
        formElement
          .querySelector<HTMLInputElement>("#password-confirmation")
          ?.focus();
      } else {
        window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
      }
      return;
    }

    setFieldErrors({});
    setAgeConfirmation({
      dateOfBirth: dateOfBirthValue,
      age: age!,
      referenceDate: confirmationReferenceDate,
      timeZone: confirmationTimeZone,
      requiresReconfirmation: false,
    });
  }

  async function createAccount() {
    if (!ageConfirmation || pending) return;
    const currentTimeZone = resolveDeviceTimeZone();
    const currentReferenceDate = localDateInTimeZone(
      new Date(),
      currentTimeZone,
    );
    const currentDateOfBirth = validateRegistrationDateOfBirth(
      ageConfirmation.dateOfBirth,
      currentReferenceDate,
    );
    if (!currentDateOfBirth.valid) {
      setAgeConfirmation(null);
      setApiError(null);
      setFieldErrors({
        dateOfBirth:
          dateOfBirthError(
            ageConfirmation.dateOfBirth,
            currentReferenceDate,
          ) ?? "Enter a valid date of birth.",
      });
      window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    if (
      currentReferenceDate !== ageConfirmation.referenceDate ||
      currentTimeZone !== ageConfirmation.timeZone
    ) {
      setAgeConfirmation({
        dateOfBirth: ageConfirmation.dateOfBirth,
        age: currentDateOfBirth.age,
        referenceDate: currentReferenceDate,
        timeZone: currentTimeZone,
        requiresReconfirmation: true,
      });
      return;
    }

    const formElement = formRef.current;
    if (!formElement) return;
    const form = new FormData(formElement);

    setPending(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: String(form.get("fullName") ?? "").trim(),
          gender: form.get("gender"),
          dateOfBirth: ageConfirmation.dateOfBirth,
          timeZone: ageConfirmation.timeZone,
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
          termsAccepted: form.get("terms") === "on",
          privacyAccepted: form.get("privacy") === "on",
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        data?: { email?: string } | null;
        error?: unknown;
      } | null;
      if (!response.ok || result?.error || !result?.data) {
        setAgeConfirmation(null);
        const publicError = apiErrorFromPayload(
          result,
          clientApiError(
            "REGISTRATION_RESPONSE_INVALID",
            "The account could not be created.",
            "The account service returned an unreadable response. Your form information is unchanged; wait briefly and try again.",
            {
              retryable: true,
              action: { kind: "retry", label: "Try again" },
            },
          ),
        );
        setApiError(publicError);
        if (
          publicError.code === "INVALID_EMAIL" ||
          publicError.code === "EMAIL_ALREADY_REGISTERED"
        ) {
          setFieldErrors({ email: publicError.message });
        } else if (
          publicError.code === "WEAK_PASSWORD" ||
          publicError.code === "PASSWORD_COMPROMISED"
        ) {
          setFieldErrors({ password: publicError.message });
        } else if (publicError.code === "INVALID_DATE_OF_BIRTH") {
          setFieldErrors({ dateOfBirth: publicError.message });
        } else if (publicError.code === "REGISTRATION_CONSENT_REQUIRED") {
          setFieldErrors({
            terms: publicError.message,
            privacy: publicError.message,
          });
        }
        window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
        return;
      }
      removeStorage(
        browserStorage("sessionStorage"),
        REGISTRATION_DRAFT_KEY,
      );
      removeStorage(browserStorage("localStorage"), REGISTRATION_DRAFT_KEY);
      removeStorage(
        browserStorage("localStorage"),
        LEGACY_REGISTRATION_DRAFT_KEY,
      );
      const email = result.data.email ?? String(form.get("email") ?? "");
      const emailHandoff = createRegistrationEmailHandoff(email);
      if (emailHandoff) {
        writeStorage(
          browserStorage("sessionStorage"),
          REGISTRATION_EMAIL_HANDOFF_KEY,
          emailHandoff,
        );
      }
      router.push("/onboarding?step=2");
    } catch {
      setAgeConfirmation(null);
      setApiError(
        clientApiError(
          "REGISTRATION_NETWORK_ERROR",
          "The account service could not be reached.",
          "Check your connection and try again. Your form information is unchanged.",
          {
            retryable: true,
            action: { kind: "retry", label: "Try again" },
          },
        ),
      );
      window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action="/register"
      className="form-stack"
      method="post"
      ref={formRef}
      onChange={(event) => {
        saveSafeDraft(event.currentTarget);
        const changedControl = event.target as unknown;
        if (
          !(
            changedControl instanceof HTMLInputElement ||
            changedControl instanceof HTMLSelectElement
          )
        ) {
          return;
        }
        const field = changedControl.name as RegistrationField;
        setApiError((current) =>
          current && apiErrorMatchesRegistrationField(current, field)
            ? null
            : current,
        );
        setFieldErrors((current) => {
          if (!current[field]) return current;
          const next = { ...current };
          delete next[field];
          return next;
        });
      }}
      onSubmit={onSubmit}
      noValidate
    >
      {apiError ? (
        <ApiErrorNotice
          actionDisabled={pending}
          error={apiError}
          onAction={
            apiError.action?.kind === "retry" ||
            apiError.action?.kind === "edit"
              ? () => {
                  if (apiError.code === "CAPTCHA_FAILED") {
                    window.location.reload();
                    return;
                  }
                  if (
                    apiError.code === "INVALID_EMAIL" ||
                    apiError.code === "EMAIL_ALREADY_REGISTERED"
                  ) {
                    formRef.current
                      ?.querySelector<HTMLInputElement>("#register-email")
                      ?.focus();
                    return;
                  }
                  if (
                    apiError.code === "WEAK_PASSWORD" ||
                    apiError.code === "PASSWORD_COMPROMISED"
                  ) {
                    formRef.current
                      ?.querySelector<HTMLInputElement>("#register-password")
                      ?.focus();
                    return;
                  }
                  if (apiError.code === "INVALID_DATE_OF_BIRTH") {
                    formRef.current
                      ?.querySelector<HTMLInputElement>("#date-of-birth")
                      ?.focus();
                    return;
                  }
                  if (apiError.code === "REGISTRATION_CONSENT_REQUIRED") {
                    formRef.current
                      ?.querySelector<HTMLInputElement>('input[name="terms"]')
                      ?.focus();
                    return;
                  }
                  if (
                    apiError.action?.kind === "edit" ||
                    apiError.code === "INVALID_REGISTRATION"
                  ) {
                    formRef.current
                      ?.querySelector<HTMLInputElement>("#full-name")
                      ?.focus();
                    return;
                  }
                  formRef.current?.requestSubmit();
                }
              : undefined
          }
          ref={errorSummaryRef}
        />
      ) : Object.keys(fieldErrors).length > 0 ? (
        <div
          className="message-box error"
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
        >
          <div>
            <strong>Please review your account details.</strong>
            {Object.keys(fieldErrors).length > 0 ? (
              <ul style={{ margin: ".35rem 0 0", paddingLeft: "1.2rem" }}>
                {Object.entries(fieldErrors).map(([field, message]) => (
                  <li key={field}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="full-name">Full name</label>
        <input
          id="full-name"
          name="fullName"
          autoComplete="name"
          aria-describedby={
            fieldErrors.fullName ? "full-name-error" : undefined
          }
          aria-invalid={Boolean(fieldErrors.fullName) || undefined}
          required
        />
        {fieldErrors.fullName ? (
          <p className="field-error" id="full-name-error">
            {fieldErrors.fullName}
          </p>
        ) : null}
      </div>
      <div className="form-row registration-demographics">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="gender">Gender</label>
          <select
            id="gender"
            name="gender"
            required
            defaultValue=""
            aria-describedby={fieldErrors.gender ? "gender-error" : undefined}
            aria-invalid={Boolean(fieldErrors.gender) || undefined}
          >
            <option value="" disabled>Select an option</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="another_identity">Another identity</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
          {fieldErrors.gender ? (
            <p className="field-error" id="gender-error">
              {fieldErrors.gender}
            </p>
          ) : null}
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="date-of-birth">Date of birth</label>
          <input
            id="date-of-birth"
            name="dateOfBirth"
            type="date"
            min={dateOfBirthBounds.min}
            max={dateOfBirthBounds.max}
            autoComplete="bday"
            aria-describedby={`date-of-birth-help${fieldErrors.dateOfBirth ? " date-of-birth-error" : ""}`}
            aria-invalid={Boolean(fieldErrors.dateOfBirth) || undefined}
            required
          />
          <p className="field-help" id="date-of-birth-help">
            You will confirm this before account creation. It cannot be changed
            afterward.
          </p>
          {fieldErrors.dateOfBirth ? (
            <p className="field-error" id="date-of-birth-error">
              {fieldErrors.dateOfBirth}
            </p>
          ) : null}
        </div>
      </div>
      <div className="field">
        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          aria-describedby={
            fieldErrors.email ? "register-email-error" : undefined
          }
          aria-invalid={Boolean(fieldErrors.email) || undefined}
          required
        />
        {fieldErrors.email ? (
          <p className="field-error" id="register-email-error">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>
      <PasswordField
        id="register-password"
        autoComplete="new-password"
        describedBy={`password-help${fieldErrors.password ? " password-error" : ""}`}
        invalid={Boolean(fieldErrors.password)}
      />
      <p id="password-help" className="field-help">
        Use at least 10 characters with a mix of words or character types.
      </p>
      {fieldErrors.password ? (
        <p className="field-error" id="password-error">
          {fieldErrors.password}
        </p>
      ) : null}
      <PasswordField
        id="password-confirmation"
        label="Confirm password"
        name="passwordConfirmation"
        autoComplete="new-password"
        describedBy={
          fieldErrors.passwordConfirmation
            ? "password-confirmation-error"
            : undefined
        }
        invalid={Boolean(fieldErrors.passwordConfirmation)}
      />
      {fieldErrors.passwordConfirmation ? (
        <p className="field-error" id="password-confirmation-error">
          {fieldErrors.passwordConfirmation}
        </p>
      ) : null}
      <label className="checkbox-row">
        <input
          name="terms"
          type="checkbox"
          aria-describedby={fieldErrors.terms ? "terms-error" : undefined}
          aria-invalid={Boolean(fieldErrors.terms) || undefined}
          required
        />
        <span>
          I accept the <a href="/terms" target="_blank">Terms of Use</a>.
        </span>
      </label>
      {fieldErrors.terms ? (
        <p className="field-error" id="terms-error">
          {fieldErrors.terms}
        </p>
      ) : null}
      <label className="checkbox-row">
        <input
          name="privacy"
          type="checkbox"
          aria-describedby={fieldErrors.privacy ? "privacy-error" : undefined}
          aria-invalid={Boolean(fieldErrors.privacy) || undefined}
          required
        />
        <span>
          I accept the <a href="/privacy" target="_blank">Privacy Notice</a>.
        </span>
      </label>
      {fieldErrors.privacy ? (
        <p className="field-error" id="privacy-error">
          {fieldErrors.privacy}
        </p>
      ) : null}
      <button
        aria-haspopup="dialog"
        className="button button-dark form-submit"
        disabled={!clientReady || pending}
        ref={createAccountButtonRef}
        type="submit"
      >
        Create account
      </button>

      <Dialog.Root
        open={ageConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setAgeConfirmation(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              createAccountButtonRef.current?.focus();
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelConfirmationRef.current?.focus();
            }}
            onPointerDownOutside={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            <Dialog.Title>Confirm your age</Dialog.Title>
            <Dialog.Description>
              Make sure your date of birth is correct. It cannot be changed after
              your account is created.
            </Dialog.Description>
            {ageConfirmation ? (
              <div className="message-box" style={{ marginTop: "1rem" }}>
                <div>
                  <strong>{ageConfirmation.age} years old</strong>
                  <p style={{ margin: ".25rem 0 0" }}>
                    Born {readableDate(ageConfirmation.dateOfBirth)}
                  </p>
                  <p style={{ margin: ".25rem 0 0" }}>
                    Calculated in {ageConfirmation.timeZone}
                  </p>
                </div>
              </div>
            ) : null}
            {ageConfirmation?.requiresReconfirmation ? (
              <div className="message-box" role="status">
                Your local date or time zone changed. Review the updated age,
                then confirm again.
              </div>
            ) : null}
            <div
              className="header-actions"
              style={{ justifyContent: "flex-end", marginTop: "1rem" }}
            >
              <Dialog.Close asChild>
                <button
                  className="button button-quiet"
                  disabled={pending}
                  ref={cancelConfirmationRef}
                  type="button"
                >
                  Cancel and edit
                </button>
              </Dialog.Close>
              <button
                className="button button-dark"
                disabled={pending}
                onClick={() => void createAccount()}
                type="button"
              >
                {pending ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : null}
                {pending
                  ? "Creating account…"
                  : ageConfirmation?.requiresReconfirmation
                    ? "Confirm updated age"
                    : "Confirm and create account"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </form>
  );
}
