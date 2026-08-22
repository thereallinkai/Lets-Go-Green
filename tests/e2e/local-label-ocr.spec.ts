import { expect, test } from "@playwright/test";
import sharp from "sharp";

function nutritionFactsSvg() {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1800">
      <rect width="1400" height="1800" fill="#ffffff" />
      <g fill="#000000" font-family="Arial, Helvetica, sans-serif">
        <text x="90" y="150" font-size="112" font-weight="800">Nutrition Facts</text>
        <line x1="90" y1="190" x2="1310" y2="190" stroke="#000000" stroke-width="18" />
        <text x="90" y="300" font-size="64">Brand: Fixture Foods</text>
        <text x="90" y="405" font-size="64">Product name: Plant Protein</text>
        <text x="90" y="510" font-size="64">Serving size 1 scoop (30g)</text>
        <line x1="90" y1="555" x2="1310" y2="555" stroke="#000000" stroke-width="8" />
        <text x="90" y="690" font-size="88" font-weight="700">Calories 120</text>
        <line x1="90" y1="735" x2="1310" y2="735" stroke="#000000" stroke-width="12" />
        <text x="90" y="855" font-size="70">Total Fat 2g</text>
        <text x="90" y="970" font-size="70">Total Carbohydrate 3g</text>
        <text x="90" y="1085" font-size="70">Protein 24g</text>
        <line x1="90" y1="1130" x2="1310" y2="1130" stroke="#000000" stroke-width="8" />
        <text x="90" y="1250" font-size="58">Ingredients: Pea protein, cocoa.</text>
        <text x="90" y="1360" font-size="58" font-weight="700">CONTAINS SOY</text>
      </g>
    </svg>
  `);
}

test("reads a nutrition label with the real same-origin browser worker without auto-confirming", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const appOrigin = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
  ).origin;
  const externalRequests: string[] = [];
  const runtimeRequests: string[] = [];

  await page.goto("/settings#foods");
  await expect(
    page.getByRole("heading", { level: 2, name: "Private label foods" }),
  ).toBeVisible();

  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin === appOrigin) {
      if (requestUrl.pathname.startsWith("/ocr-runtime/")) {
        runtimeRequests.push(requestUrl.pathname);
      }
      return;
    }
    if (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") {
      externalRequests.push(request.url());
    }
  });
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
      requestUrl.origin !== appOrigin
    ) {
      externalRequests.push(route.request().url());
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  const label = await sharp(nutritionFactsSvg()).png().toBuffer();
  await page
    .getByLabel(/Take or choose a package-label photo/i)
    .setInputFiles({
      name: "nutrition-facts-fixture.png",
      mimeType: "image/png",
      buffer: label,
    });

  await expect(
    page.getByRole("heading", { name: "Review every filled suggestion" }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("spinbutton", { name: "Calories" })).toHaveValue(
    "120",
  );
  await expect(
    page.getByRole("spinbutton", { name: "Protein (g)" }),
  ).toHaveValue("24");
  await expect(
    page.getByRole("spinbutton", { name: "Carbohydrate (g)" }),
  ).toHaveValue("3");
  await expect(
    page.getByRole("spinbutton", { name: "Total fat (g)" }),
  ).toHaveValue("2");

  for (const name of [
    /I reviewed the complete package statement/i,
    /I reviewed the printed ingredients and claims/i,
    /Optional: submit a photo-free normalized copy/i,
    /I compared every automatic suggestion/i,
  ]) {
    await expect(page.getByRole("checkbox", { name })).not.toBeChecked();
  }
  await expect(page.getByRole("checkbox", { name: "Soy" })).not.toBeChecked();

  const workerNotice = await page.request.get(
    "/ocr-runtime/worker.min.js.LICENSE.txt",
  );
  expect(workerNotice.ok()).toBe(true);
  expect(await workerNotice.text()).toContain("ieee754. BSD-3-Clause License");

  expect(externalRequests).toEqual([]);
  expect(runtimeRequests).toContain("/ocr-runtime/manifest.json");
  expect(runtimeRequests).toContain("/ocr-runtime/worker.min.js");
  expect(runtimeRequests).toContain("/ocr-runtime/lang/eng.traineddata.gz");
  expect(runtimeRequests.some((path) => /\/core\/.*\.wasm\.js$/.test(path))).toBe(
    true,
  );
});
