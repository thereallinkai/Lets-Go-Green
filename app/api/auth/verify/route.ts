import { z } from "zod";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import {
  classifyAuthError,
  isAuthSessionMissing,
} from "@/src/lib/auth-error-taxonomy";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const verificationSchema = z
  .object({
    email: z.string().trim().email(),
    token: z.string().regex(/^\d{6}$/),
  })
  .strict();

const resumeSchema = z.object({ resume: z.literal(true) }).strict();
const schema = z.union([verificationSchema, resumeSchema]);

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

function verifiedProfileStatusUnavailable() {
  return apiError(
    "VERIFIED_PROFILE_STATUS_UNAVAILABLE",
    "Your email is verified, but profile setup could not be checked right now.",
    503,
    {
      details:
        "Your verified session is active. Check profile setup again without requesting or entering another code.",
      retryable: true,
      action: { kind: "retry", label: "Check profile setup again" },
    },
  );
}

function verifiedProfileRepairFailed() {
  return apiError(
    "VERIFIED_PROFILE_REPAIR_FAILED",
    "Your email is verified, but profile setup could not be repaired automatically.",
    503,
    {
      details:
        "Do not create another account. Contact the site administrator and provide this error code so the verified account can be repaired safely.",
      retryable: false,
      action: {
        kind: "contact_support",
        label: "Contact the site administrator",
      },
    },
  );
}

function verifiedSessionExpired() {
  return apiError(
    "VERIFIED_SESSION_EXPIRED",
    "The verified session is no longer available.",
    401,
    {
      details:
        "Log in with the account password. Do not create another account or reuse an old verification code.",
      retryable: false,
      action: { kind: "navigate", label: "Log in", href: "/login" },
    },
  );
}

function emailVerificationRequired() {
  return apiError(
    "EMAIL_VERIFICATION_REQUIRED",
    "Verify the account email before continuing.",
    403,
    {
      details:
        "Enter the newest six-digit verification code, or request a new code if it expired.",
      retryable: false,
      action: { kind: "edit", label: "Enter the verification code" },
    },
  );
}

function emailIsConfirmed(user: {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}) {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

async function readVerifiedProfile(
  supabase: SupabaseServerClient,
  userId: string,
) {
  try {
    const result = await supabase
      .from("profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error) return { status: "unavailable" as const };
    return result.data
      ? { status: "ready" as const }
      : { status: "missing" as const };
  } catch {
    return { status: "unavailable" as const };
  }
}

async function verifiedProfileResponse(
  supabase: SupabaseServerClient,
  userId: string,
) {
  const initialProfile = await readVerifiedProfile(supabase, userId);
  if (initialProfile.status === "unavailable") {
    return verifiedProfileStatusUnavailable();
  }
  if (initialProfile.status === "missing") {
    try {
      const { data, error } = await supabase.rpc("repair_verified_profile");
      const repairReady =
        data !== null &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        data.ready === true;
      if (error || !repairReady) return verifiedProfileRepairFailed();
    } catch {
      return verifiedProfileRepairFailed();
    }

    const repairedProfile = await readVerifiedProfile(supabase, userId);
    if (repairedProfile.status === "unavailable") {
      return verifiedProfileStatusUnavailable();
    }
    if (repairedProfile.status === "missing") {
      return verifiedProfileRepairFailed();
    }
  }
  return apiSuccess({
    verified: true,
    profileReady: true,
    redirectTo: "/onboarding?step=3",
  });
}

async function matchingVerifiedUserId(
  supabase: SupabaseServerClient,
  email: string,
) {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (
      !error &&
      data.user &&
      emailIsConfirmed(data.user) &&
      data.user.email?.trim().toLowerCase() === email.toLowerCase()
    ) {
      return data.user.id;
    }
  } catch {
    // A fresh OTP exchange can still succeed when the recovery probe is
    // unavailable, so do not replace that path with a probe error.
  }
  return null;
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("INVALID_CODE", "Enter a valid six-digit code.", 422, {
      details: "Use only the newest code sent to the registration email address.",
      retryable: false,
      action: { kind: "edit", label: "Enter the code" },
    });
  }
  if (isDevelopmentDemo()) {
    if ("resume" in parsed.data) {
      return apiSuccess({
        verified: true,
        profileReady: true,
        redirectTo: "/onboarding?step=3",
      });
    }
    return parsed.data.token === "123456"
      ? apiSuccess({
          verified: true,
          profileReady: true,
          redirectTo: "/onboarding?step=3",
        })
      : apiError(
          "INVALID_OR_EXPIRED_CODE",
          "That code is invalid or expired.",
          400,
        );
  }

  try {
    const supabase = await createSupabaseServerClient();
    if ("resume" in parsed.data) {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        if (isAuthSessionMissing(error)) return verifiedSessionExpired();
        return publicError(classifyAuthError(error, "verify_email"));
      }
      if (!data.user) {
        return verifiedSessionExpired();
      }
      if (!emailIsConfirmed(data.user)) {
        return emailVerificationRequired();
      }
      return verifiedProfileResponse(supabase, data.user.id);
    }

    const existingUserId = await matchingVerifiedUserId(
      supabase,
      parsed.data.email,
    );
    if (existingUserId) {
      return verifiedProfileResponse(supabase, existingUserId);
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email: parsed.data.email,
      token: parsed.data.token,
      type: "email",
    });
    if (error || !data.user) {
      // The first OTP exchange can establish the session while its response is
      // lost in transit. A retry then sees a consumed code, so recover only
      // when the authenticated session belongs to the submitted email.
      const recoveredUserId = await matchingVerifiedUserId(
        supabase,
        parsed.data.email,
      );
      if (recoveredUserId) {
        return verifiedProfileResponse(supabase, recoveredUserId);
      }
      return publicError(
        classifyAuthError(
          error ?? { code: "invalid_credentials" },
          "verify_email",
        ),
      );
    }

    return verifiedProfileResponse(supabase, data.user.id);
  } catch (error) {
    return publicError(classifyAuthError(error, "verify_email"));
  }
}
