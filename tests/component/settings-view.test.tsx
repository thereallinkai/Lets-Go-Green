import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

const privateLabelMock = vi.hoisted(() => ({
  foodId: "77777777-7777-4777-8777-777777777777",
  displayName: `Long Brand ${"A".repeat(150)} — Long Product ${"B".repeat(220)} — Long Variant ${"C".repeat(150)}`,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/components/food-label-upload", () => ({
  FoodLabelUpload: ({
    onCreated,
  }: {
    onCreated?: (foodId: string, displayName: string) => Promise<boolean>;
  }) => (
    <div>
      <h3>1. Start with the package label</h3>
      <button
        onClick={() =>
          void onCreated?.(privateLabelMock.foodId, privateLabelMock.displayName)
        }
        type="button"
      >
        Confirm mock private label
      </button>
    </div>
  ),
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
  activeLabelDrafts: [],
  aiProviderMode: "mock",
  loadError: null,
};

describe("SettingsView", () => {
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

  it("persists explicit None choices as empty values, never sentinel text", async () => {
    router.replace.mockReset();
    router.refresh.mockReset();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: {
          saved: true,
          persisted: true,
          section: "preferences",
        },
        error: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SettingsView initialData={initialData} />);

    const allergiesNone = screen.getByRole("checkbox", {
      name: "No known allergies",
    });
    const restrictionsNone = screen.getByRole("checkbox", {
      name: "No dietary restrictions",
    });
    const dislikedNone = screen.getByRole("checkbox", {
      name: "No disliked foods",
    });
    const safetyNone = screen.getByRole("checkbox", {
      name: "No additional safety context",
    });
    expect(allergiesNone).toBeChecked();
    expect(restrictionsNone).toBeChecked();
    expect(dislikedNone).toBeChecked();
    expect(safetyNone).toBeChecked();

    await user.click(allergiesNone);
    await user.type(
      screen.getByRole("textbox", { name: "Allergies" }),
      "Peanuts, peanuts, milk",
    );
    await user.click(restrictionsNone);
    expect(restrictionsNone).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toEqual({
      section: "preferences",
      allergies: ["Peanuts", "milk"],
      dietaryRestrictions: [],
      dislikedFoods: [],
      trainingDaysPerWeek: null,
      safetyContext: "",
    });
    expect(JSON.stringify(requestBody)).not.toMatch(/\bnone\b/i);
    await waitFor(() => expect(restrictionsNone).toBeChecked());
    expect(screen.getByRole("textbox", { name: "Dietary restrictions" })).toBeDisabled();
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("clears previously stored preference and safety text through explicit None choices", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          saved: true,
          persisted: true,
          section: "preferences",
        },
        error: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <SettingsView
        initialData={{
          ...initialData,
          profile: {
            ...initialData.profile,
            allergies: ["Peanuts"],
            dietaryRestrictions: ["Vegetarian"],
            dislikedFoods: ["Olives"],
            safetyContext: "Avoid aggressive deficits",
          },
        }}
      />,
    );

    for (const name of [
      "No known allergies",
      "No dietary restrictions",
      "No disliked foods",
      "No additional safety context",
    ]) {
      const choice = screen.getByRole("checkbox", { name });
      expect(choice).not.toBeChecked();
      await user.click(choice);
      expect(choice).toBeChecked();
    }
    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toMatchObject({
      allergies: [],
      dietaryRestrictions: [],
      dislikedFoods: [],
      safetyContext: "",
    });
    expect(JSON.stringify(requestBody)).not.toMatch(/\bnone\b/i);
  });

  it("does not report a preference save from a malformed successful envelope", async () => {
    router.refresh.mockReset();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {}, error: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <SettingsView
        initialData={{
          ...initialData,
          profile: { ...initialData.profile, allergies: ["Peanuts"] },
        }}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: "No known allergies" }),
    );
    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "incomplete save confirmation",
    );
    expect(router.refresh).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Preferences saved. Any accepted plan remains unchanged."),
    ).not.toBeInTheDocument();
  });

  it("keeps a draft listed when a successful discard envelope is incomplete", async () => {
    router.refresh.mockReset();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { discarded: true }, error: null }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <SettingsView
        initialData={{
          ...initialData,
          activeLabelDrafts: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              status: "draft",
              brandName: "Example Brand",
              productName: "Example Protein",
              variantName: null,
              createdAt: "2026-08-20T12:00:00.000Z",
            },
          ],
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    await user.click(
      screen.getByRole("button", { name: "Discard draft permanently" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: LABEL_DRAFT_DISCARD_UNAVAILABLE",
    );
    expect(screen.getByText("Example Brand — Example Protein")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("focuses the preference section when opened from the profile link", async () => {
    window.history.replaceState(null, "", "/settings#preferences");
    render(<SettingsView initialData={initialData} />);

    await waitFor(() =>
      expect(
        screen.getByRole("region", {
          name: "Preferences and safety context",
        }),
      ).toHaveFocus(),
    );
  });

  it("keeps one label-photo workflow when the meal editor opens", async () => {
    window.history.replaceState(null, "", "/settings");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [], error: null }),
      }),
    );
    const user = userEvent.setup();
    render(<SettingsView initialData={initialData} />);

    expect(
      screen.getAllByRole("heading", {
        name: "1. Start with the package label",
      }),
    ).toHaveLength(1);
    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );

    expect(
      screen.getAllByRole("heading", {
        name: "1. Start with the package label",
      }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("link", {
        name: /Read its nutrition-label photo once in Private label foods/i,
      }),
    ).toHaveAttribute("href", "#foods");
    expect(
      screen.queryByText("Product not found? Add package-label photos"),
    ).not.toBeInTheDocument();
  });

  it("refreshes a maximum-length private label by owner-scoped ID, not its display name", async () => {
    router.refresh.mockReset();
    window.history.replaceState(null, "", "/settings");
    const fetchMock = vi.fn(async (...arguments_: Parameters<typeof fetch>) => {
      const url = String(arguments_[0]);
      if (url === "/api/food-labels") {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: "88888888-8888-4888-8888-888888888888",
                status: "confirmed",
                brand_name: "Long Brand",
                product_name: "Long Product",
                variant_name: "Long Variant",
                private_food_id: privateLabelMock.foodId,
                created_at: "2026-08-20T12:00:00.000Z",
              },
            ],
            error: null,
          }),
        };
      }
      if (url.startsWith("/api/foods")) {
        return { ok: true, json: async () => ({ data: [], error: null }) };
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SettingsView initialData={initialData} />);

    await user.click(
      screen.getByRole("button", { name: "Confirm mock private label" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/food-labels", {
        cache: "no-store",
      }),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes(encodeURIComponent(privateLabelMock.displayName)),
      ),
    ).toBe(false);

    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );
    expect(await screen.findByText(privateLabelMock.displayName)).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalledOnce();
  });
});
