import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST as createDraft } from "../../app/api/food-labels/route";
import { POST as confirmDraft } from "../../app/api/food-labels/[id]/route";
import { POST as uploadImage } from "../../app/api/food-labels/[id]/images/route";

describe("food-label route error envelopes", () => {
  it("names invalid draft fields without returning schema internals", async () => {
    const response = await createDraft(
      new Request("http://localhost/api/food-labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandName: "Example" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: "INVALID_LABEL",
      retryable: false,
      action: { kind: "edit" },
    });
    expect(body.error.details).toContain("product");
    expect(body.error.details).not.toContain("invalid_type");
  });

  it("returns a stable confirmation-request reason before any database call", async () => {
    const response = await confirmDraft(
      new Request("http://localhost/api/food-labels/id", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      }),
      {
        params: Promise.resolve({
          id: "11111111-1111-4111-8111-111111111111",
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: "INVALID_LABEL_CONFIRMATION",
      retryable: false,
      action: { kind: "edit" },
    });
  });

  it("rejects an invalid upload target with a safe stable code", async () => {
    const response = await uploadImage(
      new Request("http://localhost/api/food-labels/not-a-draft/images", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "not-a-draft" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: "INVALID_LABEL_ID",
      retryable: false,
      action: { kind: "edit" },
    });
    expect(JSON.stringify(body)).not.toContain("PostgreSQL");
  });
});
