import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductTour } from "@/components/product-tour";
import {
  ProfileView,
  type ProfileViewData,
} from "@/components/profile-view";
import {
  CURRENT_PRODUCT_TOUR_VERSION,
  PRODUCT_TOUR_OPEN_EVENT,
  PRODUCT_TOUR_REPLAY_HASH,
  PRODUCT_TOUR_REPLAY_REQUEST_KEY,
  PRODUCT_TOUR_STEPS,
} from "@/src/lib/product-tour";

const profileData: ProfileViewData = {
  mode: "authenticated",
  account: {
    email: "member@example.com",
    createdAt: "2026-07-24T12:00:00Z",
  },
  profile: {
    fullName: "Morgan Green",
    dateOfBirth: "1997-04-12",
    age: 29,
    gender: "prefer_not_to_say",
    heightCm: 170,
    preferredWeightUnit: "kg",
    timeZone: "America/New_York",
    activityLevel: "moderately_active",
    trainingDaysPerWeek: 3,
    allergies: [],
    dietaryRestrictions: ["Vegetarian"],
    dislikedFoods: [],
    hasSafetyContext: true,
    onboardingCompletedAt: "2026-07-24T12:00:00Z",
  },
  goal: {
    goalType: "maintenance",
    targetWeightKg: 70,
    targetDate: "2026-10-16",
  },
  latestWeightKg: 70.5,
  mealPreferenceCount: 12,
  preferredFoods: ["Rolled oats", "Double rich chocolate whey"],
};

describe("ProductTour", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              saved: true,
              persisted: true,
              version: CURRENT_PRODUCT_TOUR_VERSION,
            },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  it("walks through every step and persists completion", async () => {
    const user = userEvent.setup();
    render(<ProductTour initialOpen />);

    expect(
      await screen.findByRole("dialog", {
        name: "A greener, calmer way to plan",
      }),
    ).toBeInTheDocument();

    for (let index = 1; index < PRODUCT_TOUR_STEPS.length; index += 1) {
      await user.click(screen.getByRole("button", { name: /Next/ }));
    }
    expect(
      screen.getByRole("heading", {
        name: "Your preferences, privacy, and controls",
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Finish tutorial/ }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/profile/tutorial",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ version: CURRENT_PRODUCT_TOUR_VERSION }),
      }),
    );
  });

  it("can be replayed after it was skipped for the session", async () => {
    const user = userEvent.setup();
    render(<ProductTour initialOpen />);

    await screen.findByRole("dialog");
    await user.click(
      screen.getByRole("button", { name: "Skip tutorial for now" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    window.dispatchEvent(new Event(PRODUCT_TOUR_OPEN_EVENT));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens from the native hash fallback before the profile control hydrates", async () => {
    render(<ProductTour />);
    window.history.replaceState(null, "", `/profile${PRODUCT_TOUR_REPLAY_HASH}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });
});

describe("ProfileView", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/profile");
  });

  it("shows account context, protects raw safety text, and labels external shopping", () => {
    render(<ProfileView data={profileData} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Morgan Green" }),
    ).toBeInTheDocument();
    const personalDetails = screen.getByRole("region", {
      name: "Personal details",
    });
    expect(personalDetails).toHaveTextContent(
      "Confirmed date of birth is read-only.",
    );
    expect(personalDetails).toHaveTextContent("Date of birthApril 12, 1997");
    expect(personalDetails).toHaveTextContent("Current age29");
    expect(
      screen.getByText(
        "Optional safety context is on file. Its private text is not repeated on this overview.",
      ),
    ).toBeInTheDocument();
    const groceryLink = screen.getByRole("link", { name: /Grocery stores/ });
    expect(groceryLink).toHaveAttribute("target", "_blank");
    expect(groceryLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(groceryLink).toHaveAttribute(
      "href",
      expect.stringContaining("google.com/maps/search"),
    );
    expect(
      screen.getByText(/does not receive your location or these results/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Double rich chocolate whey/i }),
    ).toHaveAttribute("href", expect.stringContaining("google.com/maps/search"));
    expect(
      screen.getByRole("link", { name: "Edit meal preferences" }),
    ).toHaveAttribute("href", "/settings#preferences");
  });

  it("queues tutorial replay when the tour listener has not mounted yet", async () => {
    const user = userEvent.setup();
    render(<ProfileView data={profileData} />);

    await user.click(
      screen.getByRole("link", { name: "Replay tutorial" }),
    );
    expect(window.sessionStorage.getItem(PRODUCT_TOUR_REPLAY_REQUEST_KEY)).toBe(
      "true",
    );
    expect(window.location.hash).toBe(PRODUCT_TOUR_REPLAY_HASH);

    render(<ProductTour />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      window.sessionStorage.getItem(PRODUCT_TOUR_REPLAY_REQUEST_KEY),
    ).toBeNull();
  });
});
