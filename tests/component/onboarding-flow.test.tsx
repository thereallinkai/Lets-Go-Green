import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingFlow as OnboardingFlowComponent } from "../../components/onboarding-flow";

const TEST_DRAFT_OWNER_KEY = "test-user";
const ONBOARDING_DRAFT_KEY =
  `lets-go-green-onboarding-draft:${TEST_DRAFT_OWNER_KEY}`;

function OnboardingFlow(
  props: Omit<ComponentProps<typeof OnboardingFlowComponent>, "draftOwnerKey">,
) {
  return (
    <OnboardingFlowComponent
      {...props}
      draftOwnerKey={TEST_DRAFT_OWNER_KEY}
    />
  );
}

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

function mockBackgroundRequests() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return { ok: true };
      return { ok: false };
    }),
  );
}

function mealSection(meal: "Breakfast" | "Lunch" | "Dinner") {
  const section = screen.getByRole("heading", { name: meal }).closest("section");
  if (!section) throw new Error(`Could not find ${meal} meal section.`);
  return section as HTMLElement;
}

function completionDraft(overrides: Record<string, unknown> = {}) {
  return {
    meals: {
      breakfast: ["rolled-oats"],
      lunch: ["chicken-breast"],
      dinner: ["broccoli"],
    },
    currentWeight: "210",
    targetWeight: "200",
    unit: "lb",
    goalType: "fat_loss",
    targetDate: "2026-08-31",
    height: "175 cm",
    activity: "high",
    trainingDays: "3",
    restrictions: "",
    allergies: "",
    timeZone: "America/New_York",
    safety: [],
    notes: "",
    acknowledgedWarnings: [],
    ...overrides,
  };
}

