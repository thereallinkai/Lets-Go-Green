import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoHighImpactViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const highImpactViolations = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );

  expect(
    highImpactViolations,
    highImpactViolations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`,
      )
      .join("\n"),
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, context: string) {
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(horizontalOverflow, `horizontal overflow: ${context}`).toBeLessThanOrEqual(
    1,
  );
}

async function waitForProductTourController(page: Page) {
  await expect(
    page.locator(
      '[data-product-tour-controller][data-hydrated="true"]',
    ),
  ).toBeAttached();
}

test("public layout is usable and free of high-impact axe violations at required widths", async ({
  page,
}) => {
  for (const width of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();
    await expectNoHorizontalOverflow(page, `public page at ${width}px`);
    await expectNoHighImpactViolations(page);
  }
});

test("registration and onboarding controls reflow at required widths", async ({
  page,
}) => {
  test.setTimeout(180_000);
  // This test checks independent deep links. Clear saved demo progress before
  // any application script can restore a step from the preceding navigation.
  await page.addInitScript(() => {
    window.localStorage.removeItem("lets-go-green-onboarding-draft:demo");
  });
  for (const width of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1_000 });

    await page.goto("/register");
    await expect(
      page.getByRole("heading", { name: "Let's start with you." }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, `registration at ${width}px`);

    await page.goto("/onboarding?step=3");
    await expect(
      page.getByRole("heading", { name: "What works on your plate?" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-layout="overflow-safe-food-search"]'),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, `food onboarding at ${width}px`);

    await page.goto("/onboarding?step=5");
    await expect(
      page.getByRole("heading", {
        name: "Add the context your plan needs.",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Choose centimeters" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, `height onboarding at ${width}px`);

    if (width === 375 || width === 1440) {
      await expectNoHighImpactViolations(page);
    }
  }
});

test("populated Step 3 keeps one explicit meal destination and a bounded result stack", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("lets-go-green-onboarding-draft:demo");
  });

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 1_000 });
    await page.goto("/onboarding?step=3");

    const destination = page.getByRole("combobox", {
      name: "Meal destination for saved foods",
    });
    await expect(destination).toHaveValue("");
    await expect(
      page.getByRole("button", {
        name: "Choose a meal before adding Apples",
      }),
    ).toBeDisabled();

    const results = page.locator(
      '[aria-label="Food search results"] article',
    );
    await expect(results).toHaveCount(6);
    const showAll = page.getByRole("button", {
      name: /^Show all \d+ remaining matches?$/,
    });
    await expect(showAll).toBeVisible();
    await showAll.click();
    await expect(results).toHaveCount(28);

    await destination.selectOption("lunch");
    await expect(
      page.getByRole("button", { name: "Add Rolled oats to lunch" }),
    ).toBeEnabled();
    await expectNoHorizontalOverflow(page, `populated food onboarding at ${width}px`);
    await expectNoHighImpactViolations(page);
  }
});

test("protected mock pages have no serious or critical axe violations", async ({
  page,
}) => {
  // This test intentionally cold-compiles and scans six routes in CI.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const path of [
    "/today",
    "/plan",
    "/calendar",
    "/progress",
    "/profile",
    "/settings",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await expectNoHighImpactViolations(page);
  }
});

test("Today, Calendar, Profile, and the tutorial reflow at required widths", async ({
  page,
}) => {
  // Sixteen route/viewport combinations plus four axe scans can exceed
  // Playwright's single-test default while the CI development server compiles.
  test.setTimeout(90_000);
  for (const width of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });

    await page.goto("/today");
    await expect(
      page.getByRole("heading", { level: 1, name: "Good morning, Jamie." }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, `Today at ${width}px`);

    await page.goto("/calendar");
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar" }),
    ).toBeVisible();
    await expect(page.locator(".calendar-card")).toBeVisible();
    await expectNoHorizontalOverflow(page, `Calendar at ${width}px`);

    await page.goto("/profile");
    await expect(
      page.getByRole("heading", { level: 1, name: "Jamie Rivera" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, `Profile at ${width}px`);

    await waitForProductTourController(page);
    await page.getByRole("link", { name: "Replay tutorial" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".tour-progress span")).toHaveCount(7);
    await expectNoHorizontalOverflow(page, `tutorial at ${width}px`);
    await expectNoHighImpactViolations(page);
    await dialog
      .getByRole("button", { name: "Skip tutorial for now" })
      .click();
  }
});

test("reduced-motion preference removes nonessential page and control motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/today");

  const motion = await page.evaluate(() => {
    const pageTransition = document.querySelector(".page-transition");
    const button = document.querySelector(".button");
    if (
      !(pageTransition instanceof HTMLElement) ||
      !(button instanceof HTMLElement)
    ) {
      throw new Error("Motion test targets were not rendered.");
    }

    const pageStyle = getComputedStyle(pageTransition);
    const buttonStyle = getComputedStyle(button);
    return {
      animationDuration: Number.parseFloat(pageStyle.animationDuration),
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      transitionDuration: Math.max(
        ...buttonStyle.transitionDuration
          .split(",")
          .map((duration) => Number.parseFloat(duration)),
      ),
    };
  });

  expect(motion.animationDuration).toBeLessThan(0.001);
  expect(motion.transitionDuration).toBeLessThan(0.001);
  expect(motion.scrollBehavior).toBe("auto");
});

test("fine-pointer controls grow and highlight without changing layout", async ({
  page,
}) => {
  await page.goto("/login");
  const button = page.getByRole("button", { name: "Log in" });
  const initialLayout = await button.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));

  await button.hover();
  await page.waitForTimeout(220);
  const hoverScale = await button.evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
  });

  await page.mouse.down();
  await page.waitForTimeout(180);
  const pressed = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      scale: style.transform === "none"
        ? 1
        : new DOMMatrixReadOnly(style.transform).a,
      boxShadow: style.boxShadow,
    };
  });
  const pressedLayout = await button.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  await page.mouse.up();

  expect(hoverScale).toBeGreaterThan(1.01);
  expect(pressed.scale).toBeGreaterThan(hoverScale);
  expect(pressed.boxShadow).not.toBe("none");
  expect(pressedLayout).toEqual(initialLayout);

  await page.goto("/");
  const sharedButton = page
    .getByRole("main")
    .getByRole("link", { name: "Create account" })
    .first();
  await sharedButton.hover();
  await page.waitForTimeout(220);
  await page.mouse.down();
  await page.waitForTimeout(180);
  const sharedPressedScale = await sharedButton.evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
  });
  await page.mouse.up();

  expect(sharedPressedScale).toBeGreaterThan(1.02);
  expect(sharedPressedScale).toBeLessThan(1.04);
});

test("static information cards do not advertise a click action on hover", async ({
  page,
}) => {
  await page.goto("/today");
  const mealRow = page.locator(".meal-row").first();
  await page.waitForTimeout(550);
  await mealRow.hover({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(220);

  const state = await mealRow.evaluate((element) => {
    const style = getComputedStyle(element);
    return { cursor: style.cursor, transform: style.transform };
  });
  expect(state.cursor).not.toBe("pointer");
  expect(state.transform).toBe("none");
});

test("tutorial actions remain reachable in a short mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 420 });
  await page.goto("/profile");
  await waitForProductTourController(page);
  await page.getByRole("link", { name: "Replay tutorial" }).click();

  const dialog = page.getByRole("dialog");
  for (let step = 1; step < 7; step += 1) {
    await dialog.getByRole("button", { name: /Next/ }).click();
  }
  await expect(
    dialog.getByRole("button", { name: /Finish tutorial/ }),
  ).toBeInViewport();
  await expectNoHorizontalOverflow(page, "tutorial at 375x420");
});
