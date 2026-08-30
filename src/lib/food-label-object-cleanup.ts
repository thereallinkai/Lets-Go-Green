import "server-only";
import type { createSupabaseAdminClient } from "@/src/lib/supabase/admin";

export type FoodLabelAdminClient = ReturnType<
  typeof createSupabaseAdminClient
>;

type TrustedFoodLabelRpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

export function trustedFoodLabelRpc(admin: FoodLabelAdminClient) {
  return admin.rpc.bind(admin) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<TrustedFoodLabelRpcResult>;
}

export async function removeKnownFoodLabelObject(
  admin: FoodLabelAdminClient,
  userId: string,
  objectPath: string,
) {
  if (!objectPath.startsWith(`${userId}/`)) {
    console.error("food label cleanup rejected an invalid owned path");
    return false;
  }
  const { error: removeError } = await admin.storage
    .from("food-labels")
    .remove([objectPath]);
  if (removeError) {
    console.error("food label object cleanup failed");
    return false;
  }
  const acknowledgement = await trustedFoodLabelRpc(admin)(
    "complete_food_label_object_cleanup",
    {
      target_user_id: userId,
      target_object_path: objectPath,
    },
  );
  if (acknowledgement.error || acknowledgement.data !== true) {
    console.error("food label object cleanup acknowledgement failed", {
      code: acknowledgement.error?.code,
    });
    return false;
  }
  return true;
}

export async function retryPendingFoodLabelObjectCleanup(
  admin: FoodLabelAdminClient,
  userId: string,
) {
  const rpc = trustedFoodLabelRpc(admin);
  const batchSize = 20;
  const maximumBatches = 5;

  for (let batch = 0; batch < maximumBatches; batch += 1) {
    const { data, error } = await rpc("pending_food_label_object_cleanup", {
      target_user_id: userId,
      result_limit: batchSize,
    });
    if (error || !Array.isArray(data)) {
      console.error("food label cleanup lookup failed", { code: error?.code });
      return false;
    }

    let batchComplete = true;
    for (const row of data) {
      const objectPath =
        row &&
        typeof row === "object" &&
        typeof (row as { object_path?: unknown }).object_path === "string"
          ? (row as { object_path: string }).object_path
          : null;
      if (!objectPath || !objectPath.startsWith(`${userId}/`)) {
        batchComplete = false;
        console.error("food label cleanup returned an invalid owned path");
        continue;
      }

      if (!(await removeKnownFoodLabelObject(admin, userId, objectPath))) {
        batchComplete = false;
      }
    }

    if (!batchComplete) return false;
    if (data.length < batchSize) return true;
  }

  const remaining = await rpc("pending_food_label_object_cleanup", {
    target_user_id: userId,
    result_limit: 1,
  });
  if (remaining.error || !Array.isArray(remaining.data)) {
    console.error("food label cleanup follow-up failed", {
      code: remaining.error?.code,
    });
    return false;
  }
  return remaining.data.length === 0;
}
