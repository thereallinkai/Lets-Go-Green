import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  client: null as unknown,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => routeState.client,
}));

import { POST } from "../../app/api/food-labels/route";
import { foodLabelDataSchema } from "../../src/lib/domain/food-label";

const userId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const labelInput = {
  brandName: "Example Nutrition",
  productName: "Plant Protein",
  variantName: "Chocolate",
  gtin: "",
  packageDescription: "1 lb pouch",
  servingWeightGrams: 30,
  servingDescription: "1 scoop",
  calories: 120,
  proteinGrams: 24,
  carbohydrateGrams: 3,
  fatGrams: 2,
  ingredientsText: "Pea protein, cocoa.",
  allergenStatement: "None stated on package",
  categorySlugs: ["protein"],
  allergenSlugs: [],
  restrictionSlugs: [],
  sourceNote: "",
  shareNormalizedProduct: false,
  allergensReviewed: true,
  restrictionsReviewed: true,
  confirmedAccurate: false,
};
const normalizedLabel = {
  ...foodLabelDataSchema.parse(labelInput),
  sourceNote: "",
  confirmedAccurate: false,
};

function request(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/food-labels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draftId,
      labelData: labelInput,
      ...overrides,
    }),
  });
}

function authenticatedRpc(result: {
  data: { id: string; status: string; replayed: boolean } | null;
  error: { code?: string; message?: string } | null;
}) {
  const single = vi.fn(async () => result);
  const rpc = vi.fn(() => ({ single }));
  routeState.client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    rpc,
  };
  return { rpc, single };
}

beforeEach(() => {
  routeState.client = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("food label draft idempotency", () => {
  it("creates through the atomic RPC with the client UUID and normalized payload", async () => {
    const { rpc } = authenticatedRpc({
      data: { id: draftId, status: "draft", replayed: false },
      error: null,
    });

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({ id: draftId, status: "draft" });
    expect(rpc).toHaveBeenCalledWith("create_food_label_draft", {
      target_draft_id: draftId,
      target_label_data: normalizedLabel,
    });
  });

  it("returns an exact database replay as success", async () => {
    const { rpc } = authenticatedRpc({
      data: { id: draftId, status: "draft", replayed: true },
      error: null,
    });

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({ id: draftId, status: "draft", replayed: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["LABEL_DRAFT_REPLAY_MISMATCH", "LABEL_DRAFT_REPLAY_MISMATCH", 409],
    ["LABEL_DRAFT_ALREADY_PROCESSED", "LABEL_DRAFT_ALREADY_PROCESSED", 409],
    ["LABEL_DRAFT_ID_CONFLICT", "LABEL_DRAFT_ID_CONFLICT", 409],
    ["LABEL_UPLOAD_RATE_LIMITED", "LABEL_UPLOAD_RATE_LIMITED", 429],
    ["FOOD_LABEL_DRAFT_INVALID_DATA", "INVALID_LABEL", 422],
  ])(
    "maps database result %s without exposing raw SQL details",
    async (databaseMessage, publicCode, status) => {
      authenticatedRpc({
        data: null,
        error: {
          code: "P0001",
          message: databaseMessage,
        },
      });

      const response = await POST(request());
      const payload = await response.json();

      expect(response.status).toBe(status);
      expect(payload.error.code).toBe(publicCode);
      expect(JSON.stringify(payload)).not.toContain("P0001");
      expect(JSON.stringify(payload)).not.toContain(userId);
    },
  );

  it("collapses unknown database failures without exposing diagnostics", async () => {
    authenticatedRpc({
      data: null,
      error: {
        code: "XX000",
        message: "secret food_label_submissions diagnostic",
      },
    });

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("LABEL_CREATE_FAILED");
    expect(JSON.stringify(payload)).not.toContain("food_label_submissions");
    expect(JSON.stringify(payload)).not.toContain("XX000");
  });

  it("requires a valid client UUID after validating visible label fields", async () => {
    const getUser = vi.fn();
    routeState.client = { auth: { getUser } };

    const response = await POST(request({ draftId: "not-a-uuid" }));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("INVALID_LABEL_DRAFT_ID");
    expect(getUser).not.toHaveBeenCalled();
  });
});
