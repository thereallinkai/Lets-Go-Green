import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodLabelOcrResult } from "../../src/lib/food-label-ocr";

const ocrMocks = vi.hoisted(() => ({
  FoodLabelOcrClientError: class MockFoodLabelOcrClientError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  inspectFoodLabelImage: vi.fn(),
  recognizeFoodLabelInBrowser: vi.fn(),
}));

vi.mock("@/src/lib/food-label-ocr-client", () => {
  return {
    FoodLabelOcrClientError: ocrMocks.FoodLabelOcrClientError,
    inspectFoodLabelImage: ocrMocks.inspectFoodLabelImage,
    recognizeFoodLabelInBrowser: ocrMocks.recognizeFoodLabelInBrowser,
  };
});

import { FoodLabelUpload } from "../../components/food-label-upload";

const emptyRecognition: FoodLabelOcrResult = {
  values: {},
  confidenceByField: {},
  evidenceByField: {},
  allergenSuggestions: [],
  unreadableRequiredFields: [
    "Brand",
    "Product",
    "Serving weight",
    "Calories",
    "Protein",
    "Carbohydrate",
    "Total fat",
    "Ingredients",
    "Package allergen statement",
  ],
  warnings: [],
  overallConfidence: 0,
  quality: "unreadable",
};

beforeEach(() => {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "11111111-1111-4111-8111-111111111111",
  );
  ocrMocks.inspectFoodLabelImage.mockReset();
  ocrMocks.inspectFoodLabelImage.mockResolvedValue({ width: 1000, height: 1000 });
  ocrMocks.recognizeFoodLabelInBrowser.mockReset();
  ocrMocks.recognizeFoodLabelInBrowser.mockResolvedValue(emptyRecognition);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function completeRequiredLabelFields(
  user: ReturnType<typeof userEvent.setup>,
  shareNormalizedProduct = false,
) {
  await user.upload(
    screen.getByLabelText(/Take or choose a package-label photo/i),
    new File(["label"], "label.png", { type: "image/png" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Brand" })).toBeEnabled(),
  );
  await completeRequiredTranscription(user, shareNormalizedProduct);
}

async function completeRequiredTranscription(
  user: ReturnType<typeof userEvent.setup>,
  shareNormalizedProduct = false,
) {
  await user.type(screen.getByRole("textbox", { name: "Brand" }), "Example Brand");
  await user.type(screen.getByRole("textbox", { name: "Product" }), "Protein powder");
  await user.type(screen.getByRole("spinbutton", { name: "Serving weight (g)" }), "30");
  await user.type(screen.getByRole("spinbutton", { name: "Calories" }), "120");
  await user.type(screen.getByRole("spinbutton", { name: "Protein (g)" }), "24");
  await user.type(screen.getByRole("spinbutton", { name: "Carbohydrate (g)" }), "3");
  await user.type(screen.getByRole("spinbutton", { name: "Total fat (g)" }), "2");
  await user.type(
    screen.getByRole("textbox", { name: "Ingredients exactly as printed" }),
    "Pea protein, cocoa.",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Package allergen statement" }),
    "None stated on package",
  );
  await user.click(screen.getByRole("checkbox", { name: "Protein" }));
  await user.click(
    screen.getByRole("checkbox", {
      name: /I reviewed the complete package statement/i,
    }),
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: /I reviewed the printed ingredients and claims/i,
    }),
  );
  if (shareNormalizedProduct) {
    await user.click(
      screen.getByRole("checkbox", {
        name: /Optional: submit a photo-free normalized copy/i,
      }),
    );
  }
  await user.click(
    screen.getByRole("checkbox", {
      name: /I compared every automatic suggestion/i,
    }),
  );
}

describe("FoodLabelUpload photo-first evidence", () => {
  it("uses unique heading and description IDs for every rendered uploader", () => {
    const { container } = render(
      <>
        <FoodLabelUpload />
        <FoodLabelUpload />
      </>,
    );

    const ids = Array.from(container.querySelectorAll<HTMLElement>("[id]"))
      .map((element) => element.id)
      .filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    for (const control of container.querySelectorAll<HTMLElement>(
      "[aria-labelledby], [aria-describedby]",
    )) {
      const references = [
        control.getAttribute("aria-labelledby"),
        control.getAttribute("aria-describedby"),
      ]
        .filter(Boolean)
        .flatMap((value) => value!.split(/\s+/));
      for (const reference of references) {
        expect(container.querySelector(`[id="${reference}"]`)).not.toBeNull();
      }
    }
  });

  it("shows clear requirements, previews and replaces photos, and never offers guessed facts", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:first-label")
      .mockReturnValueOnce("blob:replacement-label");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    render(<FoodLabelUpload />);
    expect(screen.getByText(/nothing is confirmed automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/full Nutrition Facts panel/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 480 px wide and 480 px tall/i)).toBeInTheDocument();
    expect(screen.queryByText(/barcode/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: /Optional: submit a photo-free normalized copy/i,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("link", { name: "Privacy Notice v1.3" }),
    ).toHaveAttribute("href", "/privacy");

    const input = screen.getByLabelText(/Take or choose a package-label photo/i);
    const first = new File(["first"], "nutrition-first.png", {
      type: "image/png",
    });
    await user.upload(input, first);
    expect(
      screen.getByRole("img", { name: "Preview of the selected package label" }),
    ).toHaveAttribute("src", "blob:first-label");
    expect(screen.getByText(/Replace package-label photo/i)).toBeInTheDocument();

    const replacement = new File(["replacement"], "nutrition-new.jpg", {
      type: "image/jpeg",
    });
    await user.upload(input, replacement);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-label");
    expect(
      screen.getByRole("img", { name: "Preview of the selected package label" }),
    ).toHaveAttribute("src", "blob:replacement-label");
    expect(screen.getByText(/nutrition-new.jpg/i)).toBeInTheDocument();
    const saveButton = screen.getByRole("button", {
      name: "Confirm and save private food",
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error code: LABEL_TRANSCRIPTION_UNCONFIRMED",
    );
  });

  it.each([false, true])(
    "keeps shareNormalizedProduct=%s consistent from private draft through confirmation",
    async (shareNormalizedProduct) => {
      const user = userEvent.setup();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: { id: "11111111-1111-4111-8111-111111111111" },
              error: null,
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: {}, error: null }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: { foodId: "22222222-2222-4222-8222-222222222222" },
              error: null,
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      render(<FoodLabelUpload />);
      await completeRequiredLabelFields(user, shareNormalizedProduct);
      const submitButton = screen.getByRole("button", {
        name: "Confirm and save private food",
      });
      expect(submitButton).toBeEnabled();
      const form = submitButton.closest("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form!);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      const draftPayload = JSON.parse(
        String(fetchMock.mock.calls[0]?.[1]?.body),
      ) as { labelData: { shareNormalizedProduct: boolean } };
      const confirmPayload = JSON.parse(
        String(fetchMock.mock.calls[2]?.[1]?.body),
      ) as { labelData: { shareNormalizedProduct: boolean } };
      expect(draftPayload.labelData.shareNormalizedProduct).toBe(
        shareNormalizedProduct,
      );
      expect(confirmPayload.labelData.shareNormalizedProduct).toBe(
        shareNormalizedProduct,
      );
    },
  );

  it("reuses one client draft ID when creation committed but its response was lost", async () => {
    const user = userEvent.setup();
    const draftBodies: Array<{ draftId: string; labelData: unknown }> = [];
    let requestNumber = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requestNumber += 1;
      if (String(url) === "/api/food-labels") {
        const body = JSON.parse(String(init?.body)) as {
          draftId: string;
          labelData: unknown;
        };
        draftBodies.push(body);
        if (draftBodies.length === 1) {
          throw new TypeError("response connection closed after commit");
        }
        return new Response(
          JSON.stringify({
            data: { id: body.draftId, status: "draft", replayed: true },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).endsWith("/images")) {
        return new Response(JSON.stringify({ data: { id: "image-id" }, error: null }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          data: { foodId: "22222222-2222-4222-8222-222222222222" },
          error: null,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FoodLabelUpload />);
    await completeRequiredLabelFields(user);
    await user.click(
      screen.getByRole("button", { name: "Confirm and save private food" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: LABEL_DRAFT_NETWORK_ERROR",
    );
    await user.click(screen.getByRole("button", { name: "Retry saving" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(requestNumber).toBe(4);
    expect(draftBodies).toHaveLength(2);
    expect(draftBodies[0]?.draftId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(draftBodies[1]?.draftId).toBe(draftBodies[0]?.draftId);
    expect(draftBodies[1]?.labelData).toEqual(draftBodies[0]?.labelData);
  });

  it("shows the safe server code and retries a failed photo stage without creating another draft", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "11111111-1111-4111-8111-111111111111" },
            error: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: null,
            error: {
              code: "LABEL_IMAGE_UPLOAD_FAILED",
              message: "The label image could not be uploaded.",
              details: "The private draft remains saved.",
              retryable: true,
              action: { kind: "retry", label: "Retry photo upload" },
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "image-id" }, error: null }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { foodId: "22222222-2222-4222-8222-222222222222" },
            error: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<FoodLabelUpload />);
    await completeRequiredLabelFields(user);
    await user.click(
      screen.getByRole("button", { name: "Confirm and save private food" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Error code: LABEL_IMAGE_UPLOAD_FAILED");
    expect(alert).not.toHaveTextContent("storage.objects");
    await user.click(screen.getByRole("button", { name: "Retry photo upload" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/food-labels"),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/images"),
      ),
    ).toHaveLength(2);
  });

  it("disables every editable form control throughout the draft, upload, and confirmation transaction", async () => {
    const user = userEvent.setup();
    let resolveDraft!: (response: Response) => void;
    let resolveUpload!: (response: Response) => void;
    let resolveConfirmation!: (response: Response) => void;
    const draftPending = new Promise<Response>((resolve) => {
      resolveDraft = resolve;
    });
    const uploadPending = new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    });
    const confirmationPending = new Promise<Response>((resolve) => {
      resolveConfirmation = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(draftPending)
      .mockReturnValueOnce(uploadPending)
      .mockReturnValueOnce(confirmationPending);
    vi.stubGlobal("fetch", fetchMock);

    render(<FoodLabelUpload />);
    await completeRequiredLabelFields(user);
    const submitButton = screen.getByRole("button", {
      name: "Confirm and save private food",
    });
    const form = submitButton.closest("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const editableControls = Array.from(
      form!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(
        "input, textarea, select, button",
      ),
    );
    expect(editableControls.length).toBeGreaterThan(10);
    const expectTransactionLocked = () => {
      expect(form).toHaveAttribute("aria-busy", "true");
      editableControls.forEach((control) => expect(control).toBeDisabled());
    };
    expectTransactionLocked();

    await act(async () => {
      resolveDraft(
        new Response(
          JSON.stringify({
            data: { id: "11111111-1111-4111-8111-111111111111" },
            error: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectTransactionLocked();

    await act(async () => {
      resolveUpload(
        new Response(JSON.stringify({ data: { id: "image-id" }, error: null }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expectTransactionLocked();

    await act(async () => {
      resolveConfirmation(
        new Response(
          JSON.stringify({
            data: { foodId: "22222222-2222-4222-8222-222222222222" },
            error: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    });
    await waitFor(() => expect(form).toHaveAttribute("aria-busy", "false"));
    expect(form).toHaveAttribute("aria-busy", "false");
  });

  it("retries a failed confirmation with the same draft and without uploading the photo again", async () => {
    const user = userEvent.setup();
    const draftId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: draftId }, error: null }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "image-id" }, error: null }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: null,
            error: {
              code: "LABEL_CONFIRM_FAILED",
              message: "The confirmed product could not be saved.",
              details: "The private draft and photo remain saved.",
              retryable: true,
              action: { kind: "retry", label: "Retry confirmation" },
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { foodId: "22222222-2222-4222-8222-222222222222" },
            error: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<FoodLabelUpload />);
    await completeRequiredLabelFields(user);
    await user.click(
      screen.getByRole("button", { name: "Confirm and save private food" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: LABEL_CONFIRM_FAILED",
    );
    await user.click(screen.getByRole("button", { name: "Retry confirmation" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/food-labels"),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/images"),
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => String(url) === `/api/food-labels/${draftId}`,
      ),
    ).toHaveLength(2);
  });

  it("treats a resolved false after confirmation as refresh failure and retries only that refresh", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "11111111-1111-4111-8111-111111111111" },
            error: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "image-id" }, error: null }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { foodId: "22222222-2222-4222-8222-222222222222" },
            error: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    render(<FoodLabelUpload onCreated={onCreated} />);
    await completeRequiredLabelFields(user);
    await user.click(
      screen.getByRole("button", { name: "Confirm and save private food" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: PRIVATE_FOOD_REFRESH_FAILED",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onCreated).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: "Refresh saved foods" }),
    );

    expect(
      await screen.findByText("The saved-food list is up to date."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onCreated).toHaveBeenCalledTimes(2);
  });

  it("fills only OCR suggestions and leaves every safety and confirmation checkbox unchecked", async () => {
    const user = userEvent.setup();
    ocrMocks.recognizeFoodLabelInBrowser.mockResolvedValueOnce({
      ...emptyRecognition,
      values: {
        servingWeightGrams: 30,
        calories: 120,
        proteinGrams: 24,
        carbohydrateGrams: 3,
        fatGrams: 2,
        ingredientsText: "Whey protein and cocoa.",
        allergenStatement: "Contains: Milk and soy.",
      },
      confidenceByField: {
        servingWeightGrams: 94,
        calories: 96,
        proteinGrams: 93,
        carbohydrateGrams: 91,
        fatGrams: 92,
        ingredientsText: 88,
        allergenStatement: 90,
      },
      evidenceByField: {
        servingWeightGrams: "Serving size 1 scoop (30g)",
        calories: "Calories 120",
        proteinGrams: "Protein 24g",
        carbohydrateGrams: "Total Carbohydrate 3g",
        fatGrams: "Total Fat 2g",
        ingredientsText: "Ingredients: Whey protein and cocoa.",
        allergenStatement: "Contains: Milk and soy.",
      },
      allergenSuggestions: ["milk", "soy"],
      unreadableRequiredFields: ["Brand", "Product"],
      overallConfidence: 91,
      quality: "strong",
    } satisfies FoodLabelOcrResult);

    render(<FoodLabelUpload />);
    await user.upload(
      screen.getByLabelText(/Take or choose a package-label photo/i),
      new File(["label"], "nutrition.png", { type: "image/png" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("spinbutton", { name: "Calories" })).toHaveValue(120),
    );
    expect(screen.getByRole("spinbutton", { name: "Protein (g)" })).toHaveValue(24);
    expect(screen.getByRole("textbox", { name: "Ingredients exactly as printed" })).toHaveValue(
      "Whey protein and cocoa.",
    );
    expect(screen.getByText(/Nutrition panels often do not print a labeled Brand or Product/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing was selected automatically/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Milk" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Soy" })).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the complete package statement/i,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the printed ingredients and claims/i,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: /I compared every automatic suggestion/i,
      }),
    ).not.toBeChecked();
  });

  it("clears unchanged OCR values before retry while preserving user edits", async () => {
    const user = userEvent.setup();
    const first = {
      ...emptyRecognition,
      values: { calories: 120, proteinGrams: 24 },
      confidenceByField: { calories: 94, proteinGrams: 92 },
      evidenceByField: { calories: "Calories 120", proteinGrams: "Protein 24g" },
      unreadableRequiredFields: ["Brand", "Product"],
    } satisfies FoodLabelOcrResult;
    const second = {
      ...first,
      values: { calories: 130, proteinGrams: 25 },
      evidenceByField: { calories: "Calories 130", proteinGrams: "Protein 25g" },
    } satisfies FoodLabelOcrResult;
    ocrMocks.recognizeFoodLabelInBrowser
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    render(<FoodLabelUpload />);
    await user.upload(
      screen.getByLabelText(/Take or choose a package-label photo/i),
      new File(["label"], "nutrition.png", { type: "image/png" }),
    );
    const calories = screen.getByRole("spinbutton", { name: "Calories" });
    const protein = screen.getByRole("spinbutton", { name: "Protein (g)" });
    await waitFor(() => expect(calories).toHaveValue(120));
    await user.clear(protein);
    await user.type(protein, "23");

    await user.click(screen.getByRole("button", { name: "Read this photo again" }));
    await waitFor(() => expect(calories).toHaveValue(130));
    expect(protein).toHaveValue(23);
    expect(screen.getByText(/Existing entries were not overwritten: Protein/i)).toBeInTheDocument();
  });

  it("terminates a replaced photo before starting the next read and ignores stale values", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: FoodLabelOcrResult) => void;
    let resolveSecond!: (value: FoodLabelOcrResult) => void;
    ocrMocks.recognizeFoodLabelInBrowser
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    render(<FoodLabelUpload />);
    const input = screen.getByLabelText(/Take or choose a package-label photo/i);
    await user.upload(input, new File(["one"], "one.png", { type: "image/png" }));
    const firstSignal = ocrMocks.recognizeFoodLabelInBrowser.mock.calls[0]?.[1]
      ?.signal as AbortSignal;
    await user.upload(input, new File(["two"], "two.png", { type: "image/png" }));
    expect(firstSignal.aborted).toBe(true);
    expect(ocrMocks.recognizeFoodLabelInBrowser).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({
        ...emptyRecognition,
        values: { calories: 100 },
        confidenceByField: { calories: 90 },
        evidenceByField: { calories: "Calories 100" },
      });
    });
    await waitFor(() =>
      expect(ocrMocks.recognizeFoodLabelInBrowser).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByRole("spinbutton", { name: "Calories" })).toHaveValue(null);
    await waitFor(() =>
      expect(resolveSecond).toBeTypeOf("function"),
    );
    await act(async () => {
      resolveSecond({
        ...emptyRecognition,
        values: { calories: 200 },
        confidenceByField: { calories: 90 },
        evidenceByField: { calories: "Calories 200" },
      });
    });
    await waitFor(() =>
      expect(screen.getByRole("spinbutton", { name: "Calories" })).toHaveValue(200),
    );
  });

  it("aborts the active reader when the form unmounts", async () => {
    const user = userEvent.setup();
    ocrMocks.recognizeFoodLabelInBrowser.mockReturnValueOnce(new Promise(() => undefined));
    const view = render(<FoodLabelUpload />);
    await user.upload(
      screen.getByLabelText(/Take or choose a package-label photo/i),
      new File(["label"], "nutrition.png", { type: "image/png" }),
    );
    const signal = ocrMocks.recognizeFoodLabelInBrowser.mock.calls[0]?.[1]
      ?.signal as AbortSignal;

    expect(screen.getByRole("textbox", { name: "Brand" })).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: /Optional: submit a photo-free normalized copy/i,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the complete package statement/i,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: /I compared every automatic suggestion/i,
      }),
    ).toBeDisabled();
    expect(screen.getByLabelText(/Replace package-label photo/i)).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel photo reading" })).toBeEnabled();

    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("cancels the active reader without locking manual transcription", async () => {
    const user = userEvent.setup();
    ocrMocks.recognizeFoodLabelInBrowser.mockReturnValueOnce(
      new Promise(() => undefined),
    );

    render(<FoodLabelUpload />);
    await user.upload(
      screen.getByLabelText(/Take or choose a package-label photo/i),
      new File(["label"], "nutrition.png", { type: "image/png" }),
    );
    const signal = ocrMocks.recognizeFoodLabelInBrowser.mock.calls[0]?.[1]
      ?.signal as AbortSignal;

    await user.click(screen.getByRole("button", { name: "Cancel photo reading" }));

    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("textbox", { name: "Brand" })).toBeEnabled();
    expect(screen.getByText(/Automatic photo reading canceled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read this photo again" })).toBeEnabled();
  });

  it("waits for canceled work to terminate before retry and ignores its late result", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: FoodLabelOcrResult) => void;
    let resolveSecond!: (value: FoodLabelOcrResult) => void;
    ocrMocks.recognizeFoodLabelInBrowser
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    render(<FoodLabelUpload />);
    await user.upload(
      screen.getByLabelText(/Take or choose a package-label photo/i),
      new File(["label"], "nutrition.png", { type: "image/png" }),
    );
    const firstSignal = ocrMocks.recognizeFoodLabelInBrowser.mock.calls[0]?.[1]
      ?.signal as AbortSignal;
    await user.click(screen.getByRole("button", { name: "Cancel photo reading" }));
    await user.click(screen.getByRole("button", { name: "Read this photo again" }));

    expect(firstSignal.aborted).toBe(true);
    expect(ocrMocks.recognizeFoodLabelInBrowser).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst({
        ...emptyRecognition,
        values: { calories: 100 },
        confidenceByField: { calories: 90 },
        evidenceByField: { calories: "Calories 100" },
      });
    });
    await waitFor(() =>
      expect(ocrMocks.recognizeFoodLabelInBrowser).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByRole("spinbutton", { name: "Calories" })).toHaveValue(null);
    await act(async () => {
      resolveSecond({
        ...emptyRecognition,
        values: { calories: 210 },
        confidenceByField: { calories: 90 },
        evidenceByField: { calories: "Calories 210" },
      });
    });
    await waitFor(() =>
      expect(screen.getByRole("spinbutton", { name: "Calories" })).toHaveValue(210),
    );
  });

  it("locks review controls during image preflight while replacement remains available", async () => {
    const user = userEvent.setup();
    let resolveInspection!: (value: { width: number; height: number }) => void;
    ocrMocks.inspectFoodLabelImage.mockReturnValueOnce(
      new Promise((resolve) => { resolveInspection = resolve; }),
    );

    render(<FoodLabelUpload />);
    const photoInput = screen.getByLabelText(/Take or choose a package-label photo/i);
    await user.upload(
      photoInput,
      new File(["label"], "nutrition.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Checking the new photo header/i)).toBeInTheDocument(),
    );
    expect(photoInput).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Brand" })).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: /Optional: submit a photo-free normalized copy/i,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: /I compared every automatic suggestion/i,
      }),
    ).toBeDisabled();

    await act(async () => resolveInspection({ width: 1000, height: 1000 }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Brand" })).toBeEnabled(),
    );
  });

  it.each([
    ["OCR_IMAGE_CORRUPT", "LABEL_IMAGE_CORRUPT"],
    ["OCR_IMAGE_TOO_SMALL", "LABEL_IMAGE_RESOLUTION_TOO_LOW"],
    ["OCR_IMAGE_TOO_LARGE", "LABEL_IMAGE_PIXELS_TOO_LARGE"],
  ])(
    "rejects %s before preview, recognition, or any draft request",
    async (readerCode, uiCode) => {
      const user = userEvent.setup();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      ocrMocks.inspectFoodLabelImage.mockRejectedValueOnce(
        new ocrMocks.FoodLabelOcrClientError(readerCode, "invalid dimensions"),
      );

      render(<FoodLabelUpload />);
      await user.upload(
        screen.getByLabelText(/Take or choose a package-label photo/i),
        new File(["invalid"], "invalid.png", { type: "image/png" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        `Error code: ${uiCode}`,
      );
      expect(screen.queryByRole("img", { name: /selected package label/i })).not.toBeInTheDocument();
      expect(ocrMocks.recognizeFoodLabelInBrowser).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole("button", { name: "Confirm and save private food" }),
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Error code: LABEL_IMAGE_REQUIRED",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("keeps a prior valid photo when an invalid replacement is rejected", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue("blob:valid-label");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    render(<FoodLabelUpload />);
    const input = screen.getByLabelText(/Take or choose a package-label photo/i);
    await user.upload(input, new File(["valid"], "valid.png", { type: "image/png" }));
    expect(
      await screen.findByRole("img", { name: "Preview of the selected package label" }),
    ).toHaveAttribute("src", "blob:valid-label");
    ocrMocks.inspectFoodLabelImage.mockRejectedValueOnce(
      new ocrMocks.FoodLabelOcrClientError(
        "OCR_IMAGE_CORRUPT",
        "invalid header",
      ),
    );

    await user.upload(input, new File(["broken"], "broken.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: LABEL_IMAGE_CORRUPT",
    );
    expect(screen.getByText("valid.png")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Preview of the selected package label" }),
    ).toHaveAttribute("src", "blob:valid-label");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("saves the prior valid photo after rejecting an invalid replacement", async () => {
    const user = userEvent.setup();
    const validPhoto = new File(["valid"], "valid.png", { type: "image/png" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "11111111-1111-4111-8111-111111111111" },
            error: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "image-id" }, error: null }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { foodId: "22222222-2222-4222-8222-222222222222" },
            error: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<FoodLabelUpload />);
    const input = screen.getByLabelText(/Take or choose a package-label photo/i);
    await user.upload(input, validPhoto);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Brand" })).toBeEnabled(),
    );
    ocrMocks.inspectFoodLabelImage.mockRejectedValueOnce(
      new ocrMocks.FoodLabelOcrClientError("OCR_IMAGE_CORRUPT", "invalid header"),
    );
    await user.upload(
      input,
      new File(["broken"], "broken.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: LABEL_IMAGE_CORRUPT",
    );

    await completeRequiredTranscription(user);
    await user.click(
      screen.getByRole("button", { name: "Confirm and save private food" }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const uploadBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(uploadBody).toBeInstanceOf(FormData);
    expect((uploadBody as FormData).get("file")).toBe(validPhoto);
  });

  it("uses the newest successful header check and ignores a stale replacement", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: { width: number; height: number }) => void;
    let resolveSecond!: (value: { width: number; height: number }) => void;
    ocrMocks.inspectFoodLabelImage
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    const createObjectURL = vi.fn().mockReturnValue("blob:newest");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    render(<FoodLabelUpload />);
    const input = screen.getByLabelText(/Take or choose a package-label photo/i);
    await user.upload(input, new File(["first"], "first.png", { type: "image/png" }));
    const firstSignal = ocrMocks.inspectFoodLabelImage.mock.calls[0]?.[1] as AbortSignal;
    await user.upload(input, new File(["second"], "second.png", { type: "image/png" }));
    expect(firstSignal.aborted).toBe(true);
    await act(async () => resolveSecond({ width: 1000, height: 1000 }));
    expect(await screen.findByText("second.png")).toBeInTheDocument();
    await act(async () => resolveFirst({ width: 1000, height: 1000 }));
    expect(screen.getByText("second.png")).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("reports a bounded reader timeout distinctly and re-enables manual review", async () => {
    const user = userEvent.setup();
    ocrMocks.recognizeFoodLabelInBrowser.mockRejectedValueOnce(
      new ocrMocks.FoodLabelOcrClientError(
        "OCR_TIMEOUT",
        "reader timed out",
      ),
    );

    render(<FoodLabelUpload />);
    await user.upload(
      screen.getByLabelText(/Take or choose a package-label photo/i),
      new File(["label"], "nutrition.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: LABEL_RECOGNITION_TIMED_OUT",
    );
    expect(screen.getByRole("textbox", { name: "Brand" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Retry private photo reading" })).toBeEnabled();
  });

  it("does not move focus when background recognition fails", async () => {
    const user = userEvent.setup();
    let rejectRecognition!: (error: Error) => void;
    ocrMocks.recognizeFoodLabelInBrowser.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRecognition = reject;
      }),
    );

    render(<FoodLabelUpload />);
    const photoInput = screen.getByLabelText(/Take or choose a package-label photo/i);
    await user.upload(
      photoInput,
      new File(["label"], "nutrition.png", { type: "image/png" }),
    );
    photoInput.focus();
    await act(async () => {
      rejectRecognition(
        new ocrMocks.FoodLabelOcrClientError(
          "OCR_ENGINE_FAILED",
          "reader unavailable",
        ),
      );
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Error code: LABEL_RECOGNITION_FAILED",
    );
    expect(photoInput).toHaveFocus();
    const brand = screen.getByRole("textbox", { name: "Brand" });
    await user.type(brand, "Example Brand");
    expect(brand).toHaveValue("Example Brand");
  });
});
