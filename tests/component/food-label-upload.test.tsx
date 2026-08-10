import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoodLabelUpload } from "../../components/food-label-upload";

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
      name: /I manually copied the serving nutrition/i,
    }),
  );
}

describe("FoodLabelUpload photo-first evidence", () => {
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
    expect(screen.getByText(/does not use it to guess/i)).toBeInTheDocument();
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
    expect(saveButton).toBeEnabled();
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
      ) as { shareNormalizedProduct: boolean };
      const confirmPayload = JSON.parse(
        String(fetchMock.mock.calls[2]?.[1]?.body),
      ) as { labelData: { shareNormalizedProduct: boolean } };
      expect(draftPayload.shareNormalizedProduct).toBe(shareNormalizedProduct);
      expect(confirmPayload.labelData.shareNormalizedProduct).toBe(
        shareNormalizedProduct,
      );
    },
  );

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
});
