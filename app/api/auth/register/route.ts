import { z } from "zod";
import { apiError, apiSuccess, publicError } from "@/src/lib/api-response";
import {
  classifyAuthError,
  duplicateSignupResult,
} from "@/src/lib/auth-error-taxonomy";
import {
  isValidIanaTimeZone,
  localDateInTimeZone,
  validateRegistrationDateOfBirth,
} from "@/src/lib/domain";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const registrationSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    gender: z.enum(["male", "female", "another_identity", "prefer_not_to_say"]),
    dateOfBirth: z.string().max(10),
    timeZone: z.string().trim().min(1).max(100).refine(isValidIanaTimeZone),
    email: z.string().trim().email().max(320),
    password: z.string().min(10).max(128),
    termsAccepted: z.literal(true),
    privacyAccepted: z.literal(true),
    captchaToken: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const invalidField = (field: string) =>
      parsed.error.issues.some((issue) => issue.path[0] === field);
    if (invalidField("email")) {
      return publicError(
        classifyAuthError({ code: "email_address_invalid" }, "register"),
      );
    }
    if (invalidField("password")) {
      return publicError(
        classifyAuthError({ code: "weak_password" }, "register"),
      );
    }
    if (invalidField("termsAccepted") || invalidField("privacyAccepted")) {
      return apiError(
        "REGISTRATION_CONSENT_REQUIRED",
        "Accept the current Terms and Privacy Notice before creating an account.",
        422,
        {
          details: "Review both documents, then select both consent checkboxes.",
          retryable: false,
          action: { kind: "edit", label: "Review consent" },
        },
      );
    }
    return apiError(
      "INVALID_REGISTRATION",
      "Review the highlighted account details and try again.",
      422,
      {
        details: "Correct every marked field before creating the account.",
        retryable: false,
        action: { kind: "edit", label: "Review account details" },
      },
    );
  }
  const dateOfBirth = validateRegistrationDateOfBirth(
    parsed.data.dateOfBirth,
    localDateInTimeZone(new Date(), parsed.data.timeZone),
  );
  if (!dateOfBirth.valid) {
    return apiError(
      "INVALID_DATE_OF_BIRTH",
      "Enter a valid date of birth for an age from 13 to 120.",
      422,
      {
        details: "The age is calculated using the supplied local time zone.",
        retryable: false,
        action: { kind: "edit", label: "Edit date of birth" },
      },
    );
  }
  if (isDevelopmentDemo()) {
    return apiSuccess({ email: parsed.data.email, verificationRequired: true }, 201);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        ...(parsed.data.captchaToken
          ? { captchaToken: parsed.data.captchaToken }
          : {}),
        data: {
          full_name: parsed.data.fullName,
          gender: parsed.data.gender,
          date_of_birth: dateOfBirth.dateOfBirth,
          registration_time_zone: parsed.data.timeZone,
          terms_version: "1.2",
          privacy_version: "1.3",
        },
      },
    });
    if (error) {
      return publicError(classifyAuthError(error, "register"));
    }
    if (duplicateSignupResult(data)) {
      return publicError(
        classifyAuthError(
          { code: "user_already_exists", status: 409 },
          "register",
        ),
      );
    }
    if (!data.user) {
      return publicError(
        classifyAuthError(
          { code: "unexpected_failure", status: 503 },
          "register",
        ),
      );
    }
    return apiSuccess({ email: parsed.data.email, verificationRequired: true }, 201);
  } catch (error) {
    return publicError(classifyAuthError(error, "register"));
  }
}
