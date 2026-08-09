import { createHash } from "node:crypto";
import sharp from "sharp";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const MAX_DIMENSION = 20_000;
const MIN_DIMENSION = 480;
const MIN_LUMINANCE_RANGE = 24;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export type SafeFoodLabelImage = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
  width: number;
  height: number;
  sha256: string;
};

function detectMimeType(input: Buffer): "image/jpeg" | "image/png" | null {
  if (input.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (input[0] === 0xff && input[1] === 0xd8) return "image/jpeg";
  return null;
}

export async function sanitizeFoodLabelImage(
  input: Buffer,
  declaredMimeType: string,
): Promise<SafeFoodLabelImage> {
  if (!input.length || input.length > MAX_BYTES) {
    throw new Error("image_size_not_supported");
  }
  const detectedMimeType = detectMimeType(input);
  if (
    !detectedMimeType ||
    detectedMimeType !== declaredMimeType ||
    !["image/jpeg", "image/png"].includes(declaredMimeType)
  ) {
    throw new Error("image_type_not_supported");
  }

  const pipeline = sharp(input, {
    failOn: "warning",
    limitInputPixels: MAX_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .flatten({ background: "#ffffff" });
  const { data, info } =
    detectedMimeType === "image/jpeg"
      ? await pipeline
          .jpeg({ quality: 90, mozjpeg: true })
          .toBuffer({ resolveWithObject: true })
      : await pipeline
          .png({ compressionLevel: 9, palette: false })
          .toBuffer({ resolveWithObject: true });

  if (
    !info.width ||
    !info.height ||
    Math.min(info.width, info.height) < MIN_DIMENSION ||
    info.width > MAX_DIMENSION ||
    info.height > MAX_DIMENSION ||
    info.width * info.height > MAX_PIXELS ||
    data.length > MAX_BYTES
  ) {
    throw new Error("image_dimensions_not_supported");
  }

  const statistics = await sharp(data).greyscale().stats();
  const luminance = statistics.channels[0];
  if (
    !luminance ||
    luminance.max - luminance.min < MIN_LUMINANCE_RANGE
  ) {
    throw new Error("image_contrast_too_low");
  }

  return {
    bytes: data,
    mimeType: detectedMimeType,
    extension: detectedMimeType === "image/png" ? "png" : "jpg",
    width: info.width,
    height: info.height,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}
