import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PickerProps = {
  addDisabled?: boolean;
  foods: Array<{
    id: string;
    name: string;
    categories: string[];
    planEligible: boolean;
  }>;
  onAdd: (
    mealType: "breakfast" | "lunch" | "dinner",
    food: {
      id: string;
      name: string;
      categories: string[];
      planEligible: boolean;
    },
  ) => void;
  onCatalogChanged: () => unknown | Promise<unknown>;
};

const apple = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Apple",
  categories: ["fruit"],
  planEligible: true,
};

vi.mock("@/components/food-search-picker", () => ({
  FoodSearchPicker: ({
    addDisabled,
    foods,
    onAdd,
    onCatalogChanged,
  }: PickerProps) => (
    <div aria-label="Mock food picker">
      <ul aria-label="Mock saved food results">
        {foods.map((food) => (
          <li key={food.id}>{food.name}</li>
        ))}
      </ul>
      <button
        disabled={addDisabled}
        onClick={() => onAdd("breakfast", apple)}
        type="button"
      >
        Add Apple to Breakfast
      </button>
      <button onClick={() => void onCatalogChanged()} type="button">
        Refresh mock saved foods
      </button>
    </div>
  ),
}));

import {
  MealPreferenceEditor,
  type StoredMealPreference,
} from "../../components/meal-preference-editor";

const storedApple: StoredMealPreference = {
  mealType: "breakfast",
  foodId: apple.id,
  foodName: apple.name,
  sortOrder: 0,
};

const emptyCatalogResponse = () => ({
  ok: true,
  json: async () => ({ data: [] }),
});

function mealGroup(name: string) {
  const heading = screen.getByRole("heading", { name });
  const group = heading.closest(".meal-preference-group");
  if (!group) throw new Error(`Could not find ${name} preference group.`);
  return group as HTMLElement;
}

describe("MealPreferenceEditor", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes all three post-login meal destinations discoverable", async () => {
    const user = userEvent.setup();
    render(<MealPreferenceEditor initialPreferences={[]} />);

    expect(mealGroup("Breakfast")).toHaveTextContent("None selected");
    expect(mealGroup("Lunch")).toHaveTextContent("None selected");
    expect(mealGroup("Dinner")).toHaveTextContent("None selected");
    expect(screen.getByText(/future plan needs enough eligible foods/i)).toBeInTheDocument();

    const edit = screen.getByRole("button", {
      name: "Edit meal preferences",
    });
    expect(edit).toHaveAttribute("aria-expanded", "false");
    await user.click(edit);
    expect(edit).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByLabelText("Mock food picker"),
    ).toBeInTheDocument();
  });

  it("deduplicates a food saved for multiple meals when catalog refresh fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <MealPreferenceEditor
        initialPreferences={[
          storedApple,
          { ...storedApple, mealType: "lunch" },
          { ...storedApple, mealType: "dinner" },
        ]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );
    expect(
      within(screen.getByLabelText("Mock saved food results")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: "Refresh mock saved foods" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      within(screen.getByLabelText("Mock saved food results")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("converges after an append commits but its response is lost", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyCatalogResponse())
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [storedApple], error: null }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MealPreferenceEditor initialPreferences={[]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add Apple to Breakfast" }),
    );

    await waitFor(() =>
      expect(mealGroup("Breakfast")).toHaveTextContent("Apple"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByText(/list was refreshed after the earlier response/i, {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/settings/meal-preferences",
      { method: "GET", cache: "no-store" },
    );
  });

  it("does not locally add a food from a malformed successful response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyCatalogResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {}, error: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [], error: null }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MealPreferenceEditor initialPreferences={[]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add Apple to Breakfast" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(mealGroup("Breakfast")).toHaveTextContent("None selected");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: MEAL_PREFERENCE_ADD_UNAVAILABLE",
    );
    expect(
      screen.getByText(/is not in the latest saved Breakfast preferences/i, {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
  });

  it("rejects malformed authoritative preference rows after an ambiguous add", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyCatalogResponse())
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ mealType: "breakfast", foodId: apple.id, sortOrder: 0 }],
          error: null,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MealPreferenceEditor initialPreferences={[]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add Apple to Breakfast" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(mealGroup("Breakfast")).toHaveTextContent("None selected");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: MEAL_PREFERENCE_ADD_UNAVAILABLE",
    );
    expect(
      screen.getByText(/could not be confirmed as added/i, {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
  });

  it("uses GET-only refresh when a duplicate response cannot auto-converge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyCatalogResponse())
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          data: null,
          error: {
            code: "DUPLICATE_MEAL_PREFERENCE",
            message: "That food is already selected for this meal.",
            details: "No duplicate was created.",
            retryable: false,
            action: { kind: "retry", label: "Refresh preferences" },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => null })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [storedApple], error: null }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MealPreferenceEditor initialPreferences={[]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add Apple to Breakfast" }),
    );

    await user.click(
      await screen.findByRole("button", { name: "Refresh preferences" }),
    );
    await waitFor(() =>
      expect(mealGroup("Breakfast")).toHaveTextContent("Apple"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls.slice(2)).toEqual([
      ["/api/settings/meal-preferences", { method: "GET", cache: "no-store" }],
      ["/api/settings/meal-preferences", { method: "GET", cache: "no-store" }],
    ]);
  });

  it("converges after a delete commits but its response is lost", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyCatalogResponse())
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [], error: null }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MealPreferenceEditor initialPreferences={[storedApple]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Remove Apple from Breakfast preferences",
      }),
    );

    await waitFor(() =>
      expect(mealGroup("Breakfast")).toHaveTextContent("None selected"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Breakfast is now None selected/i, {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
  });

  it("does not locally remove a food from a malformed successful response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyCatalogResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { removed: true }, error: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [storedApple], error: null }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MealPreferenceEditor initialPreferences={[storedApple]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Remove Apple from Breakfast preferences",
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(mealGroup("Breakfast")).toHaveTextContent("Apple");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: MEAL_PREFERENCE_REMOVE_UNAVAILABLE",
    );
    expect(
      screen.getByText(/is still in the latest saved Breakfast preferences/i, {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
  });

  it("retains the prior item and exposes a precise retry when removal fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyCatalogResponse())
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          data: null,
          error: {
            code: "MEAL_PREFERENCE_REMOVE_FAILED",
            message: "The food could not be removed from this meal.",
            details: "The saved preference is unchanged.",
            retryable: true,
            action: { kind: "retry", label: "Try removing again" },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [storedApple], error: null }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MealPreferenceEditor initialPreferences={[storedApple]} />);

    await user.click(
      screen.getByRole("button", { name: "Edit meal preferences" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Remove Apple from Breakfast preferences",
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Error code: MEAL_PREFERENCE_REMOVE_FAILED");
    expect(mealGroup("Breakfast")).toHaveTextContent("Apple");
    expect(
      within(alert).getByRole("button", { name: "Try removing again" }),
    ).toBeInTheDocument();
  });
});
