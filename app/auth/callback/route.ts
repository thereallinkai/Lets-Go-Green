import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import {
  safeAuthCallbackNext,
  type AuthCallbackErrorCode,
} from "@/src/lib/auth-callback";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const allowedOtpTypes = new Set<EmailOtpType>([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

type CallbackProviderError = {
  code?: string;
  message: string;
  name?: string;
  status?: number;
};

function isServiceFailure(error: CallbackProviderError) {
  const code = (error.code ?? "").toLowerCase();
  const name = (error.name ?? "").toLowerCase();
  return (
    (error.status ?? 0) >= 500 ||
    name === "authretryablefetcherror" ||
    name === "aborterror" ||
    code === "unexpected_failure" ||
    code === "network_error" ||
    code === "fetch_error" ||
    code === "request_timeout" ||
    code === "service_unavailable"
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const requestedType = requestUrl.searchParams.get("type");
  const recoveryPurpose =
    requestedType === "recovery" ||
    requestUrl.searchParams.get("purpose") === "recovery";
  const fallback = recoveryPurpose ? "/reset-password" : "/today";
  const next = safeAuthCallbackNext(requestUrl.searchParams.get("next"), fallback);
  let callbackError: AuthCallbackErrorCode = "AUTH_CALLBACK_INCOMPLETE";
  const hasSupportedToken = Boolean(
    tokenHash &&
      requestedType &&
      allowedOtpTypes.has(requestedType as EmailOtpType),
  );

  if (!code && !hasSupportedToken) {
    const destination = new URL("/login", requestUrl.origin);
    destination.searchParams.set("authError", callbackError);
    return NextResponse.redirect(destination);
  }

  try {
    const supabase = await createSupabaseServerClient();
    let error: CallbackProviderError | null = null;

    if (code) {
      ({ error } = await supabase.auth.exchangeCodeForSession(code));
    } else if (tokenHash && requestedType) {
      ({ error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: requestedType as EmailOtpType,
      }));
    }

    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }
    callbackError = isServiceFailure(error)
      ? "AUTH_CALLBACK_SERVICE_UNAVAILABLE"
      : recoveryPurpose
        ? "RECOVERY_LINK_INVALID_OR_EXPIRED"
        : "AUTH_LINK_INVALID_OR_EXPIRED";
  } catch {
    callbackError = "AUTH_CALLBACK_SERVICE_UNAVAILABLE";
  }

  const destination = new URL("/login", requestUrl.origin);
  destination.searchParams.set("authError", callbackError);
  return NextResponse.redirect(destination);
}
