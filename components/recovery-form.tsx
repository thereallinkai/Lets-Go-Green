"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromPayload,
  clientApiError,
} from "@/src/lib/client-api-error";
import { ApiErrorNotice } from "./api-error-notice";
import { PasswordField } from "./password-field";
import { useClientReady } from "@/src/lib/client-ready";

function errorMatchesRecoveryField(error: ApiError, field: string) {
  return error.code === "INVALID_EMAIL" && field === "email";
}

function errorMatchesResetField(error: ApiError, field: string) {
  if (error.code === "PASSWORDS_DO_NOT_MATCH") {
    return field === "password" || field === "confirmation";
  }
  if (
    error.code === "WEAK_PASSWORD" ||
    error.code === "PASSWORD_COMPROMISED" ||
    error.code === "PASSWORD_UNCHANGED"
  ) {
    return field === "password";
  }
  return false;
}

export function ForgotPasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const clientReady = useClientReady();

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const result = (await response.json().catch(() => null)) as {
        data?: { sent?: boolean } | null;
        error?: unknown;
      } | null;
      if (!response.ok || result?.error || !result?.data) {
        setError(
          apiErrorFromPayload(
            result,
            clientApiError(
              "RECOVERY_RESPONSE_INVALID",
              "Password recovery could not be requested.",
              "The account service returned an unreadable response. This does not indicate whether the email has an account.",
              {
                retryable: true,
                action: { kind: "retry", label: "Try again" },
              },
            ),
          ),
        );
        return;
      }
      setSent(true);
    } catch {
      setError(
        clientApiError(
          "RECOVERY_NETWORK_ERROR",
          "The account service could not be reached.",
          "Check your connection and try again. This does not indicate whether the email has an account.",
          {
            retryable: true,
            action: { kind: "retry", label: "Try again" },
          },
        ),
      );
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="message-box" role="status">
        <CheckCircle2 size={19} aria-hidden="true" />
        <span>
          If an account matches that address, password-reset instructions are on
          the way. In local development, open the captured-email service.
        </span>
      </div>
    );
  }

  return (
    <form
      action="/forgot-password"
      className="form-stack"
      method="post"
      onChange={(event) => {
        const changedControl = event.target as unknown;
        if (!(changedControl instanceof HTMLInputElement)) return;
        const field = changedControl.name;
        setError((current) =>
          current && errorMatchesRecoveryField(current, field)
            ? null
            : current,
        );
      }}
      onSubmit={onSubmit}
      ref={formRef}
    >
      {error ? (
        <ApiErrorNotice
          actionDisabled={pending}
          error={error}
          onAction={
            error.action?.kind === "retry"
              ? () => {
                  if (error.code === "CAPTCHA_FAILED") {
                    window.location.reload();
                    return;
                  }
                  formRef.current?.requestSubmit();
                }
              : undefined
          }
          ref={errorRef}
        />
      ) : null}
      <div className="field">
        <label htmlFor="recovery-email">Email</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" required />
      </div>
      <button className="button button-dark form-submit" disabled={!clientReady || pending} type="submit">
        {pending ? <LoaderCircle size={18} aria-hidden="true" /> : null}
        {pending ? "Sending…" : "Send reset instructions"}
      </button>
    </form>
  );
}

export function ResetPasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const clientReady = useClientReady();

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    setSuccessMessage("");
    setError(null);
    if (password !== String(form.get("confirmation") ?? "")) {
      setError(
        clientApiError(
          "PASSWORDS_DO_NOT_MATCH",
          "The passwords do not match.",
          "Retype both password fields so they contain exactly the same value.",
          {
            retryable: false,
            action: { kind: "edit", label: "Edit confirmation" },
          },
        ),
      );
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json().catch(() => null)) as {
        data?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || result?.error || !result?.data) {
        setError(
          apiErrorFromPayload(
            result,
            clientApiError(
              "PASSWORD_RESPONSE_INVALID",
              "The password could not be updated.",
              "The account service returned an unreadable response. Open a fresh reset link before trying again.",
              {
                retryable: true,
                action: { kind: "retry", label: "Try again" },
              },
            ),
          ),
        );
        return;
      }
      setSuccessMessage("Your password has been updated. You can now log in.");
    } catch {
      setError(
        clientApiError(
          "PASSWORD_NETWORK_ERROR",
          "The account service could not be reached.",
          "Check your connection, then try again from a valid reset session.",
          {
            retryable: true,
            action: { kind: "retry", label: "Try again" },
          },
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action="/reset-password"
      className="form-stack"
      method="post"
      onChange={(event) => {
        const changedControl = event.target as unknown;
        if (!(changedControl instanceof HTMLInputElement)) return;
        const field = changedControl.name;
        setError((current) =>
          current && errorMatchesResetField(current, field) ? null : current,
        );
      }}
      onSubmit={onSubmit}
      ref={formRef}
    >
      {error ? (
        <ApiErrorNotice
          actionDisabled={pending}
          error={error}
          onAction={
            error.action?.kind === "retry" || error.action?.kind === "edit"
              ? () => {
                  if (error.code === "CAPTCHA_FAILED") {
                    window.location.reload();
                    return;
                  }
                  if (
                    error.action?.kind === "edit" ||
                    error.code === "WEAK_PASSWORD" ||
                    error.code === "PASSWORD_COMPROMISED" ||
                    error.code === "PASSWORD_UNCHANGED"
                  ) {
                    const target =
                      error.code === "PASSWORDS_DO_NOT_MATCH"
                        ? "#reset-confirmation"
                        : "#reset-password";
                    formRef.current
                      ?.querySelector<HTMLInputElement>(target)
                      ?.focus();
                    return;
                  }
                  formRef.current?.requestSubmit();
                }
              : undefined
          }
          ref={errorRef}
        />
      ) : null}
      {successMessage ? (
        <div className="message-box" role="status">{successMessage}</div>
      ) : null}
      <PasswordField id="reset-password" name="password" autoComplete="new-password" />
      <PasswordField
        id="reset-confirmation"
        name="confirmation"
        label="Confirm new password"
        autoComplete="new-password"
      />
      <button className="button button-dark form-submit" disabled={!clientReady || pending} type="submit">
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
