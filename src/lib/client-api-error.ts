import type { ApiError, ApiErrorAction } from "./api-response";

const ACTION_KINDS = new Set<ApiErrorAction["kind"]>([
  "retry",
  "wait",
  "navigate",
  "edit",
  "restart",
  "contact_support",
]);

function safeText(value: unknown, maximumLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximumLength)
    : undefined;
}

function safeAction(value: unknown): ApiErrorAction | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const kind = safeText(candidate.kind, 32) as ApiErrorAction["kind"] | undefined;
  const label = safeText(candidate.label, 120);
  if (!kind || !ACTION_KINDS.has(kind) || !label) return undefined;

  const rawHref = safeText(candidate.href, 500);
  const href =
    rawHref && rawHref.startsWith("/") && !rawHref.startsWith("//")
      ? rawHref
      : undefined;
  return href ? { kind, label, href } : { kind, label };
}

/**
 * Reads only the app's documented public error envelope. Unknown or malformed
 * responses become the caller-provided safe fallback instead of exposing raw
 * response bodies or provider diagnostics.
 */
export function apiErrorFromPayload(
  payload: unknown,
  fallback: ApiError,
): ApiError {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return fallback;
  }
  const candidate = error as Record<string, unknown>;
  const code = safeText(candidate.code, 100);
  const message = safeText(candidate.message, 500);
  if (!code || !message || !/^[A-Z0-9_]+$/.test(code)) return fallback;

  const details = safeText(candidate.details, 1_000);
  const action = safeAction(candidate.action);
  const retryable =
    typeof candidate.retryable === "boolean"
      ? candidate.retryable
      : undefined;

  return {
    code,
    message,
    ...(details ? { details } : {}),
    ...(action ? { action } : {}),
    ...(retryable === undefined ? {} : { retryable }),
  };
}

export function clientApiError(
  code: string,
  message: string,
  details: string,
  options: Pick<ApiError, "action" | "retryable"> = {},
): ApiError {
  return { code, message, details, ...options };
}
