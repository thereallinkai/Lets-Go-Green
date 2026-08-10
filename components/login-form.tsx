"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromPayload,
  clientApiError,
} from "@/src/lib/client-api-error";
import { ApiErrorNotice } from "./api-error-notice";
import { PasswordField } from "./password-field";
import { useClientReady } from "@/src/lib/client-ready";

function errorMatchesLoginField(error: ApiError, field: string) {
  return (
    error.code === "INVALID_CREDENTIALS" &&
    (field === "email" || field === "password")
  );
}

export function LoginForm({ initialError = null }: { initialError?: ApiError | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<ApiError | null>(initialError);
  const [pending, setPending] = useState(false);
  const clientReady = useClientReady();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        data?: { redirectTo?: string } | null;
        error?: unknown;
      } | null;
      if (!response.ok || result?.error || !result?.data) {
        setError(
          apiErrorFromPayload(
            result,
            clientApiError(
              "LOGIN_RESPONSE_INVALID",
              "Sign-in could not be completed.",
              "The account service returned an unreadable response. No account information was changed.",
              {
                retryable: true,
                action: { kind: "retry", label: "Try again" },
              },
            ),
          ),
        );
        window.requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      router.replace(result.data.redirectTo ?? "/today");
      router.refresh();
    } catch {
      setError(
        clientApiError(
          "LOGIN_NETWORK_ERROR",
          "The account service could not be reached.",
          "Check your connection and try again. The response does not indicate whether an account exists.",
          {
            retryable: true,
            action: { kind: "retry", label: "Try again" },
          },
        ),
      );
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action="/login"
      className="form-stack"
      method="post"
      onChange={(event) => {
        const changedControl = event.target as unknown;
        if (!(changedControl instanceof HTMLInputElement)) return;
        const field = changedControl.name;
        setError((current) =>
          current && errorMatchesLoginField(current, field) ? null : current,
        );
      }}
      onSubmit={onSubmit}
      ref={formRef}
      noValidate
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
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <PasswordField />
      <div className="form-row">
        <Link href="/onboarding?step=2">Continue email verification</Link>
        <Link href="/forgot-password">Forgot password?</Link>
      </div>
      <button className="button button-dark form-submit" disabled={!clientReady || pending} type="submit">
        {pending ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : null}
        {pending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