function storedDraft(
  draft: Record<string, unknown>,
  savedAt: number,
  currentStep = 4,
) {
  return JSON.stringify({ version: 1, savedAt, currentStep, draft });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockCompletionRequests(options?: {
  putResponse?: Response;
  generationResponses?: Response[];
  foods?: Array<{
    slug: string;
    english_name: string;
    categories: string[];
    plan_eligible: boolean;
  }>;
}) {
  const foods = options?.foods ?? [
    {
      slug: "rolled-oats",
      english_name: "Rolled oats",
      categories: ["Carbohydrate", "Protein"],
      plan_eligible: true,
    },
    {
      slug: "chicken-breast",
      english_name: "Chicken breast",
      categories: ["Protein"],
      plan_eligible: true,
    },
    {
      slug: "broccoli",
      english_name: "Broccoli",
      categories: ["Vegetable"],
      plan_eligible: true,
    },
  ];
  const generationResponses = [...(options?.generationResponses ?? [])];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/onboarding") && init?.method === "PUT") {
        return options?.putResponse
          ?? jsonResponse({ data: { completed: true, goalId: "goal-1" }, error: null });
      }
      if (url.endsWith("/api/onboarding") && init?.method === "PATCH") {
        return jsonResponse({ data: { saved: true }, error: null });
      }
      if (url.endsWith("/api/onboarding")) {
        return jsonResponse({
          data: { currentStep: null, draft: null },
          error: null,
        });
      }
      if (url.endsWith("/api/foods")) {
        return jsonResponse({ data: foods, error: null });
      }
      if (
        url.endsWith("/api/plans/generate") &&
        init?.method === "POST"
      ) {
        return generationResponses.shift()
          ?? jsonResponse(
            {
              data: null,
              error: {
                code: "PLAN_GENERATION_FAILED",
                message: "Plan generation failed.",
              },
            },
            500,
          );
      }
      return jsonResponse({ data: null, error: { code: "NOT_FOUND", message: "Not found." } }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OnboardingFlow navigation and restoration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
    mockBackgroundRequests();
  });

  it("restores a local draft and preserves it across forward and back navigation", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({
        currentWeight: "82.5",
        targetWeight: "76",
        unit: "kg",
        goalType: "fat_loss",
        targetDate: "2026-12-15",
      }),
    );
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={4} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Current weight")).toHaveValue("82.5");
      expect(screen.getByLabelText("Target weight")).toHaveValue("76");
      expect(screen.getByLabelText("Target date")).toHaveValue("2026-12-15");
    });

    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(
      screen.getByRole("heading", { name: "Add the context your plan needs." }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect(
      screen.getByRole("heading", {
        name: "Set a direction, not a promise.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Current weight")).toHaveValue("82.5");
    expect(screen.getByLabelText("Target weight")).toHaveValue("76");
  });

  it("removes unscoped legacy drafts instead of exposing them to another account", async () => {
    window.localStorage.setItem(
      "lets-go-green-onboarding-draft",
      JSON.stringify(
        completionDraft({
          currentWeight: "123.4",
          allergies: "Private allergy from another account",
        }),
      ),
    );

    render(<OnboardingFlow initialStep={4} />);

    await screen.findByRole("heading", {
      name: "Set a direction, not a promise.",
    });
    expect(screen.getByLabelText("Current weight")).toHaveValue("");
    expect(
      window.localStorage.getItem("lets-go-green-onboarding-draft"),
    ).toBeNull();
  });

  it("ignores malformed restored fields without crashing onboarding", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({
        currentWeight: { unexpected: true },
        targetWeight: "76",
        goalType: ["fat_loss"],
        safety: "not-an-array",
        acknowledgedWarnings: [{ warningCode: 42 }],
        meals: { breakfast: "not-an-array" },
      }),
    );

    render(<OnboardingFlow initialStep={4} />);

    await screen.findByRole("heading", {
      name: "Set a direction, not a promise.",
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Current weight")).toHaveValue("");
      expect(screen.getByLabelText("Target weight")).toHaveValue("76");
    });
    expect(
      screen.getByRole("radio", { name: "Fat loss" }),
    ).toBeChecked();
  });

  it("continues with account persistence when browser storage is blocked", async () => {
    const storageGetter = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("Storage is blocked", "SecurityError");
      });

    try {
      render(<OnboardingFlow initialStep={4} />);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/onboarding");
      });
      expect(
        screen.getByRole("heading", {
          name: "Set a direction, not a promise.",
        }),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.getByText(/browser storage unavailable/i),
        ).toBeInTheDocument();
      });
    } finally {
      storageGetter.mockRestore();
    }
  });

  it.each([
    {
      name: "keeps a newer browser-only draft",
      browserSavedAt: 2_000,
      accountUpdatedAt: "1970-01-01T00:00:01.000Z",
      expectedWeight: "91",
    },
    {
      name: "uses a newer authenticated account draft",
      browserSavedAt: 1_000,
      accountUpdatedAt: "1970-01-01T00:00:02.000Z",
      expectedWeight: "82",
    },
  ])("$name regardless of response timing", async ({
    browserSavedAt,
    accountUpdatedAt,
    expectedWeight,
  }) => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      storedDraft(completionDraft({ currentWeight: "91" }), browserSavedAt),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/onboarding") && init?.method === "PATCH") {
          return jsonResponse({ data: { saved: true }, error: null });
        }
        if (url.endsWith("/api/onboarding")) {
          return jsonResponse({
            data: {
              currentStep: 4,
              draft: completionDraft({ currentWeight: "82" }),
              updatedAt: accountUpdatedAt,
            },
            error: null,
          });
        }
        if (url.endsWith("/api/foods")) {
          return jsonResponse({ data: [], error: null });
        }
        return jsonResponse({ data: null, error: null });
      }),
    );

    render(<OnboardingFlow initialStep={4} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Current weight")).toHaveValue(
        expectedWeight,
      );
    });
  });

  it("does not autosave until the account draft has finished hydrating", async () => {
    let resolveHydration!: (response: Response) => void;
    const hydrationResponse = new Promise<Response>((resolve) => {
      resolveHydration = resolve;
    });
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/onboarding") && init?.method === "PATCH") {
          return Promise.resolve(
            jsonResponse({ data: { saved: true }, error: null }),
          );
        }
        if (url.endsWith("/api/onboarding")) return hydrationResponse;
        if (url.endsWith("/api/foods")) {
          return Promise.resolve(jsonResponse({ data: [], error: null }));
        }
        return Promise.resolve(
          jsonResponse(
            {
              data: null,
              error: { code: "NOT_FOUND", message: "Not found." },
            },
            404,
          ),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<OnboardingFlow initialStep={3} />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/onboarding");
    });
    await new Promise((resolve) => window.setTimeout(resolve, 550));
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/api/onboarding") &&
          init?.method === "PATCH",
      ),
    ).toBe(false);

    resolveHydration(
      jsonResponse({
        data: {
          currentStep: 4,
          draft: {
            currentWeight: "84",
            targetWeight: "76",
            unit: "kg",
          },
        },
        error: null,
      }),
    );

    await waitFor(
      () => {
        const patchCall = fetchMock.mock.calls.find(
          ([input, init]) =>
            String(input).endsWith("/api/onboarding") &&
            init?.method === "PATCH",
        );
        expect(patchCall).toBeDefined();
        expect(JSON.parse(String(patchCall?.[1]?.body)).draft).toEqual(
          expect.objectContaining({
            currentWeight: "84",
            targetWeight: "76",
            unit: "kg",
          }),
        );
      },
      { timeout: 1_500 },
    );
  });

  it("reviews meal warnings before moving forward and supports going back", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={3} />);

    await user.click(screen.getByRole("button", { name: /Continue/ }));
    const dialog = screen.getByRole("dialog", {
      name: "Review meal balance?",
    });
    expect(dialog).toHaveTextContent(
      "Breakfast is missing carbohydrate and protein.",
    );
    expect(dialog).toHaveTextContent(
      "Lunch is missing carbohydrate, protein and vegetable.",
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Review meals" }),
    );
    expect(
      screen.getByRole("heading", { name: "What works on your plate?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.click(
      screen.getByRole("button", { name: "Continue anyway" }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Set a direction, not a promise.",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect(
      screen.getByRole("heading", { name: "What works on your plate?" }),
    ).toBeInTheDocument();
  });

  it("lets a returning unverified user request a new code without registering again", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: true };
        }
        return { ok: false };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={2} />);

    const resend = screen.getByRole("button", { name: "Resend code" });
    expect(resend).toBeDisabled();

    await user.type(
      screen.getByRole("textbox", { name: "Account email" }),
      "returning@example.com",
    );
    expect(resend).toBeEnabled();
    await user.click(resend);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/resend",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "returning@example.com" }),
      }),
    );
    expect(
      screen.getByText(
        "A new verification code was requested. Check the latest email.",
        { selector: "[aria-live]" },
      ),
    ).toBeInTheDocument();
  });
});

