import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceControl } from "@/components/appearance-control";
import {
  APPEARANCE_STORAGE_KEY,
  DARK_THEME_COLOR,
  LIGHT_THEME_COLOR,
} from "@/src/lib/appearance";

type ChangeListener = (event: MediaQueryListEvent) => void;

function installColorSchemeMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<ChangeListener>();
  const media = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((type: string, listener: ChangeListener) => {
      if (type === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: ChangeListener) => {
      if (type === "change") listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => media),
  });

  return {
    setDark(nextDark: boolean) {
      matches = nextDark;
      const event = { matches: nextDark, media: media.media } as MediaQueryListEvent;
      act(() => listeners.forEach((listener) => listener(event)));
    },
  };
}

function themeMeta() {
  return document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.appearance;
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("color-scheme");
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

describe("AppearanceControl", () => {
  it("follows live System changes and leaves no stored override", async () => {
    const media = installColorSchemeMedia(false);
    render(<AppearanceControl variant="full" />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(themeMeta()).toHaveAttribute("content", LIGHT_THEME_COLOR);

    media.setDark(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(themeMeta()).toHaveAttribute("content", DARK_THEME_COLOR);
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
  });

  it("persists an explicit override until System is selected again", async () => {
    const user = userEvent.setup();
    const media = installColorSchemeMedia(false);
    render(<AppearanceControl variant="full" />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    media.setDark(false);
    expect(document.documentElement.dataset.theme).toBe("dark");

    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("gives the compact icon controls accessible names", () => {
    installColorSchemeMedia(false);
    render(<AppearanceControl />);

    expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
  });
});
