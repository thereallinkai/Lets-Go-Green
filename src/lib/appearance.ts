export const APPEARANCE_STORAGE_KEY = "lets-go-green-appearance";
export const APPEARANCE_CHANGE_EVENT = "lets-go-green:appearance-change";

export const LIGHT_THEME_COLOR = "#edf7ee";
export const DARK_THEME_COLOR = "#07120c";

export type AppearancePreference = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

export function isAppearancePreference(
  value: unknown,
): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): ResolvedAppearance {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return preference;
}

export function getThemeColor(theme: ResolvedAppearance) {
  return theme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
}

export const APPEARANCE_BOOTSTRAP_SCRIPT = `(() => {
  const root = document.documentElement;
  let preference = "system";

  try {
    const saved = window.localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});
    if (saved === "light" || saved === "dark") preference = saved;
  } catch {}

  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  root.dataset.appearance = preference;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  let metas = document.querySelectorAll('meta[name="theme-color"]');
  if (metas.length === 0) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
    metas = document.querySelectorAll('meta[name="theme-color"]');
  }

  const color = theme === "dark" ? ${JSON.stringify(DARK_THEME_COLOR)} : ${JSON.stringify(LIGHT_THEME_COLOR)};
  metas.forEach((meta) => {
    meta.setAttribute("content", color);
    meta.removeAttribute("media");
  });
})();`;
