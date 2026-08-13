import { beforeEach, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";

const state = vi.hoisted(() => ({
  authResult: {
    data: {
      user: { id: "11111111-1111-4111-8111-111111111111" } as {
        id: string;
      } | null,
    },
    error: null as {
      code?: string;
      message?: string;
      name?: string;
      status?: number;
    } | null,
  },
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  sanitize: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/env", () => ({
  isDevelopmentDemo: () => false,
}));

vi.mock("@/src/lib/food-label-image", () => ({
  sanitizeFoodLabelImage: state.sanitize,
}));

vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const draft = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: { id: "22222222-2222-4222-8222-222222222222", status: "draft" },
        error: null,
      })),
    };
    draft.select.mockReturnValue(draft);
    draft.eq.mockReturnValue(draft);
    draft.in.mockReturnValue(draft);
    return {
      auth: {
        getUser: async () => state.authResult,
      },
      from: vi.fn(() => draft),
    };
  },
}));

vi.mock("@/src/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: state.rpc,
    storage: {
      from: vi.fn(() => ({
        upload: state.upload,
        remove: state.remove,
      })),
    },
  }),
}));

import { POST } from "../../app/api/food-labels/[id]/images/route";

const userId = "11111111-1111-4111-8111-111111111111";
const submissionId = "22222222-2222-4222-8222-222222222222";
const preflightToken = "33333333-3333-4333-8333-333333333333";
const reservationToken = "44444444-4444-4444-8444-444444444444";

