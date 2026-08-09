import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FoodSearchPicker,
  type FoodPickerItem,
} from "../../components/food-search-picker";

const localFood: FoodPickerItem = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Local Whey Protein",
  categories: ["protein", "supplement"],
  planEligible: true,
  brandName: "Local Brand",
  variantName: "Chocolate",
  gtin: null,
  catalogStatus: "active",
  nutrition: null,
  source: null,
};

const offCandidate = {
  provider: "open_food_facts" as const,
  externalId: "748927022650",
  displayName:
    "Optimum Nutrition — Gold Standard 100% Whey Double Rich Chocolate",
  brandName: "Optimum Nutrition",
  productName: "Gold Standard 100% Whey Double Rich Chocolate",
  variantName: null,
  gtin: "748927022650",
  dataType: "Open Food Facts product",
  imageUrl:
    "https://images.openfoodfacts.org/images/products/748/927/022/650/front_en.12.200.jpg",
  nutritionImageUrl: null,
  nutritionPreview: {
    calories: 375,
    proteinGrams: 75,
    carbohydrateGrams: 9.4,
    fatGrams: 3.1,
  },
};

const usdaAsparagus = {
  provider: "usda_fdc" as const,
  externalId: "168390",
  displayName: "Asparagus, raw",
  brandName: null,
  productName: "Asparagus, raw",
  variantName: null,
  gtin: null,
  dataType: "Foundation",
  imageUrl: null,
  nutritionImageUrl: null,
  nutritionPreview: {
    calories: 20,
    proteinGrams: 2.2,
    carbohydrateGrams: 3.9,
    fatGrams: 0.1,
  },
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function runCatalogDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FoodSearchPicker smart discovery", () => {
  it("reports a resolved false from the initial saved-food refresh", async () => {
    vi.useFakeTimers();
    const onCatalogChanged = vi.fn(async () => false);

    render(
      <FoodSearchPicker
        foods={[]}
        search="asparagus"
        onSearchChange={vi.fn()}
        onAdd={vi.fn()}
        onCatalogChanged={onCatalogChanged}
      />,
    );

    await runCatalogDebounce();

    expect(onCatalogChanged).toHaveBeenCalledWith("asparagus");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: SAVED_FOOD_SEARCH_FAILED",
    );
    expect(
      screen.getByRole("button", { name: "Retry saved-food search" }),
    ).toBeEnabled();
  });

  it("debounces the saved catalog, runs one explicit merged lookup, ranks a generic exact match first, shows source photos, and reuses the visit cache", async () => {
    vi.useFakeTimers();
    const unrelatedBranded = {
      ...offCandidate,
      externalId: "1234567890123",
      gtin: "1234567890123",
      displayName: "Snack Co — Crispy asparagus-flavored chips",
      productName: "Crispy asparagus-flavored chips",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        kind: "candidates",
        candidates: [unrelatedBranded, usdaAsparagus, offCandidate],
        providers: [
          { provider: "usda_fdc", status: "ok", resultCount: 1, message: null },
          {
            provider: "open_food_facts",
            status: "ok",
            resultCount: 2,
            message: null,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onCatalogChanged = vi.fn(async () => true);

    function Harness() {
      const [search, setSearch] = useState("");
      return (
        <FoodSearchPicker
          foods={[]}
          search={search}
          onSearchChange={setSearch}
          onAdd={vi.fn()}
          onCatalogChanged={onCatalogChanged}
        />
      );
    }

    const { container } = render(<Harness />);
    const input = screen.getByRole("textbox", {
      name: "Search foods and products",
    });
    fireEvent.change(input, { target: { value: "asparagus" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCatalogChanged).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCatalogChanged).toHaveBeenCalledWith("asparagus");

    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      action: "search",
      query: "asparagus",
    });

    const results = screen.getByLabelText("Food search results");
    const headings = within(results).getAllByRole("heading", { level: 3 });
    expect(headings[0]).toHaveTextContent("Asparagus, raw");
    expect(
      screen.getByRole("img", {
        name: /Optimum Nutrition.*package photo supplied by Open Food Facts/i,
      }),
    ).toHaveAttribute("src", offCandidate.imageUrl);
    expect(container.querySelector('[data-layout="overflow-safe-food-search"]')).toBeTruthy();
    expect(screen.queryByText(/barcode/i)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    await runCatalogDebounce();
    fireEvent.change(input, { target: { value: "asparagus" } });
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit meal destination before Add", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <FoodSearchPicker
        foods={[localFood]}
        search=""
        onSearchChange={vi.fn()}
        onAdd={onAdd}
        onCatalogChanged={vi.fn()}
      />,
    );

    const destination = screen.getByRole("combobox", {
      name: "Destination for Local Whey Protein",
    });
    expect(destination).toHaveValue("breakfast");
    await user.selectOptions(destination, "lunch");
    await user.click(
      screen.getByRole("button", { name: "Add Local Whey Protein to lunch" }),
    );

    expect(onAdd).toHaveBeenCalledWith("lunch", localFood);
    expect(screen.getAllByRole("button", { name: /^Add .* to / })).toHaveLength(1);
  });

  it("keeps partial provider results usable and recovers from an import failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          kind: "candidates",
          candidates: [offCandidate],
          providers: [
            {
              provider: "usda_fdc",
              status: "unavailable",
              resultCount: 0,
              message: "USDA FoodData Central could not be reached.",
            },
            {
              provider: "open_food_facts",
              status: "ok",
              resultCount: 1,
              message: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: null,
            error: {
              code: "FOOD_SOURCE_UNAVAILABLE",
              message: "Open Food Facts is temporarily unavailable.",
              details: "Nothing was imported. Retry this source later.",
              retryable: true,
              action: { kind: "retry", label: "Retry import" },
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            kind: "imported",
            displayName: offCandidate.displayName,
            reviewStatus: "pending_review",
          },
          201,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FoodSearchPicker
        foods={[]}
        search="chocolate whey"
        onSearchChange={vi.fn()}
        onAdd={vi.fn()}
        onCatalogChanged={vi.fn(async () => true)}
      />,
    );
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    vi.useRealTimers();

    expect(screen.getByText(/Some source results are unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(offCandidate.displayName)).toBeInTheDocument();
    const destination = screen.getByRole("combobox", {
      name: `Intended destination for ${offCandidate.displayName}`,
    });
    fireEvent.change(destination, { target: { value: "dinner" } });
    const importButton = screen.getByRole("button", {
      name: `Import ${offCandidate.displayName} for Dinner review`,
    });

    fireEvent.click(importButton);
    await act(async () => Promise.resolve());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Open Food Facts is temporarily unavailable.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: FOOD_SOURCE_UNAVAILABLE",
    );
    expect(importButton).toBeEnabled();

    fireEvent.click(importButton);
    await act(async () => Promise.resolve());
    expect(await screen.findByText(/Dinner is your intended destination/i)).toBeInTheDocument();
    expect(screen.getByText("Imported for Dinner review")).toBeInTheDocument();
    expect(importButton).toBeDisabled();
  });

  it("offers a retry after total search failure and restores results", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: null,
            error: {
              code: "FOOD_LOOKUP_UNAVAILABLE",
              message: "Online food search is temporarily unavailable.",
              details: "No external source was contacted.",
              retryable: true,
              action: { kind: "retry", label: "Retry search" },
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          kind: "candidates",
          candidates: [usdaAsparagus],
          providers: [
            { provider: "usda_fdc", status: "ok", resultCount: 1, message: null },
            {
              provider: "open_food_facts",
              status: "ok",
              resultCount: 0,
              message: null,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FoodSearchPicker
        foods={[]}
        search="asparagus"
        onSearchChange={vi.fn()}
        onAdd={vi.fn()}
        onCatalogChanged={vi.fn()}
      />,
    );
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    vi.useRealTimers();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Online food search is temporarily unavailable.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: FOOD_LOOKUP_UNAVAILABLE",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
    await act(async () => Promise.resolve());
    expect(await screen.findByText("Asparagus, raw")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("imports once, then retries only the saved-food refresh when refresh resolves false", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          kind: "candidates",
          candidates: [offCandidate],
          providers: [
            {
              provider: "usda_fdc",
              status: "ok",
              resultCount: 0,
              message: null,
            },
            {
              provider: "open_food_facts",
              status: "ok",
              resultCount: 1,
              message: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            kind: "imported",
            displayName: offCandidate.displayName,
            reviewStatus: "pending_review",
          },
          201,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const onCatalogChanged = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    render(
      <FoodSearchPicker
        foods={[]}
        search="chocolate whey"
        onSearchChange={vi.fn()}
        onAdd={vi.fn()}
        onCatalogChanged={onCatalogChanged}
      />,
    );
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    vi.useRealTimers();

    fireEvent.click(
      screen.getByRole("button", {
        name: `Import ${offCandidate.displayName} for Breakfast review`,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: FOOD_IMPORT_REFRESH_FAILED",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onCatalogChanged).toHaveBeenCalledTimes(2);

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh saved foods" }),
    );

    expect(await screen.findByText("Saved foods are up to date.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onCatalogChanged).toHaveBeenCalledTimes(3);
    expect(
      screen.getByRole("button", {
        name: `Import ${offCandidate.displayName} for Breakfast review`,
      }),
    ).toBeDisabled();
  });
});
