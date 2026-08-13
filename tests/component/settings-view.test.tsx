import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import {
  SettingsView,
  type SettingsInitialData,
} from "../../components/settings-view";

const initialData: SettingsInitialData = {
  mode: "authenticated",
  account: { email: "member@example.test", createdAt: null },
  profile: {
    fullName: "Member",
    preferredWeightUnit: "kg",
    timeZone: "UTC",
    allergies: [],
    dietaryRestrictions: [],
    dislikedFoods: [],
    trainingDaysPerWeek: null,
    safetyContext: "",
  },
  goal: null,
  mealPreferences: [],
  privateLabelFoods: [],
  aiProviderMode: "mock",
  loadError: null,
};

describe("SettingsView logout", () => {
  it("keeps the user in place and shows the structured retryable reason", async () => {
    router.replace.mockReset();
    router.refresh.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: "LOGOUT_FAILED",
            message: "Logout could not be completed.",
            details:
              "Your session may still be active. Check the connection and try logging out again.",
            retryable: true,
            action: {
              kind: "retry",
              label: "Try logging out again",
            },
          },
        }),
      }),
    );
    const user = userEvent.setup();
    render(<SettingsView initialData={initialData} />);

    await user.click(screen.getByRole("button", { name: "Log out" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You are still signed in.");
    expect(alert).toHaveTextContent("Error code: LOGOUT_FAILED");
    expect(alert).toHaveTextContent("Your session may still be active.");
    expect(alert).toHaveTextContent("Retry available: yes");
    expect(
      screen.getByRole("button", { name: "Try logging out again" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(router.replace).not.toHaveBeenCalled());
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
