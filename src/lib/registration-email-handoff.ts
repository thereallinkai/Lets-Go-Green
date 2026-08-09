export const REGISTRATION_EMAIL_HANDOFF_KEY =
  "lets-go-green-registration-email-handoff";

const HANDOFF_VERSION = 1;
const HANDOFF_TTL_MS = 15 * 60 * 1_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRegistrationEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return email.length <= 320 && EMAIL_PATTERN.test(email) ? email : null;
}

export function createRegistrationEmailHandoff(
  value: unknown,
  now = Date.now(),
) {
  const email = normalizeRegistrationEmail(value);
  if (!email) return null;
  return JSON.stringify({ version: HANDOFF_VERSION, email, createdAt: now });
}

export function readRegistrationEmailHandoff(
  raw: string | null,
  now = Date.now(),
) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const email = normalizeRegistrationEmail(parsed.email);
    const createdAt = parsed.createdAt;
    if (
      parsed.version !== HANDOFF_VERSION ||
      !email ||
      typeof createdAt !== "number" ||
      !Number.isFinite(createdAt) ||
      createdAt > now ||
      now - createdAt > HANDOFF_TTL_MS
    ) {
      return null;
    }
    return email;
  } catch {
    return null;
  }
}
