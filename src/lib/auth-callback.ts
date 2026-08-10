import type { ApiError } from "./api-response";

export type AuthCallbackErrorCode =
  | "AUTH_CALLBACK_INCOMPLETE"
  | "AUTH_LINK_INVALID_OR_EXPIRED"
  | "RECOVERY_LINK_INVALID_OR_EXPIRED"
  | "AUTH_CALLBACK_SERVICE_UNAVAILABLE";

const callbackErrors: Record<AuthCallbackErrorCode, ApiError> = {
  AUTH_CALLBACK_INCOMPLETE: {
    code: "AUTH_CALLBACK_INCOMPLETE",
    message: "This authentication link is incomplete.",
    details:
      "The link is missing information required to verify it. Open the newest complete link from your email or request another one.",
    retryable: false,
    action: {
      kind: "navigate",
      label: "Return to email verification",
      href: "/onboarding?step=2",
    },
  },
  AUTH_LINK_INVALID_OR_EXPIRED: {
    code: "AUTH_LINK_INVALID_OR_EXPIRED",
    message: "This authentication link is invalid or has expired.",
    details:
      "Authentication links can be used only as issued and may expire. Request a new code, then use only the newest email.",
    retryable: false,
    action: {
      kind: "navigate",
      label: "Request a new verification code",
      href: "/onboarding?step=2",
    },
  },
  RECOVERY_LINK_INVALID_OR_EXPIRED: {
    code: "RECOVERY_LINK_INVALID_OR_EXPIRED",
    message: "This password-reset link is invalid or has expired.",
    details:
      "Request another password-reset email and open only the newest link.",
    retryable: false,
    action: {
      kind: "navigate",
      label: "Request another reset link",
      href: "/forgot-password",
    },
  },
  AUTH_CALLBACK_SERVICE_UNAVAILABLE: {
    code: "AUTH_CALLBACK_SERVICE_UNAVAILABLE",
    message: "The authentication link could not be checked right now.",
    details:
      "The account service was unavailable, so the link was not confirmed. Wait briefly, then open the newest email link again.",
    retryable: true,
    action: { kind: "restart", label: "Open the newest email link again" },
  },
};

export function authCallbackErrorForLogin(value: unknown): ApiError | null {
  if (typeof value !== "string" || !(value in callbackErrors)) return null;
  return callbackErrors[value as AuthCallbackErrorCode];
}

function hasUnsafeRedirectCharacters(value: string) {
  return (
    value.includes("\\") ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
    })
  );
}

/** Keep callback redirects on this application even after URL normalization. */
export function safeAuthCallbackNext(value: string | null, fallback: string) {
  if (!value) return fallback;

  let decoded = value;
  let fullyDecoded = false;
  for (let index = 0; index < 5; index += 1) {
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      hasUnsafeRedirectCharacters(decoded)
    ) {
      return fallback;
    }
    try {
      const nextDecoded = decodeURIComponent(decoded);
      if (nextDecoded === decoded) {
        fullyDecoded = true;
        break;
      }
      decoded = nextDecoded;
    } catch {
      return fallback;
    }
  }
  if (!fullyDecoded) return fallback;
  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    hasUnsafeRedirectCharacters(decoded)
  ) {
    return fallback;
  }

  try {
    const sentinelOrigin = "https://callback.invalid";
    const normalized = new URL(value, sentinelOrigin);
    return normalized.origin === sentinelOrigin ? value : fallback;
  } catch {
    return fallback;
  }
}
