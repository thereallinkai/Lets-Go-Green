import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { sanitizeFoodLabelImage } from "@/src/lib/food-label-image";

async function readableLabel(width = 800, height = 1_000) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><rect x="80" y="100" width="${width - 160}" height="80" fill="#111"/><rect x="80" y="240" width="${width - 240}" height="30" fill="#333"/></svg>`,
        ),
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

describe("sanitizeFoodLabelImage", () => {
  it("re-encodes a readable label and returns a content digest", async () => {
    const result = await sanitizeFoodLabelImage(
      await readableLabel(),
      "image/jpeg",
    );

    expect(result).toMatchObject({
      mimeType: "image/jpeg",
      extension: "jpg",
      width: 800,
      height: 1_000,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it("rejects a photo that is too small for reliable manual comparison", async () => {
    await expect(
      sanitizeFoodLabelImage(await readableLabel(320, 420), "image/jpeg"),
    ).rejects.toThrow("image_dimensions_not_supported");
  });

  it("rejects a blank low-contrast image", async () => {
    const blank = await sharp({
      create: {
        width: 800,
        height: 1_000,
        channels: 3,
        background: "#f8f8f8",
      },
    })
      .png()
      .toBuffer();

    await expect(
      sanitizeFoodLabelImage(blank, "image/png"),
    ).rejects.toThrow("image_contrast_too_low");
  });

  it("rejects a declared image type that does not match the bytes", async () => {
    await expect(
      sanitizeFoodLabelImage(await readableLabel(), "image/png"),
    ).rejects.toThrow("image_type_not_supported");
  });
});
