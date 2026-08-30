export const REGISTRATION_DRAFT_KEY = "lets-go-green-registration-draft";
export const LEGACY_REGISTRATION_DRAFT_KEY =
  "cutting-plan-registration-draft";

export function getBrowserStorage(
  kind: "localStorage" | "sessionStorage",
): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

export function readStorageValue(storage: Storage | null, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorageValue(
  storage: Storage | null,
  key: string,
  value: string,
) {
  try {
    storage?.setItem(key, value);
    return storage !== null;
  } catch {
    return false;
  }
}

export function removeStorageValue(storage: Storage | null, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // Browser storage is optional; server state remains authoritative.
  }
}
