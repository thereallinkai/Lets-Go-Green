import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tesseractMocks = vi.hoisted(() => {
  const worker = {
    recognize: vi.fn(),
    setParameters: vi.fn(),
    terminate: vi.fn(),
  };
  return {
    createWorker: vi.fn(),
    worker,
  };
});

vi.mock("tesseract.js", () => ({
  createWorker: tesseractMocks.createWorker,
  OEM: { LSTM_ONLY: 1 },
  PSM: { SPARSE_TEXT: "11" },
}));

import {
  inspectFoodLabelImage,
  recognizeFoodLabelInBrowser,
} from "../../src/lib/food-label-ocr-client";

const manifest = {
  packages: {
    "tesseract.js": "7.0.0",
    "tesseract.js-core": "7.0.0",
    "@tesseract.js-data/eng": "1.0.0",
  },
};

function pngFile(width: number, height: number) {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], "label.png", { type: "image/png" });
}

function jpegFile(width: number, height: number) {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return new File([bytes], "label.jpg", { type: "image/jpeg" });
}

function recognitionPage() {
  return {
    data: {
      confidence: 94,
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  text: "Calories 120",
                  confidence: 95,
                  words: [
                    { text: "Calories", confidence: 96 },
                    { text: "120", confidence: 94 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

beforeEach(() => {
  tesseractMocks.createWorker.mockReset();
  tesseractMocks.worker.recognize.mockReset();
  tesseractMocks.worker.setParameters.mockReset();
  tesseractMocks.worker.terminate.mockReset();
  tesseractMocks.createWorker.mockResolvedValue(tesseractMocks.worker);
  tesseractMocks.worker.setParameters.mockResolvedValue({});
  tesseractMocks.worker.recognize.mockResolvedValue(recognitionPage());
  tesseractMocks.worker.terminate.mockResolvedValue({});
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("inspectFoodLabelImage", () => {
  it("reads valid PNG and JPEG dimensions without decoding pixels", async () => {
    const signal = new AbortController().signal;
    await expect(inspectFoodLabelImage(pngFile(1200, 1600), signal)).resolves.toEqual({
      width: 1200,
      height: 1600,
    });
    await expect(inspectFoodLabelImage(jpegFile(1600, 1200), signal)).resolves.toEqual({
      width: 1600,
      height: 1200,
    });
  });

  it("enforces exact minimum, megapixel, and dimension boundaries", async () => {
    const signal = new AbortController().signal;
    await expect(inspectFoodLabelImage(pngFile(480, 480), signal)).resolves.toEqual({
      width: 480,
      height: 480,
    });
    await expect(inspectFoodLabelImage(pngFile(4000, 5000), signal)).resolves.toEqual({
      width: 4000,
      height: 5000,
    });
    await expect(inspectFoodLabelImage(pngFile(479, 1000), signal)).rejects.toMatchObject({
      code: "OCR_IMAGE_TOO_SMALL",
    });
    await expect(inspectFoodLabelImage(pngFile(4001, 5000), signal)).rejects.toMatchObject({
      code: "OCR_IMAGE_TOO_LARGE",
    });
    await expect(inspectFoodLabelImage(pngFile(20_001, 480), signal)).rejects.toMatchObject({
      code: "OCR_IMAGE_TOO_LARGE",
    });
  });

  it("rejects corrupt magic and an already-aborted inspection", async () => {
    const signal = new AbortController().signal;
    await expect(
      inspectFoodLabelImage(
        new File([new Uint8Array(32)], "broken.png", { type: "image/png" }),
        signal,
      ),
    ).rejects.toMatchObject({ code: "OCR_IMAGE_CORRUPT" });

    const controller = new AbortController();
    controller.abort();
    await expect(
      inspectFoodLabelImage(pngFile(1000, 1000), controller.signal),
    ).rejects.toMatchObject({ code: "OCR_ABORTED" });
  });
});

describe("recognizeFoodLabelInBrowser", () => {
  it("uses only pinned same-origin assets, no blob worker, and line/word confidence", async () => {
    const fetchMock = vi.mocked(fetch);
    const file = pngFile(1200, 1600);
    const result = await recognizeFoodLabelInBrowser(file, {
      signal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/ocr-runtime/manifest.json",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
    expect(tesseractMocks.createWorker).toHaveBeenCalledWith(
      "eng",
      1,
      expect.objectContaining({
        workerPath: "/ocr-runtime/worker.min.js",
        corePath: "/ocr-runtime/core",
        langPath: "/ocr-runtime/lang",
        workerBlobURL: false,
      }),
    );
    expect(JSON.stringify(tesseractMocks.createWorker.mock.calls[0])).not.toMatch(
      /https?:|cdn/i,
    );
    expect(tesseractMocks.worker.recognize.mock.calls[0]?.[0]).toBe(file);
    expect(result.values.calories).toBe(120);
    expect(result.confidenceByField.calories).toBe(94);
    expect(tesseractMocks.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("refuses stale or mismatched asset manifests before creating a worker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ packages: { ...manifest.packages, "tesseract.js": "6.0.0" } }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      recognizeFoodLabelInBrowser(pngFile(1000, 1000), {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "OCR_ASSETS_UNAVAILABLE" });
    expect(tesseractMocks.createWorker).not.toHaveBeenCalled();
  });

  it("fails safely when a large photo cannot be downscaled locally", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(
      recognizeFoodLabelInBrowser(pngFile(3000, 2000), {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "OCR_DOWNSCALE_FAILED" });
    expect(fetch).not.toHaveBeenCalled();
    expect(tesseractMocks.createWorker).not.toHaveBeenCalled();
  });

  it("downscales a large photo locally before recognition and releases bitmap memory", async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const context = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const encoded = new Blob(["bounded"], { type: "image/jpeg" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(context),
      toBlob: vi.fn((callback: BlobCallback) => callback(encoded)),
    } as unknown as HTMLCanvasElement;
    const nativeCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string, options?: ElementCreationOptions) =>
        tagName === "canvas"
          ? canvas
          : nativeCreateElement(tagName, options)) as typeof document.createElement,
    );
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));

    await recognizeFoodLabelInBrowser(pngFile(3000, 2000), {
      signal: new AbortController().signal,
    });

    expect(createImageBitmap).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        imageOrientation: "from-image",
        resizeQuality: "high",
      }),
    );
    expect(context.drawImage).toHaveBeenCalledWith(
      bitmap,
      0,
      0,
      expect.any(Number),
      expect.any(Number),
    );
    expect(tesseractMocks.worker.recognize.mock.calls[0]?.[0]).toBe(encoded);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("aborts and terminates an active worker", async () => {
    tesseractMocks.worker.recognize.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const recognition = recognizeFoodLabelInBrowser(pngFile(1000, 1000), {
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(tesseractMocks.worker.recognize).toHaveBeenCalledTimes(1),
    );

    controller.abort();
    await expect(recognition).rejects.toMatchObject({ code: "OCR_ABORTED" });
    expect(tesseractMocks.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("dispatches active-worker termination without waiting on hung bookkeeping", async () => {
    let finishTermination!: () => void;
    tesseractMocks.worker.recognize.mockReturnValue(new Promise(() => undefined));
    tesseractMocks.worker.terminate.mockReturnValueOnce(
      new Promise((resolve) => {
        finishTermination = () => resolve({});
      }),
    );
    const controller = new AbortController();
    const recognition = recognizeFoodLabelInBrowser(pngFile(1000, 1000), {
      signal: controller.signal,
    });
    let settled = false;
    void recognition.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await vi.waitFor(() =>
      expect(tesseractMocks.worker.recognize).toHaveBeenCalledTimes(1),
    );

    controller.abort();
    await vi.waitFor(() =>
      expect(tesseractMocks.worker.terminate).toHaveBeenCalledTimes(1),
    );
    await expect(recognition).rejects.toMatchObject({ code: "OCR_ABORTED" });
    expect(settled).toBe(true);
    finishTermination();
    await Promise.resolve();
  });

  it("terminates a worker that finishes creation after its run was canceled", async () => {
    let finishCreation!: () => void;
    tesseractMocks.createWorker.mockReturnValueOnce(
      new Promise((resolve) => {
        finishCreation = () => resolve(tesseractMocks.worker);
      }),
    );
    const controller = new AbortController();
    const recognition = recognizeFoodLabelInBrowser(pngFile(1000, 1000), {
      signal: controller.signal,
    });
    let settled = false;
    void recognition.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await vi.waitFor(() => expect(tesseractMocks.createWorker).toHaveBeenCalled());

    controller.abort();
    await expect(recognition).rejects.toMatchObject({ code: "OCR_ABORTED" });
    expect(settled).toBe(true);
    expect(tesseractMocks.worker.terminate).not.toHaveBeenCalled();
    finishCreation();
    await vi.waitFor(() =>
      expect(tesseractMocks.worker.terminate).toHaveBeenCalledTimes(1),
    );
  });

  it("times out a stalled worker bootstrap and permits a subsequent retry", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(manifest), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    tesseractMocks.createWorker
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce(tesseractMocks.worker);

    const stalled = recognizeFoodLabelInBrowser(pngFile(1000, 1000), {
      signal: new AbortController().signal,
    });
    const timeoutExpectation = expect(stalled).rejects.toMatchObject({
      code: "OCR_TIMEOUT",
    });
    await vi.waitFor(
      () => expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(1),
      { timeout: 1_000, interval: 1 },
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await timeoutExpectation;

    const retry = recognizeFoodLabelInBrowser(pngFile(1000, 1000), {
      signal: new AbortController().signal,
    });
    const retryExpectation = expect(retry).resolves.toMatchObject({
      values: { calories: 120 },
    });
    await vi.runAllTimersAsync();
    await retryExpectation;
    expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(2);
  });

  it("times out the entire local pipeline distinctly and terminates the worker", async () => {
    vi.useFakeTimers();
    tesseractMocks.worker.recognize.mockReturnValue(new Promise(() => undefined));
    const recognition = recognizeFoodLabelInBrowser(pngFile(1000, 1000), {
      signal: new AbortController().signal,
    });
    const timeoutExpectation = expect(recognition).rejects.toMatchObject({
      code: "OCR_TIMEOUT",
    });
    await vi.waitFor(
      () => expect(tesseractMocks.worker.recognize).toHaveBeenCalledTimes(1),
      { timeout: 1_000, interval: 1 },
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await timeoutExpectation;
    expect(tesseractMocks.worker.terminate).toHaveBeenCalledTimes(1);
  });
});
