"use client";

import {
  parseFoodLabelOcr,
  type FoodLabelOcrLine,
  type FoodLabelOcrResult,
} from "@/src/lib/food-label-ocr";

const OCR_ASSET_ROOT = "/ocr-runtime";
const EXPECTED_ASSET_PACKAGES = {
  "tesseract.js": "7.0.0",
  "tesseract.js-core": "7.0.0",
  "@tesseract.js-data/eng": "1.0.0",
} as const;

export type FoodLabelOcrProgress = {
  progress: number;
  status: string;
};

export class FoodLabelOcrClientError extends Error {
  constructor(
    readonly code:
      | "OCR_ABORTED"
      | "OCR_IMAGE_CORRUPT"
      | "OCR_IMAGE_TOO_LARGE"
      | "OCR_IMAGE_TOO_SMALL"
      | "OCR_DOWNSCALE_FAILED"
      | "OCR_ASSETS_UNAVAILABLE"
      | "OCR_ENGINE_FAILED"
      | "OCR_TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "FoodLabelOcrClientError";
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_HEADER_BYTES = 512 * 1024;
const MAX_PIXELS = 20_000_000;
const MAX_DIMENSION = 20_000;
const MIN_DIMENSION = 480;
const MAX_OCR_PIXELS = 4_000_000;
const OCR_TIMEOUT_MS = 60_000;
type AwaitBounded = <T>(operation: Promise<T>) => Promise<T>;

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset]! * 256 + bytes[offset + 1]!;
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset]! * 16_777_216 +
    bytes[offset + 1]! * 65_536 +
    bytes[offset + 2]! * 256 +
    bytes[offset + 3]!
  );
}

function pngDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 24 ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  ) {
    return null;
  }
  return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
]);

function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = readUint16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: readUint16(bytes, offset + 3),
        width: readUint16(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

export async function inspectFoodLabelImage(
  file: File,
  signal: AbortSignal,
  awaitBounded: AwaitBounded = async (operation) => operation,
) {
  assertNotAborted(signal);
  const bytes = new Uint8Array(
    await awaitBounded(file.slice(0, MAX_HEADER_BYTES).arrayBuffer()),
  );
  assertNotAborted(signal);
  const dimensions =
    file.type === "image/png"
      ? pngDimensions(bytes)
      : file.type === "image/jpeg"
        ? jpegDimensions(bytes)
        : null;
  if (!dimensions?.width || !dimensions.height) {
    throw new FoodLabelOcrClientError(
      "OCR_IMAGE_CORRUPT",
      "The selected JPEG or PNG header could not be read safely.",
    );
  }
  if (
    dimensions.width > MAX_DIMENSION ||
    dimensions.height > MAX_DIMENSION ||
    dimensions.width * dimensions.height > MAX_PIXELS
  ) {
    throw new FoodLabelOcrClientError(
      "OCR_IMAGE_TOO_LARGE",
      "The selected photo exceeds the safe 20-megapixel reading limit.",
    );
  }
  if (Math.min(dimensions.width, dimensions.height) < MIN_DIMENSION) {
    throw new FoodLabelOcrClientError(
      "OCR_IMAGE_TOO_SMALL",
      "The selected photo is too small for reliable label reading.",
    );
  }
  return dimensions;
}

async function prepareBoundedOcrImage(
  file: File,
  dimensions: { width: number; height: number },
  signal: AbortSignal,
  awaitBounded: AwaitBounded,
) {
  if (dimensions.width * dimensions.height <= MAX_OCR_PIXELS) return file;
  if (typeof createImageBitmap !== "function") {
    throw new FoodLabelOcrClientError(
      "OCR_DOWNSCALE_FAILED",
      "This browser cannot safely resize the large photo for local reading.",
    );
  }
  const scale = Math.sqrt(
    MAX_OCR_PIXELS / (dimensions.width * dimensions.height),
  );
  const width = Math.max(1, Math.floor(dimensions.width * scale));
  const height = Math.max(1, Math.floor(dimensions.height * scale));
  let bitmap: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    const bitmapPromise = createImageBitmap(file, {
      imageOrientation: "from-image",
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
    }).then((createdBitmap) => {
      if (signal.aborted) {
        createdBitmap.close();
        assertNotAborted(signal);
      }
      return createdBitmap;
    });
    bitmap = await awaitBounded(bitmapPromise);
    assertNotAborted(signal);
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("canvas_context_unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await awaitBounded(
      new Promise<Blob | null>((resolve) =>
        canvas!.toBlob(resolve, "image/jpeg", 0.9),
      ),
    );
    assertNotAborted(signal);
    if (!blob) throw new Error("canvas_encode_failed");
    return blob;
  } catch {
    if (signal.aborted) assertNotAborted(signal);
    throw new FoodLabelOcrClientError(
      "OCR_DOWNSCALE_FAILED",
      "The large photo could not be resized safely for local reading.",
    );
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new FoodLabelOcrClientError(
      "OCR_ABORTED",
      "Package-label reading was canceled.",
    );
  }
}

