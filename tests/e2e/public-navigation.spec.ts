import { expect, test } from "@playwright/test";

test("landing page provides working account and legal navigation", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Plan meals. Notice patterns. Adjust with care.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Public navigation" }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Public navigation" })
    .getByRole("link", { name: "Create account" })
    .click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(
    page.getByRole("heading", { name: "Let's start with you." }),
  ).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Terms", exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Terms of Use" }),
  ).toBeVisible();

  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { level: 1, name: "Privacy Notice" }),
  ).toBeVisible();
});

test("registration confirms the derived age before creating the account", async ({
  page,
}) => {
  let registrationRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/auth/register"
    ) {
      registrationRequests += 1;
    }
  });

  await page.goto("/register");
  await page.getByLabel("Full name").fill("Taylor Green");
  await page.getByLabel("Gender").selectOption("prefer_not_to_say");
  await page.getByLabel("Date of birth").fill("2000-01-01");
  await page.getByLabel("Email").fill("taylor@example.test");
  await page.getByLabel("Password", { exact: true }).fill("a secure password");
  await page.getByLabel("Confirm password").fill("a secure password");
  await page.getByRole("checkbox", { name: /Terms of Use/ }).check();
  await page.getByRole("checkbox", { name: /Privacy Notice/ }).check();

  const createAccount = page.getByRole("button", { name: "Create account" });
  await createAccount.click();
  const dialog = page.getByRole("dialog", { name: "Confirm your age" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/\d+ years old/);
  await expect(dialog).toContainText("Born January 1, 2000");
  await expect(dialog).toContainText("cannot be changed");
  expect(registrationRequests).toBe(0);

  await dialog.getByRole("button", { name: "Cancel and edit" }).click();
  await expect(dialog).toBeHidden();
  await expect(createAccount).toBeFocused();
  expect(registrationRequests).toBe(0);

  await createAccount.click();
  await dialog
    .getByRole("button", { name: "Confirm and create account" })
    .click();
  await expect(page).toHaveURL(/\/onboarding\?step=2$/);
  await expect(page.getByRole("textbox", { name: "Account email" })).toHaveValue(
    "taylor@example.test",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem(
          "lets-go-green-registration-email-handoff",
        ),
      ),
    )
    .toBeNull();
  expect(registrationRequests).toBe(1);
});