describe("OnboardingFlow food preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockBackgroundRequests();
  });

  it("treats an empty saved-food response as a successful no-match search", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/onboarding") && init?.method === "PATCH") {
          return jsonResponse({ data: { saved: true }, error: null });
        }
        if (url.endsWith("/api/onboarding")) {
          return jsonResponse({
            data: { currentStep: null, draft: null, updatedAt: null },
            error: null,
          });
        }
        if (url.includes("/api/foods")) {
          return jsonResponse({ data: [], error: null });
        }
        return jsonResponse({ data: null, error: null });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={3} />);

    const search = screen.getByRole("textbox", {
      name: "Search foods and products",
    });
    await user.type(search, "no matching saved food");

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([input]) =>
            String(input).includes("/api/foods?limit=100&q="),
          ),
        ).toBe(true);
      },
      { timeout: 1_500 },
    );
    expect(screen.queryByText("SAVED_FOOD_SEARCH_FAILED")).not.toBeInTheDocument();
    expect(
      screen.getByText("No matching saved or source-reported food yet."),
    ).toBeInTheDocument();
  });

  it("filters foods and supports button and keyboard addition", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={3} />);
    const search = screen.getByRole("textbox", {
      name: "Search foods and products",
    });

    await user.type(search, "rolled oats");
    expect(
      screen.getByRole("heading", { name: "Rolled oats" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "White rice" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Add Rolled oats to breakfast",
      }),
    );
    expect(
      within(mealSection("Breakfast")).getByText("Rolled oats"),
    ).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "eggs");
    const addEggs = screen.getByRole("button", {
      name: "Add Eggs to breakfast",
    });
    addEggs.focus();
    await user.keyboard("{Enter}");
    expect(within(mealSection("Breakfast")).getByText("Eggs")).toBeInTheDocument();
    expect(
      screen.getByText("Eggs added to breakfast.", {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
  });

  it("shows private label foods but prevents adding them to plan preferences", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") return { ok: true };
        if (String(input).endsWith("/api/foods")) {
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  slug: "my-protein-drink-a1b2c3d4",
                  english_name: "My protein drink",
                  categories: [],
                  plan_eligible: false,
                },
              ],
            }),
          };
        }
        return { ok: false };
      }),
    );
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={3} />);

    expect(
      await screen.findByRole("heading", { name: "My protein drink" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Reference only\. Source and nutrition review must finish/i),
    ).toBeInTheDocument();

    const addToBreakfast = screen.getByRole("button", {
      name: "My protein drink needs review",
    });
    expect(addToBreakfast).toBeDisabled();
    expect(
      screen.getByRole("combobox", {
        name: "Destination for My protein drink",
      }),
    ).toBeDisabled();

    await user.click(addToBreakfast);
    expect(
      within(mealSection("Breakfast")).queryByText("My protein drink"),
    ).not.toBeInTheDocument();
  });

  it("supports accessible reordering and removal alternatives", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={3} />);

    await user.click(
      screen.getByRole("button", {
        name: "Add Rolled oats to breakfast",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add Eggs to breakfast" }),
    );
    const breakfast = mealSection("Breakfast");

    await user.click(
      within(breakfast).getByRole("button", { name: "Move Eggs up" }),
    );
    expect(
      screen.getByText("Eggs moved to position 1 in breakfast.", {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
    expect(
      within(breakfast).getByRole("button", { name: "Move Eggs up" }),
    ).toBeDisabled();

    await user.click(
      within(breakfast).getByRole("button", { name: "Remove Eggs" }),
    );
    expect(
      screen.getByText("Eggs removed from breakfast.", {
        selector: "[aria-live]",
      }),
    ).toBeInTheDocument();
    expect(within(breakfast).queryByText("Eggs")).not.toBeInTheDocument();
  });
});

describe("OnboardingFlow completion", () => {
  beforeEach(() => {
    window.localStorage.clear();
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
  });

  it("locks review navigation while the captured completion draft is saving", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(completionDraft()),
    );
    let resolveCompletion!: (response: Response) => void;
    const completionResponse = new Promise<Response>((resolve) => {
      resolveCompletion = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/onboarding") && init?.method === "PUT") {
          return completionResponse;
        }
        if (url.endsWith("/api/onboarding") && init?.method === "PATCH") {
          return Promise.resolve(
            jsonResponse({ data: { saved: true }, error: null }),
          );
        }
        if (url.endsWith("/api/onboarding")) {
          return Promise.resolve(
            jsonResponse({
              data: { currentStep: null, draft: null, updatedAt: null },
              error: null,
            }),
          );
        }
        if (url.endsWith("/api/foods")) {
          return Promise.resolve(
            jsonResponse({
              data: [
                {
                  slug: "rolled-oats",
                  english_name: "Rolled oats",
                  categories: ["Carbohydrate", "Protein"],
                  plan_eligible: true,
                },
                {
                  slug: "chicken-breast",
                  english_name: "Chicken breast",
                  categories: ["Protein"],
                  plan_eligible: true,
                },
                {
                  slug: "broccoli",
                  english_name: "Broccoli",
                  categories: ["Vegetable"],
                  plan_eligible: true,
                },
              ],
              error: null,
            }),
          );
        }
        return Promise.resolve(jsonResponse({ data: null, error: null }));
      }),
    );
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={6} />);

    await screen.findByText("fat loss · 210 lb → 200 lb · 2026-08-31");
    const confirmation = screen.getByRole("checkbox", {
      name: "I have reviewed this information and want to complete onboarding.",
    });
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: "Go to Today" }));

    await screen.findByRole("button", { name: /Saving profile/ });
    expect(confirmation).toBeDisabled();
    for (const editButton of screen.getAllByRole("button", { name: "Edit" })) {
      expect(editButton).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: /Back/ })).toBeDisabled();

    resolveCompletion(
      jsonResponse({
        data: { completed: true, goalId: "goal-1" },
        error: null,
      }),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/today"));
  });

  it("shows a safe API error message when final profile persistence fails", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(completionDraft()),
    );
    const safeMessage =
      "One or more selected foods are no longer available.";
    mockCompletionRequests({
      putResponse: jsonResponse(
        {
          data: null,
          error: {
            code: "FOOD_SELECTION_CHANGED",
            message: safeMessage,
            details: "Edit Meals, replace the affected foods, and submit again.",
            retryable: false,
            action: { kind: "edit", label: "Review meal selections" },
          },
        },
        409,
      ),
    });
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={6} />);

    await screen.findByText("fat loss · 210 lb → 200 lb · 2026-08-31");
    await user.click(
      screen.getByRole("checkbox", {
        name: "I have reviewed this information and want to complete onboarding.",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /Generate my plan/ }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Review your meal selections.");
    expect(alert).toHaveTextContent(safeMessage);
    expect(alert).toHaveTextContent("Error code: FOOD_SELECTION_CHANGED");
    expect(alert).toHaveTextContent(
      "Retry available: not until the issue is resolved",
    );
    expect(
      screen.getByRole("button", { name: "Review meal selections" }),
    ).toBeVisible();
    expect(alert).toHaveTextContent(
      "Edit Meals, replace the affected foods, and submit again.",
    );
    expect(
      screen.queryByText(
        "We could not save the final step. Your information is still here; please try again.",
      ),
    ).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalledWith("/plan");
  });

  it("explains how to finish a pending local database update", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(completionDraft()),
    );
    mockCompletionRequests({
      putResponse: jsonResponse(
        {
          data: null,
          error: {
            code: "ONBOARDING_DATABASE_OUTDATED",
            message:
              "Restart with npm run dev:all so the local database update can finish, then try again.",
            details:
              "In local development, restart the services and wait for readiness.",
            retryable: true,
            action: {
              kind: "restart",
              label: "Restart services, then retry",
            },
          },
        },
        503,
      ),
    });
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={6} />);

    await screen.findByText("fat loss · 210 lb → 200 lb · 2026-08-31");
    await user.click(
      screen.getByRole("checkbox", {
        name: "I have reviewed this information and want to complete onboarding.",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Go to Today" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The local database needs to finish updating.",
    );
    expect(alert).toHaveTextContent("Restart with npm run dev:all");
    expect(alert).toHaveTextContent(
      "Error code: ONBOARDING_DATABASE_OUTDATED",
    );
    expect(alert).toHaveTextContent("Next step: Restart services, then retry.");
    expect(router.push).not.toHaveBeenCalledWith("/today");
  });

  it("conveys an imperial height through successful Step 6 completion", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(completionDraft({ height: "5 ft 10 in" })),
    );
    const fetchMock = mockCompletionRequests();
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={6} />);

    await screen.findByText("fat loss · 210 lb → 200 lb · 2026-08-31");
    await user.click(
      screen.getByRole("checkbox", {
        name: "I have reviewed this information and want to complete onboarding.",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Go to Today" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/today"));
    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/api/onboarding") && init?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual(
      expect.objectContaining({
        height: "5 ft 10 in",
        unit: "lb",
      }),
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).not.toHaveProperty(
      "currentWeightKg",
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).not.toHaveProperty(
      "targetWeightKg",
    );
  });

  it("normalizes a restored legacy vegetable powder slug before completion", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(
        completionDraft({
          meals: {
            breakfast: ["rolled-oats"],
            lunch: ["chicken-breast"],
            dinner: ["vegetable-vitamin-powder"],
          },
        }),
      ),
    );
    const fetchMock = mockCompletionRequests({
      foods: [
        {
          slug: "rolled-oats",
          english_name: "Rolled oats",
          categories: ["Carbohydrate", "Protein"],
          plan_eligible: true,
        },
        {
          slug: "chicken-breast",
          english_name: "Chicken breast",
          categories: ["Protein"],
          plan_eligible: true,
        },
        {
          slug: "vegetable-or-vitamin-powder",
          english_name: "Vegetable or vitamin powder",
          categories: ["Supplement"],
          plan_eligible: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={6} />);

    await screen.findByText("fat loss · 210 lb → 200 lb · 2026-08-31");
    await user.click(
      screen.getByRole("checkbox", {
        name: "I have reviewed this information and want to complete onboarding.",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Go to Today" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/today"));
    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/api/onboarding") && init?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(JSON.parse(String(putCall?.[1]?.body)).meals.dinner).toEqual([
      "vegetable-or-vitamin-powder",
    ]);
  });

  it("rechecks an in-progress generation with the same idempotency key", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(completionDraft()),
    );
    const fetchMock = mockCompletionRequests({
      generationResponses: [
        jsonResponse(
          {
            data: {
              requestId: "request-1",
              planId: null,
              status: "processing",
              replayed: true,
            },
            error: null,
          },
          202,
        ),
        jsonResponse({
          data: {
            requestId: "request-1",
            planId: "plan-1",
            status: "succeeded",
            replayed: true,
          },
          error: null,
        }),
      ],
    });
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={6} />);

    await screen.findByText("fat loss · 210 lb → 200 lb · 2026-08-31");
    expect(
      screen.getByText(
        /Exact verified food names and catalog IDs, including brand, product, and flavor names/,
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", {
        name: "I have reviewed this information and want to complete onboarding.",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /Generate my plan/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your plan is still being generated.",
    );
    expect(router.push).not.toHaveBeenCalledWith("/plan");

    await user.click(
      screen.getByRole("button", { name: /Generate my plan/ }),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/plan"));

    const generationCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).endsWith("/api/plans/generate") &&
        init?.method === "POST",
    );
    expect(generationCalls).toHaveLength(2);
    const firstKey = JSON.parse(String(generationCalls[0]?.[1]?.body))
      .idempotencyKey;
    const secondKey = JSON.parse(String(generationCalls[1]?.[1]?.body))
      .idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it("uses a new idempotency key after a terminal generation failure", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(completionDraft()),
    );
    const fetchMock = mockCompletionRequests({
      generationResponses: [
        jsonResponse(
          {
            data: null,
            error: {
              code: "PLAN_REQUEST_FAILED",
              message:
                "That plan request did not finish. Start a new generation request.",
            },
          },
          409,
        ),
        jsonResponse(
          {
            data: {
              requestId: "request-2",
              planId: "plan-2",
              status: "generated",
            },
            error: null,
          },
          201,
        ),
      ],
    });
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={6} />);

    await screen.findByText("fat loss · 210 lb → 200 lb · 2026-08-31");
    await user.click(
      screen.getByRole("checkbox", {
        name: "I have reviewed this information and want to complete onboarding.",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /Generate my plan/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Start a new generation request.",
    );

    await user.click(
      screen.getByRole("button", { name: /Generate my plan/ }),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/plan"));

    const generationCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).endsWith("/api/plans/generate") &&
        init?.method === "POST",
    );
    expect(generationCalls).toHaveLength(2);
    const firstKey = JSON.parse(String(generationCalls[0]?.[1]?.body))
      .idempotencyKey;
    const secondKey = JSON.parse(String(generationCalls[1]?.[1]?.body))
      .idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });
});