async function verifySameOriginAssets(signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${OCR_ASSET_ROOT}/manifest.json`, {
      // The path is intentionally stable, so always revalidate the tiny
      // manifest before trusting cached versioned worker/model assets.
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
  } catch {
    if (signal.aborted) assertNotAborted(signal);
    throw new FoodLabelOcrClientError(
      "OCR_ASSETS_UNAVAILABLE",
      "The local label reader could not load its same-origin files.",
    );
  }
  if (!response.ok) {
    throw new FoodLabelOcrClientError(
      "OCR_ASSETS_UNAVAILABLE",
      "The local label reader is not prepared in this development session.",
    );
  }
  const manifest = (await response.json().catch(() => null)) as {
    packages?: Record<string, unknown>;
  } | null;
  const versionsMatch = Object.entries(EXPECTED_ASSET_PACKAGES).every(
    ([packageName, version]) => manifest?.packages?.[packageName] === version,
  );
  if (!versionsMatch) {
    throw new FoodLabelOcrClientError(
      "OCR_ASSETS_UNAVAILABLE",
      "The local label reader files do not match this app version.",
    );
  }
}

function stagedProgress(status: string, progress: number) {
  const normalized = Math.max(0, Math.min(1, progress));
  if (status.includes("core")) return 0.05 + normalized * 0.2;
  if (status.includes("language")) return 0.25 + normalized * 0.25;
  if (status.includes("initializing")) return 0.5 + normalized * 0.1;
  if (status.includes("recognizing")) return 0.6 + normalized * 0.4;
  return Math.min(0.59, normalized * 0.5);
}

function friendlyStatus(status: string) {
  if (status.includes("core")) return "Starting the private on-device reader…";
  if (status.includes("language")) return "Loading the English label reader…";
  if (status.includes("initializing")) return "Preparing the label reader…";
  if (status.includes("recognizing")) return "Reading printed nutrition lines…";
  return "Preparing the package photo…";
}

export async function recognizeFoodLabelInBrowser(
  file: File,
  options: {
    signal: AbortSignal;
    onProgress?: (progress: FoodLabelOcrProgress) => void;
  },
): Promise<FoodLabelOcrResult> {
  const { signal, onProgress } = options;
  assertNotAborted(signal);
  const localController = new AbortController();
  const localSignal = localController.signal;
  let worker: import("tesseract.js").Worker | null = null;
  let workerCreationPromise: Promise<import("tesseract.js").Worker> | null = null;
  let terminationPromise: Promise<void> | null = null;
  let timedOut = false;
  let workComplete = false;
  const terminate = (): Promise<void> => {
    if (!worker) return Promise.resolve();
    if (!terminationPromise) {
      try {
        // Tesseract dispatches the underlying Web Worker termination when this
        // method is called. Its bookkeeping promise is not trusted to settle.
        terminationPromise = Promise.resolve(worker.terminate()).then(
          () => undefined,
          () => undefined,
        );
      } catch {
        terminationPromise = Promise.resolve();
      }
    }
    return terminationPromise;
  };
  let rejectCancellation!: (error: FoodLabelOcrClientError) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const cancelCurrentWork = () => {
    if (workComplete) return;
    void terminate();
    rejectCancellation(
      new FoodLabelOcrClientError(
        timedOut ? "OCR_TIMEOUT" : "OCR_ABORTED",
        timedOut
          ? "The private reader stopped after 60 seconds."
          : "Package-label reading was canceled.",
      ),
    );
  };
  localSignal.addEventListener("abort", cancelCurrentWork, { once: true });
  const abortFromCaller = () => localController.abort();
  signal.addEventListener("abort", abortFromCaller, { once: true });
  if (signal.aborted) localController.abort();
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    localController.abort();
  }, OCR_TIMEOUT_MS);
  const bounded = <T,>(operation: Promise<T>) =>
    Promise.race([operation, cancellation]);

  try {
    onProgress?.({ progress: 0.02, status: "Preparing the package photo…" });
    const dimensions = await inspectFoodLabelImage(
      file,
      localSignal,
      bounded,
    );
    const boundedImage = await prepareBoundedOcrImage(
      file,
      dimensions,
      localSignal,
      bounded,
    );
    await bounded(verifySameOriginAssets(localSignal));
    assertNotAborted(localSignal);
    const Tesseract = await bounded(import("tesseract.js"));
    workerCreationPromise = Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
      workerPath: `${OCR_ASSET_ROOT}/worker.min.js`,
      corePath: `${OCR_ASSET_ROOT}/core`,
      langPath: `${OCR_ASSET_ROOT}/lang`,
      workerBlobURL: false,
      gzip: true,
      logger(message) {
        onProgress?.({
          progress: stagedProgress(message.status, message.progress),
          status: friendlyStatus(message.status),
        });
      },
    }).then(async (createdWorker) => {
      if (localSignal.aborted) {
        await createdWorker.terminate().catch(() => undefined);
        throw new FoodLabelOcrClientError(
          timedOut ? "OCR_TIMEOUT" : "OCR_ABORTED",
          timedOut
            ? "The private reader stopped after 60 seconds."
            : "Package-label reading was canceled.",
        );
      }
      worker = createdWorker;
      return createdWorker;
    });
    worker = await bounded(workerCreationPromise);
    assertNotAborted(localSignal);
    await bounded(
      worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      }),
    );
    assertNotAborted(localSignal);
    const recognition = await bounded(
      worker.recognize(
        boundedImage,
        { rotateAuto: true },
        { text: true, blocks: true },
      ),
    );
    assertNotAborted(localSignal);
    const lines: FoodLabelOcrLine[] =
      recognition.data.blocks?.flatMap((block) =>
        block.paragraphs.flatMap((paragraph) =>
          paragraph.lines.map((line) => ({
            text: line.text,
            confidence: line.confidence,
            words: line.words.map((word) => ({
              text: word.text,
              confidence: word.confidence,
            })),
          })),
        ),
      ) ?? [];
    const result = parseFoodLabelOcr(lines, recognition.data.confidence);
    workComplete = true;
    onProgress?.({ progress: 1, status: "Local photo reading complete." });
    return result;
  } catch (error) {
    if (timedOut) {
      throw new FoodLabelOcrClientError(
        "OCR_TIMEOUT",
        "The private reader stopped after 60 seconds.",
      );
    }
    if (signal.aborted || (error instanceof FoodLabelOcrClientError && error.code === "OCR_ABORTED")) {
      throw new FoodLabelOcrClientError(
        "OCR_ABORTED",
        "Package-label reading was canceled.",
      );
    }
    if (error instanceof FoodLabelOcrClientError) throw error;
    throw new FoodLabelOcrClientError(
      "OCR_ENGINE_FAILED",
      "The private on-device reader could not finish this photo.",
    );
  } finally {
    window.clearTimeout(timeoutId);
    signal.removeEventListener("abort", abortFromCaller);
    localSignal.removeEventListener("abort", cancelCurrentWork);
    // Dispatch termination, but do not let third-party cleanup bookkeeping
    // extend the bounded reader attempt forever.
    void terminate();
    // A module worker bootstrap can itself stall forever. Never wait on that
    // raw promise after the bounded operation has timed out or been canceled.
    // Its guarded continuation still terminates a worker immediately if one is
    // eventually produced, while callers are free to retry after the advertised
    // timeout instead of being permanently serialized behind a dead bootstrap.
    void workerCreationPromise?.catch(() => undefined);
  }
}
