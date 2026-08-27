import { expect, test } from "@playwright/test";

test("development Today check-in sends the desired final state", async ({
  page,
}) => {
  let submittedState: unknown;
  await page.route("**/api/checkins/*", async (route) => {
    submittedState = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { saved: true }, error: null }),
    });
  });

  await page.goto("/today");
  await expect(
    page.getByRole("heading", { level: 1, name: "Good morning, Jamie." }),
  ).toBeVisible();
  const dinnerRow = page.locator(".meal-row").filter({ hasText: "Dinner" });
  const completionButton = dinnerRow.getByRole("button", {
    name: "Mark Dinner completed",
  });
  await expect(completionButton).toHaveAttribute("aria-pressed", "false");
  await page.waitForLoadState("networkidle");

  await completionButton.click();
  const completedButton = dinnerRow.getByRole("button", {
    name: "Return Dinner to not marked",
  });
  await expect(completedButton).toHaveAttribute("aria-pressed", "true");
  expect(submittedState).toEqual({
    kind: "meal_status",
    mealType: "dinner",
    status: "completed",
    skipReason: null,
  });
});

test("Today meal controls remain readable and reachable at phone and tablet widths", async ({
  page,
}) => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/today");

    const mealRows = page.locator(".meal-row");
    await expect(mealRows).toHaveCount(6);
    const preferencesLink = page.getByRole("link", {
      name: "Edit meal preferences",
    });
    await expect(preferencesLink).toBeVisible();
    await expect(preferencesLink).toHaveAttribute(
      "href",
      "/settings#preferences",
    );
    const preferencesLinkBox = await preferencesLink.boundingBox();
    expect(preferencesLinkBox).not.toBeNull();
    expect(preferencesLinkBox!.height).toBeGreaterThanOrEqual(44);
    for (const label of [
      "Breakfast",
      "Morning snack",
      "Lunch",
      "Afternoon snack",
      "Dinner",
      "Evening snack",
    ]) {
      const row = mealRows.filter({ hasText: label }).first();
      const completion = row.getByRole("button", {
        name: new RegExp(`^(?:Mark ${label} completed|Return ${label} to not marked)$`),
      });
      const box = await completion.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      await expect(row.getByText(label, { exact: true })).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("Today remains readable at 200% text size", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/today");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });

  await expect(page.locator(".meal-row")).toHaveCount(6);
  await expect(
    page.getByRole("link", { name: "Edit meal preferences" }),
  ).toBeVisible();
  for (const label of [
    "Breakfast",
    "Morning snack",
    "Lunch",
    "Afternoon snack",
    "Dinner",
    "Evening snack",
  ]) {
    const row = page.locator(".meal-row").filter({ hasText: label }).first();
    await expect(row.getByText(label, { exact: true })).toBeVisible();
    const completion = row.getByRole("button", {
      name: new RegExp(
        `^(?:Mark ${label} completed|Return ${label} to not marked)$`,
      ),
    });
    await expect(completion).toBeVisible();
  }
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    elements: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.right > window.innerWidth + 1 || box.left < -1;
      })
      .slice(0, 12)
      .map((element) => ({
        className: element.className,
        tagName: element.tagName,
        text: element.textContent?.trim().slice(0, 80),
        width: element.getBoundingClientRect().width,
      })),
  }));
  expect(overflow).toEqual({
    documentWidth: overflow.viewportWidth,
    viewportWidth: overflow.viewportWidth,
    elements: [],
  });
});

test("Today completion pill honors dark appearance and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/today");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });

  const dinnerRow = page.locator(".meal-row").filter({ hasText: "Dinner" });
  const completion = dinnerRow.getByRole("button", {
    name: "Mark Dinner completed",
  });
  await expect(completion).toBeVisible();
  const style = await completion.evaluate((element) => {
    const computed = window.getComputedStyle(element);
    return {
      backgroundImage: computed.backgroundImage,
      color: computed.color,
      transitionDuration: computed.transitionDuration,
    };
  });
  expect(style.backgroundImage).not.toBe("none");
  expect(style.color).not.toBe("rgb(49, 87, 66)");
  const transitionMilliseconds = style.transitionDuration
    .split(",")
    .map((duration) => {
      const normalized = duration.trim();
      const value = Number.parseFloat(normalized);
      return normalized.endsWith("ms") ? value : value * 1_000;
    });
  expect(transitionMilliseconds.every((duration) => duration <= 1)).toBe(true);
});

test("mock Plan generation preserves the accepted version until review", async ({
  page,
}) => {
  let acceptedPlanId: string | null = null;
  await page.route("**/api/plans/generate", async (route) => {
    const body = route.request().postDataJSON() as {
      idempotencyKey?: string;
    };
    expect(body.idempotencyKey).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { status: "draft", planId: "mock-plan-draft" },
        error: null,
      }),
    });
  });
  await page.route("**/api/plans/*/accept", async (route) => {
    acceptedPlanId = route.request().url().split("/").at(-2) ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { planId: acceptedPlanId, status: "accepted" },
        error: null,
      }),
    });
  });

  await page.goto("/plan");
  await expect(
    page.getByRole("heading", { level: 1, name: "My Plan" }),
  ).toBeVisible();
  await expect(page.getByText("Plan version 2 · Accepted July 20")).toBeVisible();

  const generateButton = page.getByRole("button", {
    name: "Generate new draft",
  });
  await page.waitForLoadState("networkidle");
  await generateButton.click();
  await expect(
    page.getByText(
      "A new draft is ready for review. Version 2 remains accepted until you explicitly replace it.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep accepted plan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept this version" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept this version" }).click();
  await expect(
    page.locator("[aria-live]").filter({
      hasText: "Draft accepted as the current plan.",
    }),
  ).toHaveCount(1);
  expect(acceptedPlanId).toBe("mock-plan-draft");
});

test("mobile primary navigation reaches protected plan pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/today");

  const mobileNavigation = page.locator("nav.mobile-nav");
  await expect(mobileNavigation).toBeVisible();
  await expect(page.locator("aside.sidebar")).toBeHidden();
  await mobileNavigation.getByRole("link", { name: "My Plan" }).click();

  await expect(page).toHaveURL(/\/plan$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "My Plan" }),
  ).toBeVisible();
  await expect(
    mobileNavigation.getByRole("link", { name: "My Plan" }),
  ).toHaveAttribute("aria-current", "page");
});