function uploadRequest() {
  const boundary = "lets-go-green-label-boundary";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="imageKind"',
    "",
    "nutrition",
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="label.png"',
    "Content-Type: image/png",
    "",
    "label-bytes",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return new Request(`http://localhost/api/food-labels/${submissionId}/images`, {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
}

async function callRoute() {
  return POST(uploadRequest(), {
    params: Promise.resolve({ id: submissionId }),
  });
}

function preflightRow() {
  return {
    allowed: true,
    rate_limited: false,
    preflight_token: preflightToken,
  };
}

beforeEach(() => {
  vi.stubGlobal("File", NodeFile);
  state.authResult = {
    data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
    error: null,
  };
  state.rpc.mockReset();
  state.upload.mockReset();
  state.remove.mockReset();
  state.sanitize.mockReset();
  state.sanitize.mockResolvedValue({
    bytes: Buffer.from([4, 5, 6]),
    extension: "png",
    mimeType: "image/png",
    width: 800,
    height: 900,
    sha256: "a".repeat(64),
  });
  state.upload.mockResolvedValue({ error: null });
  state.remove.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("food label image upload coordination", () => {
  it("classifies auth-js AuthSessionMissingError as a signed-out request", async () => {
    state.authResult = {
      data: { user: null },
      error: {
        name: "AuthSessionMissingError",
        status: 400,
        message: "Auth session missing!",
      },
    };

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("SESSION_EXPIRED");
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.sanitize).not.toHaveBeenCalled();
  });

  it("checks the trusted rate limit before decoding or sanitizing the image", async () => {
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "preflight_food_label_upload") {
        return {
          data: [{ allowed: false, rate_limited: true, preflight_token: null }],
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("LABEL_IMAGE_RATE_LIMITED");
    expect(state.sanitize).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("finalizes the latest token and acknowledges cleanup only after deletion", async () => {
    const oldPath = `${userId}/${submissionId}/55555555-5555-4555-8555-555555555555.png`;
    const events: string[] = [];
    let pendingCalls = 0;
    let attemptPath = "";
    state.rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === "preflight_food_label_upload") {
          return { data: [preflightRow()], error: null };
        }
        if (name === "begin_food_label_upload") {
          attemptPath = String(args.target_object_path);
          return {
            data: [{
              allowed: true,
              rate_limited: false,
              reservation_token: reservationToken,
              object_path: attemptPath,
              existing_image_id: null,
              existing_object_path: oldPath,
            }],
            error: null,
          };
        }
        if (name === "pending_food_label_object_cleanup") {
          pendingCalls += 1;
          return {
            data: pendingCalls === 2 ? [{ object_path: oldPath }] : [],
            error: null,
          };
        }
        if (name === "complete_food_label_object_cleanup") {
          events.push(`ack:${String(args.target_object_path)}`);
          return { data: true, error: null };
        }
        if (name === "mark_food_label_upload_stored") {
          return { data: true, error: null };
        }
        if (name === "finalize_food_label_upload") {
          return {
            data: [{
              accepted: true,
              reservation_conflict: false,
              image_id: "66666666-6666-4666-8666-666666666666",
              image_kind: "nutrition",
              byte_size: 3,
              pixel_width: 800,
              pixel_height: 900,
            }],
            error: null,
          };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
    );
    state.remove.mockImplementation(async ([path]: string[]) => {
      events.push(`remove:${path}`);
      return { error: null };
    });

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      image_kind: "nutrition",
      cleanup_pending: false,
    });
    expect(attemptPath).toMatch(
      new RegExp(`^${userId}/${submissionId}/[0-9a-f-]{36}[.]png$`),
    );
    expect(events).toEqual([`remove:${oldPath}`, `ack:${oldPath}`]);
  });

  it("queues and removes a stored object when storage acknowledgement is malformed", async () => {
    let attemptPath = "";
    let pendingCalls = 0;
    state.rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === "preflight_food_label_upload") {
          return { data: [preflightRow()], error: null };
        }
        if (name === "begin_food_label_upload") {
          attemptPath = String(args.target_object_path);
          return {
            data: [{
              allowed: true,
              rate_limited: false,
              reservation_token: reservationToken,
              object_path: attemptPath,
              existing_image_id: null,
              existing_object_path: null,
            }],
            error: null,
          };
        }
        if (name === "pending_food_label_object_cleanup") {
          pendingCalls += 1;
          return {
            data: pendingCalls > 1 ? [{ object_path: attemptPath }] : [],
            error: null,
          };
        }
        if (name === "mark_food_label_upload_stored") {
          return { data: "not-a-boolean", error: null };
        }
        if (name === "abandon_food_label_upload") {
          return { data: true, error: null };
        }
        if (name === "complete_food_label_object_cleanup") {
          return { data: true, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
    );

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("LABEL_IMAGE_SAVE_FAILED");
    expect(state.remove).toHaveBeenCalledWith([attemptPath]);
    expect(state.rpc).not.toHaveBeenCalledWith(
      "finalize_food_label_upload",
      expect.anything(),
    );
  });

  it("keeps failed cleanup durably pending and never acknowledges it", async () => {
    const oldPath = `${userId}/${submissionId}/77777777-7777-4777-8777-777777777777.png`;
    let pendingCalls = 0;
    state.rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === "preflight_food_label_upload") {
          return { data: [preflightRow()], error: null };
        }
        if (name === "begin_food_label_upload") {
          return {
            data: [{
              allowed: true,
              rate_limited: false,
              reservation_token: reservationToken,
              object_path: String(args.target_object_path),
              existing_image_id: null,
              existing_object_path: oldPath,
            }],
            error: null,
          };
        }
        if (name === "pending_food_label_object_cleanup") {
          pendingCalls += 1;
          return {
            data: pendingCalls === 2 ? [{ object_path: oldPath }] : [],
            error: null,
          };
        }
        if (name === "mark_food_label_upload_stored") {
          return { data: true, error: null };
        }
        if (name === "finalize_food_label_upload") {
          return {
            data: [{
              accepted: true,
              reservation_conflict: false,
              image_id: "88888888-8888-4888-8888-888888888888",
              image_kind: "nutrition",
              byte_size: 3,
              pixel_width: 800,
              pixel_height: 900,
            }],
            error: null,
          };
        }
        if (name === "complete_food_label_object_cleanup") {
          throw new Error("cleanup must not be acknowledged");
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
    );
    state.remove.mockResolvedValue({ error: { message: "temporary failure" } });

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.cleanup_pending).toBe(true);
    expect(state.rpc).not.toHaveBeenCalledWith(
      "complete_food_label_object_cleanup",
      expect.anything(),
    );
  });
});
