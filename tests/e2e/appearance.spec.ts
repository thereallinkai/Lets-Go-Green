import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const storageKey = "lets-go-green-appearance";

async function expectNoHighImpactViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const highImpactViolations = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );

  expect(
    highImpactViolations,
    highImpactViolations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join("\n"),
  ).toEqual([]);
}

test("System follows live color-scheme changes and explicit choices persist", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/register");

  await expect(page.locator("html")).toHaveAttribute("data-appearance", "system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
    "content",
    "#07120c",
  );

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(
    "dark",
  );

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();

  await page.getByRole("radio", { name: "System" }).check();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("dark appearance remains accessible across public, auth, onboarding, and app surfaces", async ({
  page,
}) => {
  // This cold-compiles five routes and runs five complete axe scans in CI.
  test.setTimeout(180_000);
  await page.addInitScript((key) => localStorage.setItem(key, "dark"), storageKey);

  for (const path of [
    "/",
    "/register",
    "/onboarding?step=2",
    "/onboarding?step=3",
    "/today",
    "/settings",
  ]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("main")).toBeVisible();
    await expectNoHighImpactViolations(page);
  }

  await expect(page.getByRole("group", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
});