describe("OnboardingFlow error routing and draft resilience", () => {
  beforeEach(() => {
    window.localStorage.clear();
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
  });

  it.each([
    {
      code: "INVALID_CURRENT_WEIGHT",
      message: "Enter a valid current weight.",
      actionLabel: "Edit current weight",
      fieldLabel: "Current weight",
      targetSelector: "#onboarding-current-weight",
      heading: "Set a direction, not a promise.",
      foodWidth: false,
    },
    {
      code: "INVALID_TARGET_WEIGHT",
      message: "Enter a valid target weight.",
      actionLabel: "Edit target weight",
      fieldLabel: "Target weight",
      targetSelector: "#onboarding-target-weight",
      heading: "Set a direction, not a promise.",
      foodWidth: false,
    },
    {
      code: "TARGET_DATE_REQUIRED",
      message: "Choose a target date.",
      actionLabel: "Choose target date",
      fieldLabel: "Target date",
      targetSelector: "#onboarding-target-date",
      heading: "Set a direction, not a promise.",
      foodWidth: false,
    },
    {
      code: "INVALID_TARGET_DATE",
      message: "Choose today or a future date.",
      actionLabel: "Edit target date",
      fieldLabel: "Target date",
      targetSelector: "#onboarding-target-date",
      heading: "Set a direction, not a promise.",
      foodWidth: false,
    },
    {
      code: "INVALID_TIME_ZONE",
      message: "Choose a supported time zone.",
      actionLabel: "Choose time zone",
      fieldLabel: "IANA time zone",
      targetSelector: "#onboarding-time-zone",
      heading: "Add the context your plan needs.",
      foodWidth: false,
    },
    {
      code: "TOO_MANY_RESTRICTIONS",
      message: "Use no more than 50 restrictions.",
      actionLabel: "Review restrictions",
      fieldLabel: "Dietary restrictions",
      targetSelector: "#onboarding-restrictions",
      heading: "Add the context your plan needs.",
      foodWidth: false,
    },
    {
      code: "MISSING_HEIGHT",
      message: "Choose your height.",
      actionLabel: "Choose height",
      fieldLabel: "height list",
      targetSelector: ".onboarding-height-field select",
      heading: "Add the context your plan needs.",
      foodWidth: false,
      href: "/onboarding?step=5",
    },
    {
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "Verify your email first.",
      actionLabel: "Verify email",
      fieldLabel: "verification code",
      targetSelector: "#onboarding-verification-code-1",
      heading: "Check your email.",
      foodWidth: false,
      href: "/onboarding?step=2",
    },
    {
      code: "INVALID_ONBOARDING",
      message: "Review the required onboarding information.",
      actionLabel: "Review onboarding",
      fieldLabel: "profile step heading",
      targetSelector: "#onboarding-step-heading",
      heading: "Add the context your plan needs.",
      foodWidth: false,
    },
    {
      code: "FOOD_SELECTION_CHANGED",
      message: "A selected food needs review.",
      actionLabel: "Review meal selections",
      fieldLabel: "Search foods and products",
      targetSelector: ".food-picker input",
      heading: "What works on your plate?",
      foodWidth: true,
    },
  ])(
    "routes $code to its step and focuses $fieldLabel",
    async ({
      code,
      message,
      actionLabel,
      fieldLabel,
      targetSelector,
      heading,
      foodWidth,
      href,
    }) => {
      window.localStorage.setItem(
        ONBOARDING_DRAFT_KEY,
        JSON.stringify(completionDraft()),
      );
      mockCompletionRequests({
        putResponse: jsonResponse(
          {
            data: null,
            error: {
              code,
              message,
              details: "Correct this field and submit again.",
              retryable: false,
              action: href
                ? { kind: "navigate", label: actionLabel, href }
                : { kind: "edit", label: actionLabel },
            },
          },
          422,
        ),
      });
      const user = userEvent.setup();
      render(<OnboardingFlow initialStep={6} />);

      await screen.findByText("fat loss · 210 lb → 200 lb · 2026-08-31");
      await user.click(
        screen.getByRole("checkbox", {
          name: "I have reviewed this information and want to complete onboarding.",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Go to Today" }));

      const alert = await screen.findByRole("alert");
      const errorWidth = alert.parentElement;
      expect(errorWidth).toHaveClass("onboarding-content");
      if (foodWidth) {
        expect(errorWidth).toHaveClass("onboarding-content-food");
      } else {
        expect(errorWidth).not.toHaveClass("onboarding-content-food");
      }
      await user.click(screen.getByRole("button", { name: actionLabel }));

      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      const target = document.querySelector<HTMLElement>(targetSelector);
      expect(target, `Missing focus target for ${fieldLabel}`).not.toBeNull();
      await waitFor(() => {
        expect(target).toHaveFocus();
      });
    },
  );

  it("uses one visible assertive error and keeps the routine live region polite", async () => {
    mockCompletionRequests();
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={4} />);

    await user.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter your current weight.",
    );
    const routineStatus = document.querySelector("p.sr-only[role='status']");
    expect(routineStatus).toHaveAttribute("aria-live", "polite");
    expect(routineStatus).toHaveTextContent("");
  });

  it("focuses the new heading after ordinary forward navigation", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(
        completionDraft({
          height: "",
          activity: "moderate",
          trainingDays: "3",
        }),
      ),
    );
    mockCompletionRequests();
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={4} />);

    await screen.findByDisplayValue("210");
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    const heading = screen.getByRole("heading", {
      name: "Add the context your plan needs.",
    });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("shows a server draft-load failure while retaining the browser draft", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(completionDraft({ currentWeight: "82.5" })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/onboarding") && !init?.method) {
          return jsonResponse(
            {
              data: null,
              error: {
                code: "DRAFT_LOAD_FAILED",
                message: "Saved account progress could not be loaded.",
                details: "Continue with the browser copy and retry account sync.",
                retryable: true,
                action: { kind: "retry", label: "Try again" },
              },
            },
            503,
          );
        }
        if (init?.method === "PATCH") {
          return new Promise<Response>(() => undefined);
        }
        if (String(input).endsWith("/api/foods")) {
          return jsonResponse({ data: [], error: null });
        }
        return jsonResponse({ data: null, error: null });
      }),
    );

    render(<OnboardingFlow initialStep={4} />);

    const noticeHeading = await screen.findByText(
      "Account progress could not be loaded.",
    );
    const notice = noticeHeading.closest("[role='status']");
    expect(notice).toHaveTextContent("Sync code: DRAFT_LOAD_FAILED");
    expect(screen.getByText("Saved in this browser only")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Current weight")).toHaveValue("82.5");
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(ONBOARDING_DRAFT_KEY) ?? "{}",
      ),
    ).toEqual(
      expect.objectContaining({
        version: 1,
        draft: expect.objectContaining({ currentWeight: "82.5" }),
      }),
    );
  });

  it("shows browser-only autosave status once and clears it after a successful retry", async () => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify(completionDraft()),
    );
    let patchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/onboarding") && init?.method === "PATCH") {
          patchCount += 1;
          return patchCount === 1
            ? jsonResponse(
                {
                  data: null,
                  error: {
                    code: "DRAFT_SAVE_FAILED",
                    message: "Account autosave is temporarily unavailable.",
                    details: "The browser copy is unchanged.",
                    retryable: true,
                    action: { kind: "retry", label: "Try again" },
                  },
                },
                503,
              )
            : jsonResponse({ data: { saved: true }, error: null });
        }
        if (url.endsWith("/api/onboarding")) {
          return jsonResponse({ data: { currentStep: null, draft: null }, error: null });
        }
        if (url.endsWith("/api/foods")) {
          return jsonResponse({ data: [], error: null });
        }
        return jsonResponse({ data: null, error: null });
      }),
    );
    const user = userEvent.setup();
    render(<OnboardingFlow initialStep={4} />);

    expect(
      await screen.findByText("Sync code: DRAFT_SAVE_FAILED", {}, {
        timeout: 1_500,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Saved in this browser only", { selector: ".date-label" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("Sync code: DRAFT_SAVE_FAILED")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Try account sync" }));

    await waitFor(() => {
      expect(
        screen.getByText("Saved in this browser and your account"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Sync code: DRAFT_SAVE_FAILED"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Onboarding progress is saved to your account again.", {
        selector: "[role='status']",
      }),
    ).toBeInTheDocument();
  });
});
