import type { PublicErrorDefinition } from "./api-response";

export type AuthOperation =
  | "register"
  | "login"
  | "request_recovery"
  | "resend_verification"
  | "verify_email"
  | "update_password";

type AuthErrorLike = {
  code?: unknown;
  status?: unknown;
  name?: unknown;
  reasons?: unknown;
};

const RATE_LIMIT_CODES = new Set([
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "over_sms_send_rate_limit",
]);

const CONFIGURATION_CODES = new Set([
  "signup_disabled",
  "email_provider_disabled",
  "provider_disabled",
  "otp_disabled",
  "hook_payload_invalid_content_type",
  "hook_payload_over_size_limit",
]);

const TIMEOUT_CODES = new Set([
  "request_timeout",
  "hook_timeout",
  "hook_timeout_after_retry",
]);

function value(error: unknown, key: keyof AuthErrorLike) {
  if (!error || typeof error !== "object") return undefined;
  return (error as AuthErrorLike)[key];
}

function errorCode(error: unknown) {
  const code = value(error, "code");
  return typeof code === "string" ? code.toLowerCase() : "";
}

function errorStatus(error: unknown) {
  const status = value(error, "status");
  return typeof status === "number" ? status : undefined;
}

function weakPasswordReasons(error: unknown) {
  const reasons = value(error, "reasons");
  return Array.isArray(reasons)
    ? reasons
        .filter((reason): reason is string => typeof reason === "string")
        .map((reason) => reason.toLowerCase())
    : [];
}

function retryableServiceError(
  code: string,
  message: string,
  details: string,
): PublicErrorDefinition {
  return {
    code,
    message,
    details,
    status: 503,
    retryable: true,
    action: { kind: "retry", label: "Try again" },
  };
}

function rateLimitError(operation: AuthOperation): PublicErrorDefinition {
  const verification = operation === "resend_verification" || operation === "verify_email";
  const recovery = operation === "request_recovery";
  const password = operation === "update_password";
  const login = operation === "login";
  return {
    code: verification
      ? "VERIFICATION_RATE_LIMITED"
      : recovery
        ? "RECOVERY_RATE_LIMITED"
        : password
          ? "PASSWORD_RATE_LIMITED"
          : login
            ? "LOGIN_RATE_LIMITED"
            : "REGISTRATION_RATE_LIMITED",
    message: "Too many requests were made. Wait a few minutes before trying again.",
    details: "Waiting prevents another request from extending the temporary limit.",
    status: 429,
    retryable: true,
    action: { kind: "wait", label: "Wait, then try again" },
  };
}

function captchaError(): PublicErrorDefinition {
  return {
    code: "CAPTCHA_FAILED",
    message: "The anti-abuse check was not accepted.",
    details: "Reload the page, complete the check again, and resubmit once.",
    status: 400,
    retryable: true,
    action: { kind: "retry", label: "Reload and try again" },
  };
}

function configurationError(operation: AuthOperation): PublicErrorDefinition {
  return {
    code: "AUTH_CONFIGURATION_ERROR",
    message: "This account operation is not available right now.",
    details:
      operation === "register"
        ? "Account creation or email delivery is disabled in the current environment."
        : "The authentication provider is not configured for this operation.",
    status: 503,
    retryable: false,
    action: {
      kind: "contact_support",
      label: "Contact the site administrator",
    },
  };
}

function invalidCredentials(): PublicErrorDefinition {
  return {
    code: "INVALID_CREDENTIALS",
    message: "The email or password was not accepted.",
    details: "Check both fields, or use password recovery if you cannot sign in.",
    status: 401,
    retryable: false,
    action: {
      kind: "navigate",
      label: "Reset password",
      href: "/forgot-password",
    },
  };
}

