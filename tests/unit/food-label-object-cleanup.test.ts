import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { retryPendingFoodLabelObjectCleanup } from "../../src/lib/food-label-object-cleanup";

const userId = "11111111-1111-4111-8111-111111111111";

describe("food-label object cleanup", () => {
  it("drains a second page before reporting cleanup complete", async () => {
    const paths = Array.from(
      { length: 21 },
      (_, index) =>
        `${userId}/22222222-2222-4222-8222-222222222222/00000000-0000-4000-8000-${String(index).padStart(12, "0")}.png`,
    );
    let pendingCall = 0;
    const rpc = vi.fn(async (name: string) => {
      if (name === "pending_food_label_object_cleanup") {
        const page = pendingCall === 0 ? paths.slice(0, 20) : paths.slice(20);
        pendingCall += 1;
        return {
          data: page.map((object_path) => ({ object_path })),
          error: null,
        };
      }
      return { data: true, error: null };
    });
    const remove = vi.fn(async () => ({ error: null }));
    const admin = {
      rpc,
      storage: { from: vi.fn(() => ({ remove })) },
    };

    const complete = await retryPendingFoodLabelObjectCleanup(
      admin as never,
      userId,
    );

    expect(complete).toBe(true);
    expect(pendingCall).toBe(2);
    expect(remove).toHaveBeenCalledTimes(21);
    expect(
      rpc.mock.calls.filter(
        ([name]) => name === "complete_food_label_object_cleanup",
      ),
    ).toHaveLength(21);
  });

  it("rejects a cleanup path outside the authenticated account prefix", async () => {
    const rpc = vi.fn(async (name: string) =>
      name === "pending_food_label_object_cleanup"
        ? {
            data: [
              {
                object_path:
                  "99999999-9999-4999-8999-999999999999/draft/photo.png",
              },
            ],
            error: null,
          }
        : { data: true, error: null },
    );
    const remove = vi.fn(async () => ({ error: null }));
    const admin = {
      rpc,
      storage: { from: vi.fn(() => ({ remove })) },
    };

    expect(
      await retryPendingFoodLabelObjectCleanup(admin as never, userId),
    ).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
