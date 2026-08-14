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
  nutritionReferenceUnit: "g" as const,
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
  nutritionReferenceUnit: "g" as const,
  nutritionPreview: {
    calories: 20,
    proteinGrams: 2.2,
    carbohydrateGrams: 3.9,
    fatGrams: 0.1,
  },
};

const offLiquidCandidate = {
  ...offCandidate,
  externalId: "5555555555555",
  displayName: "Example Brand — Tomato juice",
  productName: "Tomato juice",
  gtin: "5555555555555",
  imageUrl: null,
  nutritionReferenceUnit: "ml" as const,
};

const offUnknownBasisCandidate = {
  ...offCandidate,
  externalId: "6666666666666",
  displayName: "Example Brand — Mystery drink",
  productName: "Mystery drink",
  gtin: "6666666666666",
  imageUrl: null,
  nutritionReferenceUnit: "unknown" as const,
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
        candidates: [
          unrelatedBranded,
          usdaAsparagus,
          offCandidate,
          offLiquidCandidate,
          offUnknownBasisCandidate,
        ],
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
    expect(within(results).getByText("Per 100 mL:")).toBeInTheDocument();
    expect(
      within(results).getByText("Per 100 g or mL (source unclear):"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `Nutrition-basis import unavailable for ${offLiquidCandidate.displayName}`,
      }),
    ).toBeDisabled();
    expect(
      within(results).getByText(/cannot enter gram-based plan math safely/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/barcode/i)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    await runCatalogDebounce();
    fireEvent.change(input, { target: { value: "asparagus" } });
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires one explicit meal destination, never silently defaults to Breakfast, and keeps Lunch for saved foods", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const secondFood = {
      ...localFood,
      id: "22222222-2222-4222-8222-222222222222",
      name: "Local Tofu",
    };
    render(
      <FoodSearchPicker
        foods={[localFood, secondFood]}
        search=""
        onSearchChange={vi.fn()}
        onAdd={onAdd}
        onCatalogChanged={vi.fn()}
      />,
    );

    const destination = screen.getByRole("combobox", {
      name: "Meal destination for saved foods",
    });
    expect(destination).toHaveValue("");
    expect(
      screen.getByRole("button", {
        name: "Choose a meal before adding Local Whey Protein",
      }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: /to breakfast/i })).not.toBeInTheDocument();

    await user.selectOptions(destination, "lunch");
    await user.click(
      screen.getByRole("button", { name: "Add Local Whey Protein to lunch" }),
    );

    expect(onAdd).toHaveBeenCalledWith("lunch", localFood);
    expect(destination).toHaveValue("lunch");
    expect(
      screen.getByRole("button", { name: "Add Local Tofu to lunch" }),
    ).toBeEnabled();
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
    expect(
      screen.queryByRole("combobox", {
        name: new RegExp(offCandidate.displayName, "i"),
      }),
    ).not.toBeInTheDocument();
    const importButton = screen.getByRole("button", {
      name: `Save ${offCandidate.displayName} for catalog review`,
    });

    fireEvent.click(importButton);
    await act(async () => Promise.resolve());
    const sourceCard = screen.getByRole("heading", {
      level: 3,
      name: offCandidate.displayName,
    }).closest("article")!;
    expect(await within(sourceCard).findByRole("alert")).toHaveTextContent(
      "Open Food Facts is temporarily unavailable.",
    );
    expect(within(sourceCard).getByRole("alert")).toHaveTextContent(
      "Error code: FOOD_SOURCE_UNAVAILABLE",
    );
    expect(screen.getByText(/Some source results are unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(offCandidate.displayName)).toBeInTheDocument();
    expect(importButton).toBeEnabled();

    fireEvent.click(
      within(sourceCard).getByRole("button", { name: "Retry import" }),
    );
    await act(async () => Promise.resolve());
    expect(await within(sourceCard).findByRole("status")).toHaveTextContent(
      "Saved for catalog review. It was not added to a meal.",
    );
    expect(within(sourceCard).queryByText(/intended destination/i)).not.toBeInTheDocument();
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

  it("combines visually identical source records despite different IDs and package codes", async () => {
    vi.useFakeTimers();
    const duplicate = {
      ...offCandidate,
      externalId: "9999999999999",
      gtin: "9999999999999",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        kind: "candidates",
        candidates: [offCandidate, duplicate],
        providers: [
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

    const results = screen.getByLabelText("Food search results");
    expect(within(results).getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 1 unique match")).toBeInTheDocument();
  });

  it("keeps a source formulation whose name matches a saved food but identifier differs", async () => {
    vi.useFakeTimers();
    const sourceVariant = {
      ...offCandidate,
      packageDescription: "2 lb tub",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          kind: "candidates",
          candidates: [sourceVariant],
          providers: [
            {
              provider: "open_food_facts",
              status: "ok",
              resultCount: 1,
              message: null,
            },
          ],
        }),
      ),
    );

    render(
      <FoodSearchPicker
        foods={[
          {
            ...localFood,
            id: "22222222-2222-4222-8222-222222222222",
            name: offCandidate.displayName,
            brandName: null,
            variantName: null,
            gtin: "111111111111",
          },
        ]}
        search="chocolate whey"
        onSearchChange={vi.fn()}
        onAdd={vi.fn()}
        onCatalogChanged={vi.fn(async () => true)}
      />,
    );
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());

    expect(
      screen.getAllByRole("heading", {
        level: 3,
        name: offCandidate.displayName,
      }),
    ).toHaveLength(2);
    expect(screen.getByText(/Package 2 lb tub/)).toBeInTheDocument();
  });

  it("shows six unique matches initially and reveals the remaining matches on request", async () => {
    vi.useFakeTimers();
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      ...usdaAsparagus,
      externalId: `asparagus-${index + 1}`,
      displayName: `Farm ${index + 1} — Asparagus`,
      productName: `Farm ${index + 1} Asparagus`,
      gtin: `000000000000${index + 1}`,
      dataType: "Branded",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          kind: "candidates",
          candidates,
          providers: [
            {
              provider: "usda_fdc",
              status: "ok",
              resultCount: 8,
              message: null,
            },
          ],
        }),
      ),
    );

    render(
      <FoodSearchPicker
        foods={[]}
        search="asparagus"
        onSearchChange={vi.fn()}
        onAdd={vi.fn()}
        onCatalogChanged={vi.fn(async () => true)}
      />,
    );
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());

    const results = screen.getByLabelText("Food search results");
    expect(within(results).getAllByRole("heading", { level: 3 })).toHaveLength(6);
    expect(screen.getByText("Showing 6 of 8 unique matches")).toBeInTheDocument();
    const showAll = screen.getByRole("button", {
      name: "Show all 2 remaining matches",
    });
    expect(showAll).toHaveAttribute("aria-expanded", "false");
    showAll.focus();
    fireEvent.click(showAll);
    expect(within(results).getAllByRole("heading", { level: 3 })).toHaveLength(8);
    expect(screen.getByText("Showing 8 of 8 unique matches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer matches" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Show fewer matches" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("scopes a 429 to its source card and blocks that provider until Retry-After expires", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          kind: "candidates",
          candidates: [offCandidate],
          providers: [
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
              code: "FOOD_IMPORT_RATE_LIMITED",
              message: "Wait before making another lookup.",
              details: "Nothing was saved.",
              retryable: true,
              action: { kind: "wait", label: "Wait, then try again" },
            },
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "2",
            },
          },
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
    const card = screen.getByRole("heading", {
      level: 3,
      name: offCandidate.displayName,
    }).closest("article")!;

    await act(async () => {
      fireEvent.click(
        within(card).getByRole("button", {
          name: `Save ${offCandidate.displayName} for catalog review`,
        }),
      );
      await Promise.resolve();
    });

    expect(within(card).getByRole("alert")).toHaveTextContent(
      "Error code: FOOD_IMPORT_RATE_LIMITED",
    );
    expect(screen.getByText(/Source results for “chocolate whey” are ready/i)).toBeInTheDocument();
    const cooldownButton = within(card).getByRole("button", {
      name: `Saving ${offCandidate.displayName} is temporarily unavailable`,
    });
    expect(cooldownButton).toBeDisabled();
    expect(cooldownButton).toHaveTextContent("Wait 2s");

    const rateLimitedAt = Date.now();
    await act(async () => {
      // Simulate a throttled background tab: wall-clock time advances without
      // interval callbacks, then focus forces an exact deadline refresh.
      vi.setSystemTime(rateLimitedAt + 2_100);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(card).getByRole("button", {
        name: `Save ${offCandidate.displayName} for catalog review`,
      }),
    ).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect an expired card error during a later provider cooldown", async () => {
    vi.useFakeTimers();
    const secondCandidate = {
      ...offCandidate,
      externalId: "748927022651",
      displayName: "Optimum Nutrition — Vanilla Whey",
      productName: "Vanilla Whey",
      gtin: "748927022651",
    };
    const limitedResponse = () =>
      new Response(
        JSON.stringify({
          data: null,
          error: {
            code: "FOOD_IMPORT_RATE_LIMITED",
            message: "Wait before saving another source record.",
            details: "No provider request was sent.",
            retryable: true,
            retryAfterSeconds: 1,
            action: { kind: "wait", label: "Wait, then try again" },
          },
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "1",
          },
        },
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          kind: "candidates",
          candidates: [offCandidate, secondCandidate],
          providers: [
            {
              provider: "open_food_facts",
              status: "ok",
              resultCount: 2,
              message: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(limitedResponse())
      .mockResolvedValueOnce(limitedResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FoodSearchPicker
        foods={[]}
        search="whey"
        onSearchChange={vi.fn()}
        onAdd={vi.fn()}
        onCatalogChanged={vi.fn(async () => true)}
      />,
    );
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    const firstCard = screen
      .getByRole("heading", { level: 3, name: offCandidate.displayName })
      .closest("article")!;
    const secondCard = screen
      .getByRole("heading", { level: 3, name: secondCandidate.displayName })
      .closest("article")!;

    fireEvent.click(
      within(firstCard).getByRole("button", {
        name: `Save ${offCandidate.displayName} for catalog review`,
      }),
    );
    await act(async () => Promise.resolve());
    expect(within(firstCard).getByRole("alert")).toBeInTheDocument();

    const limitedAt = Date.now();
    await act(async () => {
      vi.setSystemTime(limitedAt + 1_100);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(within(firstCard).queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(
      within(secondCard).getByRole("button", {
        name: `Save ${secondCandidate.displayName} for catalog review`,
      }),
    );
    await act(async () => Promise.resolve());
    expect(within(secondCard).getByRole("alert")).toBeInTheDocument();
    expect(within(firstCard).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("expires partial provider results instead of indefinitely reusing them", async () => {
    vi.useFakeTimers();
    const response = {
      kind: "candidates" as const,
      candidates: [offCandidate],
      providers: [
        {
          provider: "usda_fdc" as const,
          status: "rate_limited" as const,
          resultCount: 0,
          message: "USDA is temporarily rate limited.",
        },
        {
          provider: "open_food_facts" as const,
          status: "ok" as const,
          resultCount: 1,
          message: null,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(response));
    vi.stubGlobal("fetch", fetchMock);

    function Harness() {
      const [search, setSearch] = useState("chocolate whey");
      return (
        <FoodSearchPicker
          foods={[]}
          search={search}
          onSearchChange={setSearch}
          onAdd={vi.fn()}
          onCatalogChanged={vi.fn(async () => true)}
        />
      );
    }

    render(<Harness />);
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    const input = screen.getByRole("textbox", { name: "Search foods and products" });
    fireEvent.change(input, { target: { value: "" } });
    await runCatalogDebounce();
    fireEvent.change(input, { target: { value: "chocolate whey" } });
    await runCatalogDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores an older provider response that resolves after a newer query", async () => {
    vi.useFakeTimers();
    let resolveOlder!: (response: Response) => void;
    const olderResponse = new Promise<Response>((resolve) => {
      resolveOlder = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => olderResponse)
      .mockResolvedValueOnce(
        jsonResponse({
          kind: "candidates",
          candidates: [usdaAsparagus],
          providers: [
            {
              provider: "usda_fdc",
              status: "ok",
              resultCount: 1,
              message: null,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    function Harness() {
      const [search, setSearch] = useState("chocolate whey");
      return (
        <FoodSearchPicker
          foods={[]}
          search={search}
          onSearchChange={setSearch}
          onAdd={vi.fn()}
          onCatalogChanged={vi.fn(async () => true)}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const input = screen.getByRole("textbox", {
      name: "Search foods and products",
    });
    fireEvent.change(input, { target: { value: "asparagus" } });
    fireEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await act(async () => Promise.resolve());
    expect(
      screen.getByRole("heading", { level: 3, name: "Asparagus, raw" }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveOlder(
        jsonResponse({
          kind: "candidates",
          candidates: [offCandidate],
          providers: [
            {
              provider: "open_food_facts",
              status: "ok",
              resultCount: 1,
              message: null,
            },
          ],
        }),
      );
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", { level: 2, name: "Best matches for “asparagus”" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        level: 3,
        name: offCandidate.displayName,
      }),
    ).not.toBeInTheDocument();
  });

  it("ignores a saved-catalog failure from an obsolete query", async () => {
    vi.useFakeTimers();
    let resolveOlder!: (result: boolean) => void;
    const olderRefresh = new Promise<boolean>((resolve) => {
      resolveOlder = resolve;
    });
    const onCatalogChanged = vi.fn((query?: string) =>
      query === "older query" ? olderRefresh : Promise.resolve(true),
    );

    function Harness() {
      const [search, setSearch] = useState("older query");
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

    render(<Harness />);
    await runCatalogDebounce();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search foods and products" }),
      { target: { value: "newer query" } },
    );
    await runCatalogDebounce();

    await act(async () => {
      resolveOlder(false);
      await Promise.resolve();
    });

    expect(onCatalogChanged).toHaveBeenCalledWith("older query");
    expect(onCatalogChanged).toHaveBeenCalledWith("newer query");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
    const sourceCard = screen.getByRole("heading", {
      level: 3,
      name: offCandidate.displayName,
    }).closest("article")!;

    fireEvent.click(
      screen.getByRole("button", {
        name: `Save ${offCandidate.displayName} for catalog review`,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: FOOD_IMPORT_REFRESH_FAILED",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onCatalogChanged).toHaveBeenCalledTimes(2);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh saved foods" }),
      );
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(sourceCard).getByRole("status")).toHaveTextContent(
      "Saved for catalog review. It was not added to a meal.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onCatalogChanged).toHaveBeenCalledTimes(3);
    expect(
      screen.getByRole("button", {
        name: `Save ${offCandidate.displayName} for catalog review`,
      }),
    ).toBeDisabled();
  });
});