export function classifyAuthError(
  error: unknown,
  operation: AuthOperation,
): PublicErrorDefinition {
  const code = errorCode(error);
  const status = errorStatus(error);
  const name = value(error, "name");

  if (RATE_LIMIT_CODES.has(code) || status === 429) {
    return rateLimitError(operation);
  }
  if (code === "captcha_failed") return captchaError();
  if (CONFIGURATION_CODES.has(code)) return configurationError(operation);
  if (
    TIMEOUT_CODES.has(code) ||
    name === "AuthRetryableFetchError" ||
    error instanceof TypeError
  ) {
    return retryableServiceError(
      "AUTH_NETWORK_ERROR",
      "The account service could not be reached.",
      "Check your connection and try the request again. Your form information is unchanged.",
    );
  }
  if (status !== undefined && status >= 500) {
    return retryableServiceError(
      "AUTH_SERVICE_UNAVAILABLE",
      "Account services are temporarily unavailable.",
      "Your information is unchanged. Try again after a short wait.",
    );
  }
  if (error instanceof Error && !code && status === undefined) {
    return retryableServiceError(
      "AUTH_SERVICE_UNAVAILABLE",
      "Account services are temporarily unavailable.",
      "Your information is unchanged. Check the connection and try again after a short wait.",
    );
  }

  if (operation === "login") {
    // Deliberately collapse user-not-found, unconfirmed, banned, invalid-email,
    // and invalid-password states so login cannot be used to enumerate accounts.
    return invalidCredentials();
  }

  if (operation === "register") {
    if (
      code === "email_exists" ||
      code === "user_already_exists" ||
      code === "identity_already_exists" ||
      code === "conflict" ||
      status === 409
    ) {
      return {
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account already uses this email address.",
        details: "Log in instead, or reset the password if you no longer remember it.",
        status: 409,
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      };
    }
    if (
      code === "email_address_invalid" ||
      code === "email_address_not_authorized" ||
      code === "validation_failed"
    ) {
      return {
        code: "INVALID_EMAIL",
        message: "That email address cannot be used for registration.",
        details: "Check the address for typing mistakes and use an address that can receive email.",
        status: 422,
        retryable: false,
        action: { kind: "edit", label: "Edit email" },
      };
    }
    if (code === "weak_password") {
      const compromised = weakPasswordReasons(error).includes("pwned");
      return {
        code: compromised ? "PASSWORD_COMPROMISED" : "WEAK_PASSWORD",
        message: compromised
          ? "Choose a password that has not appeared in known data breaches."
          : "Choose a stronger password.",
        details: compromised
          ? "Use a unique password that you do not use for another account."
          : "Use at least 10 characters and a less predictable mix of words or character types.",
        status: 422,
        retryable: false,
        action: { kind: "edit", label: "Choose another password" },
      };
    }
    return {
      code: "REGISTRATION_FAILED",
      message: "The account could not be created.",
      details: "Review the form and try once more. If it continues, wait before retrying.",
      status: 400,
      retryable: true,
      action: { kind: "retry", label: "Review and try again" },
    };
  }

  if (operation === "verify_email") {
    if (
      code === "otp_expired" ||
      code === "invalid_credentials" ||
      code === "email_address_invalid" ||
      code === "user_not_found" ||
      code === "flow_state_expired" ||
      code === "flow_state_not_found"
    ) {
      return {
        code: "INVALID_OR_EXPIRED_CODE",
        message: "That verification code is invalid or expired.",
        details: "Request a new code, then enter only the newest six-digit code.",
        status: 400,
        retryable: false,
        action: { kind: "retry", label: "Request a new code" },
      };
    }
    return retryableServiceError(
      "VERIFICATION_UNAVAILABLE",
      "Email verification could not be completed.",
      "Request a new code and try again. Your registration information is unchanged.",
    );
  }

  if (operation === "resend_verification") {
    return retryableServiceError(
      "VERIFICATION_EMAIL_UNAVAILABLE",
      "A verification email could not be sent right now.",
      "Check the address, wait briefly, and request one new code.",
    );
  }

  if (operation === "request_recovery") {
    return retryableServiceError(
      "RECOVERY_EMAIL_UNAVAILABLE",
      "Password recovery email could not be sent right now.",
      "Wait briefly, check the connection, and submit one new recovery request.",
    );
  }

  if (code === "weak_password") {
    const compromised = weakPasswordReasons(error).includes("pwned");
    return {
      code: compromised ? "PASSWORD_COMPROMISED" : "WEAK_PASSWORD",
      message: compromised
        ? "Choose a password that has not appeared in known data breaches."
        : "Choose a stronger password.",
      details: "Use a unique password with at least 10 characters.",
      status: 422,
      retryable: false,
      action: { kind: "edit", label: "Choose another password" },
    };
  }
  if (code === "same_password") {
    return {
      code: "PASSWORD_UNCHANGED",
      message: "Choose a password different from the current password.",
      details: "A reused password was not saved.",
      status: 409,
      retryable: false,
      action: { kind: "edit", label: "Choose another password" },
    };
  }
  if (
    code === "session_not_found" ||
    code === "session_expired" ||
    code === "refresh_token_not_found" ||
    code === "refresh_token_already_used" ||
    code === "bad_jwt" ||
    code === "reauthentication_needed" ||
    code === "reauthentication_not_valid"
  ) {
    return {
      code: "SESSION_EXPIRED",
      message: "Open a fresh password-reset link and try again.",
      details: "For security, an expired reset session cannot be reused.",
      status: 401,
      retryable: false,
      action: {
        kind: "navigate",
        label: "Request another reset link",
        href: "/forgot-password",
      },
    };
  }
  return {
    code: "PASSWORD_UPDATE_FAILED",
    message: "The password could not be updated.",
    details: "Open a fresh reset link and choose a different password before trying again.",
    status: 400,
    retryable: true,
    action: { kind: "retry", label: "Try again" },
  };
}

export function duplicateSignupResult(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const user = (data as { user?: unknown }).user;
  if (!user || typeof user !== "object") return false;
  const identities = (user as { identities?: unknown }).identities;
  return Array.isArray(identities) && identities.length === 0;
}
