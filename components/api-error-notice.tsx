"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { forwardRef } from "react";
import type { ApiError } from "@/src/lib/api-response";
import styles from "./api-error-notice.module.css";

export const ApiErrorNotice = forwardRef<
  HTMLDivElement,
  {
    error: ApiError;
    heading?: string;
    onAction?: () => void;
    actionDisabled?: boolean;
    className?: string;
  }
>(function ApiErrorNotice(
  { error, heading, onAction, actionDisabled = false, className = "" },
  ref,
) {
  const action = error.action;
  const retryLabel =
    error.action?.kind === "wait"
      ? "Retry available: after the waiting period"
      : error.retryable === true
      ? "Retry available: yes"
      : error.retryable === false
        ? "Retry available: not until the issue is resolved"
        : "Retry guidance: follow the next step below";
  const classes = ["message-box", "error", styles.notice, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} ref={ref} role="alert" tabIndex={-1}>
      <AlertCircle aria-hidden="true" size={19} />
      <div className={styles.content}>
        {heading ? <strong>{heading}</strong> : null}
        <p className={styles.message}>{error.message}</p>
        {error.details ? <p className={styles.details}>{error.details}</p> : null}
        <div className={styles.metadata}>
          <code className={styles.code}>Error code: {error.code}</code>
          <p className={styles.retryStatus}>{retryLabel}</p>
        </div>
        {action?.href ? (
          <div className={styles.actionRow}>
            <Link className="button button-quiet" href={action.href}>
              {action.label}
            </Link>
          </div>
        ) : action && onAction ? (
          <div className={styles.actionRow}>
            <button
              className="button button-quiet"
              disabled={actionDisabled}
              onClick={onAction}
              type="button"
            >
              {action.label}
            </button>
          </div>
        ) : action ? (
          <p className={styles.nextStep}>Next step: {action.label}.</p>
        ) : null}
      </div>
    </div>
  );
});
