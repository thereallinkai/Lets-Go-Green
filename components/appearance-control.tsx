"use client";

import { useId, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_STORAGE_KEY,
  getThemeColor,
  isAppearancePreference,
  resolveAppearance,
  type AppearancePreference,
} from "@/src/lib/appearance";

type AppearanceControlProps = {
  variant?: "compact" | "full";
};

const options: Array<{
  value: AppearancePreference;
  label: string;
  detail: string;
  Icon: LucideIcon;
}> = [
  {
    value: "system",
    label: "System",
    detail: "Follow this device",
    Icon: Monitor,
  },
  { value: "light", label: "Light", detail: "Always light", Icon: Sun },
  { value: "dark", label: "Dark", detail: "Always dark", Icon: Moon },
];

function readStoredPreference(): AppearancePreference {
  try {
    const saved = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearancePreference(saved) && saved !== "system" ? saved : "system";
  } catch {
    return "system";
  }
}

function readPreferenceSnapshot(): AppearancePreference {
  const rootValue = document.documentElement.dataset.appearance;
  return isAppearancePreference(rootValue) ? rootValue : readStoredPreference();
}

function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyAppearance(preference: AppearancePreference) {
  const theme = resolveAppearance(preference, systemPrefersDark());
  const root = document.documentElement;

  root.dataset.appearance = preference;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  const metas = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  );
  const targets = metas.length > 0 ? metas : [document.createElement("meta")];

  if (metas.length === 0) {
    targets[0].name = "theme-color";
    document.head.appendChild(targets[0]);
  }

  for (const meta of targets) {
    meta.content = getThemeColor(theme);
    meta.removeAttribute("media");
  }
}

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const handleAppearanceChange = () => onStoreChange();
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== APPEARANCE_STORAGE_KEY) return;
    applyAppearance(readStoredPreference());
    onStoreChange();
  };
  const handleSystemChange = () => {
    if (readPreferenceSnapshot() !== "system") return;
    applyAppearance("system");
    onStoreChange();
  };

  window.addEventListener(APPEARANCE_CHANGE_EVENT, handleAppearanceChange);
  window.addEventListener("storage", handleStorage);
  media.addEventListener("change", handleSystemChange);

  if (!isAppearancePreference(document.documentElement.dataset.appearance)) {
    applyAppearance(readStoredPreference());
  }

  return () => {
    window.removeEventListener(APPEARANCE_CHANGE_EVENT, handleAppearanceChange);
    window.removeEventListener("storage", handleStorage);
    media.removeEventListener("change", handleSystemChange);
  };
}

function savePreference(preference: AppearancePreference) {
  try {
    if (preference === "system") {
      window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
    }
  } catch {
    // Appearance still applies for this page when storage is unavailable.
  }

  applyAppearance(preference);
  window.dispatchEvent(new Event(APPEARANCE_CHANGE_EVENT));
}

export function AppearanceControl({
  variant = "compact",
}: AppearanceControlProps) {
  const legendId = useId();
  const descriptionId = useId();
  const preference = useSyncExternalStore(
    subscribe,
    readPreferenceSnapshot,
    () => "system",
  );

  return (
    <fieldset
      aria-describedby={variant === "full" ? descriptionId : undefined}
      className={`appearance-control appearance-control-${variant}`}
    >
      <legend id={legendId} className={variant === "compact" ? "sr-only" : undefined}>
        Appearance
      </legend>
      {variant === "full" ? (
        <p className="appearance-description" id={descriptionId}>
          System follows your device in real time, including macOS Automatic
          when it changes between light and dark.
        </p>
      ) : null}
      <div className="appearance-options">
        {options.map(({ value, label, detail, Icon }) => (
          <label
            className="appearance-option"
            key={value}
            title={variant === "compact" ? label : undefined}
          >
            <input
              aria-label={label}
              checked={preference === value}
              name={legendId}
              onChange={() => savePreference(value)}
              type="radio"
              value={value}
            />
            <span>
              <Icon aria-hidden="true" size={variant === "compact" ? 15 : 18} />
              <span className="appearance-option-copy">
                <strong>{label}</strong>
                {variant === "full" ? <small>{detail}</small> : null}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
