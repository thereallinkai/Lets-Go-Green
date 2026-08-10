import { describe, expect, it } from "vitest";
import {
  APPEARANCE_BOOTSTRAP_SCRIPT,
  APPEARANCE_STORAGE_KEY,
  DARK_THEME_COLOR,
  LIGHT_THEME_COLOR,
  getThemeColor,
  isAppearancePreference,
  resolveAppearance,
} from "@/src/lib/appearance";

describe("appearance helpers", () => {
  it("validates only supported preferences", () => {
    expect(isAppearancePreference("system")).toBe(true);
    expect(isAppearancePreference("light")).toBe(true);
    expect(isAppearancePreference("dark")).toBe(true);
    expect(isAppearancePreference("automatic")).toBe(false);
    expect(isAppearancePreference(null)).toBe(false);
  });

  it("resolves System from the current operating-system preference", () => {
    expect(resolveAppearance("system", false)).toBe("light");
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });

  it("maps resolved themes to browser chrome colors", () => {
    expect(getThemeColor("light")).toBe(LIGHT_THEME_COLOR);
    expect(getThemeColor("dark")).toBe(DARK_THEME_COLOR);
  });

  it("includes all values needed by the pre-paint bootstrap", () => {
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain(APPEARANCE_STORAGE_KEY);
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain(LIGHT_THEME_COLOR);
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain(DARK_THEME_COLOR);
  });
});
