import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { isAuthSessionMissing } from "@/src/lib/auth-error-taxonomy";
import { sanitizeFoodLabelImage } from "@/src/lib/food-label-image";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const paramsSchema = z.string().uuid();
const kindSchema = z.enum(["front", "nutrition", "ingredients"]);

type UploadReservation = {
  allowed: boolean;
  rate_limited: boolean;
  reservation_token: string | null;
  object_path: string | null;
  existing_image_id: string | null;
  existing_object_path: string | null;
};

type UploadPreflight = {
  allowed: boolean;
  rate_limited: boolean;
  preflight_token: string | null;
};

type FinalizedUpload = {
  accepted: boolean;
  reservation_conflict: boolean;
  image_id: string | null;
  image_kind: "front" | "nutrition" | "ingredients";
  byte_size: number | null;
  pixel_width: number | null;
  pixel_height: number | null;
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

function trustedRpc(admin: AdminClient) {
  return admin.rpc.bind(admin) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
}

async function retryPendingLabelObjectCleanup(
  admin: AdminClient,
  userId: string,
) {
  const rpc = trustedRpc(admin);
  const { data, error } = await rpc("pending_food_label_object_cleanup", {
    target_user_id: userId,
    result_limit: 20,
  });
  if (error || !Array.isArray(data)) {
    console.error("food label cleanup lookup failed", { code: error?.code });
    return false;
  }

  let complete = true;
  for (const row of data) {
    const objectPath =
      row && typeof row === "object" &&
      typeof (row as { object_path?: unknown }).object_path === "string"
        ? (row as { object_path: string }).object_path
        : null;
    if (!objectPath || !objectPath.startsWith(`${userId}/`)) {
      complete = false;
      console.error("food label cleanup returned an invalid owned path");
      continue;
    }

    const { error: removeError } = await admin.storage
      .from("food-labels")
      .remove([objectPath]);
    if (removeError) {
      complete = false;
      console.error("food label object cleanup failed");
      continue;
    }

    const acknowledgement = await rpc(
      "complete_food_label_object_cleanup",
      {
        target_user_id: userId,
        target_object_path: objectPath,
      },
    );
    if (acknowledgement.error || acknowledgement.data !== true) {
      complete = false;
      console.error("food label object cleanup acknowledgement failed", {
        code: acknowledgement.error?.code,
      });
    }
  }
  return complete;
}

async function abandonLabelUpload(
  admin: AdminClient,
  userId: string,
  reservationToken: string,
) {
  const { error } = await trustedRpc(admin)("abandon_food_label_upload", {
    target_user_id: userId,
    target_reservation_token: reservationToken,
  });
  if (error) {
    console.error("food label upload abandonment failed", { code: error.code });
  }
  return retryPendingLabelObjectCleanup(admin, userId);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!paramsSchema.safeParse(id).success) {
    return apiError("INVALID_LABEL_ID", "The label draft ID is invalid.", 422, {
      details: "Return to the package-label form and start a new submission.",
      retryable: false,
      action: { kind: "edit", label: "Start a new label submission" },
    });
  }
  if (isDevelopmentDemo()) {
    return apiError(
      "LABEL_UPLOAD_REQUIRES_LOCAL_STACK",
      "Start the local Supabase stack before uploading a label.",
      503,
      {
        details:
          "Run npm run dev:all, wait for the readiness message, then retry the unchanged photo.",
        retryable: true,
        action: { kind: "restart", label: "Start local services, then retry" },
      },
    );
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) {
      return apiError(
        "LABEL_AUTH_UNAVAILABLE",
        "Your session could not be checked for photo upload.",
        503,
        {
          details: "The draft was not changed. Check the connection and retry.",
          retryable: true,
          action: { kind: "retry", label: "Retry photo upload" },
        },
      );
    }
    if (!auth.user || isAuthSessionMissing(authError)) {
      return apiError("SESSION_EXPIRED", "Log in before uploading a label.", 401, {
        details: "The private draft and selected photo were not changed.",
        retryable: false,
        action: { kind: "navigate", label: "Log in", href: "/login" },
      });
    }
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("multipart/form-data")
    ) {
      return apiError(
        "INVALID_LABEL_IMAGE",
        "Send the label image as multipart form data.",
        415,
        {
          details:
            "The upload request did not contain a supported photo form. Return to the label form and choose the image again.",
          retryable: false,
          action: { kind: "edit", label: "Choose the photo again" },
        },
      );
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 9 * 1024 * 1024) {
      return apiError(
        "LABEL_IMAGE_TOO_LARGE",
        "Use a JPEG or PNG under 8 MB.",
        413,
        {
          details:
            "The request exceeded the upload limit before processing. Resize or recompress the photo, then choose it again.",
          retryable: false,
          action: { kind: "edit", label: "Choose a smaller photo" },
        },
      );
    }
    const { data: submission, error: submissionError } = await supabase
      .from("food_label_submissions")
      .select("id,status")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .in("status", ["draft", "needs_changes"])
      .maybeSingle();
    if (submissionError) {
      return apiError(
        "LABEL_DRAFT_LOOKUP_FAILED",
        "The private label draft could not be checked.",
        503,
        {
          details: "No photo was uploaded. Check the connection and retry.",
          retryable: true,
          action: { kind: "retry", label: "Retry photo upload" },
        },
      );
    }
    if (!submission) {
      return apiError(
        "LABEL_NOT_EDITABLE",
        "That label draft is no longer available for upload.",
        409,
        {
          details:
            "It may already be confirmed, belong to another session, or require a new submission. Do not keep retrying this draft.",
          retryable: false,
          action: { kind: "edit", label: "Start a new label submission" },
        },
      );
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(
        "INVALID_LABEL_IMAGE",
        "The image upload was incomplete or exceeded the supported request size.",
        413,
        {
          details:
            "Choose the JPEG or PNG again. It must be under 8 MB and show the complete label.",
          retryable: false,
          action: { kind: "edit", label: "Choose the photo again" },
        },
      );
    }
    const file = form.get("file");
    const kind = kindSchema.safeParse(form.get("imageKind"));
    if (
      !(file instanceof File) ||
      file.size < 1 ||
      file.size > 8 * 1024 * 1024 ||
      !kind.success
    ) {
      return apiError(
        "INVALID_LABEL_IMAGE",
        "Choose a JPEG or PNG nutrition-label image.",
        422,
        {
          details:
            "The file was empty, too large, unsupported, or missing the nutrition-label image type.",
          retryable: false,
          action: { kind: "edit", label: "Choose a valid label photo" },
        },
      );
    }

    const admin = createSupabaseAdminClient();
    const preflightResult = await trustedRpc(admin)(
      "preflight_food_label_upload",
      {
        target_user_id: auth.user.id,
        target_submission_id: id,
        target_image_kind: kind.data,
      },
    );
    const preflight = Array.isArray(preflightResult.data)
      ? (preflightResult.data[0] as UploadPreflight | undefined)
      : undefined;
    if (preflightResult.error || !preflight) {
      return apiError(
        "LABEL_UPLOAD_RESERVATION_FAILED",
        "The label-image allowance could not be checked.",
        503,
        {
          details: "No photo was processed or uploaded. Check the connection and retry.",
          retryable: true,
          action: { kind: "retry", label: "Retry photo upload" },
        },
      );
    }
    if (!preflight.allowed || preflight.rate_limited) {
      return apiError(
        "LABEL_IMAGE_RATE_LIMITED",
        "You reached the private label-image limit. Wait before uploading another image.",
        429,
        {
          details:
            "The selected photo was not processed or stored. Wait before trying again so another attempt does not extend the temporary limit.",
          retryable: true,
          action: { kind: "wait", label: "Wait, then try again" },
        },
      );
    }
    if (!preflight.preflight_token) {
      return apiError(
        "LABEL_UPLOAD_RESERVATION_FAILED",
        "The label-image allowance could not be checked.",
        503,
        {
          details: "No photo was processed or uploaded. Check the connection and retry.",
          retryable: true,
          action: { kind: "retry", label: "Retry photo upload" },
        },
      );
    }

    let image;
    try {
      image = await sanitizeFoodLabelImage(
        Buffer.from(await file.arrayBuffer()),
        file.type,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason === "image_dimensions_not_supported") {
        return apiError(
          "LABEL_IMAGE_RESOLUTION_TOO_LOW",
          "Use a clearer label photo at least 480 pixels wide and tall, under 8 MB and 20 megapixels.",
          422,
          {
            details:
              "The selected image is too small for reliable manual review. Retake the full panel closer and in focus.",
            retryable: false,
            action: { kind: "edit", label: "Take a clearer photo" },
          },
        );
      }
      if (reason === "image_contrast_too_low") {
        return apiError(
          "LABEL_IMAGE_CONTRAST_TOO_LOW",
          "The label photo does not have enough visible contrast. Retake it in even light with the printed text in focus.",
          422,
          {
            details:
              "Avoid glare, shadows, blank frames, and washed-out text. No nutrition values were guessed from this image.",
            retryable: false,
            action: { kind: "edit", label: "Retake the label photo" },
          },
        );
      }
      return apiError(
        "INVALID_LABEL_IMAGE",
        "Use a valid JPEG or PNG under 8 MB and 20 megapixels.",
        422,
        {
          details:
            "The image could not be decoded safely. Export or retake it as JPEG or PNG, then choose it again.",
          retryable: false,
          action: { kind: "edit", label: "Choose another photo" },
        },
      );
    }
    const objectPath = `${auth.user.id}/${id}/${randomUUID()}.${image.extension}`;
    const reservationResult = await trustedRpc(admin)(
      "begin_food_label_upload",
      {
        target_user_id: auth.user.id,
        target_submission_id: id,
        target_image_kind: kind.data,
        target_preflight_token: preflight.preflight_token,
        target_object_path: objectPath,
        target_sha256: image.sha256,
      },
    );
    const reservation = Array.isArray(reservationResult.data)
      ? (reservationResult.data[0] as UploadReservation | undefined)
      : undefined;
    if (
      reservationResult.error ||
      !reservation ||
      (reservation.allowed &&
        (!reservation.reservation_token || reservation.object_path !== objectPath))
    ) {
      return apiError(
        "LABEL_UPLOAD_RESERVATION_FAILED",
        "The label-image allowance could not be checked.",
        503,
        {
          details: "No photo was uploaded. Check the connection and retry.",
          retryable: true,
          action: { kind: "retry", label: "Retry photo upload" },
        },
      );
    }
    if (!reservation.allowed || reservation.rate_limited) {
      return apiError(
        "LABEL_IMAGE_RATE_LIMITED",
        "You reached the private label-image limit. Wait before uploading another image.",
        429,
        {
          details:
            "No new photo was stored. Wait before trying again so another attempt does not extend the temporary limit.",
          retryable: true,
          action: { kind: "wait", label: "Wait, then try again" },
        },
      );
    }
    const reservationToken = reservation.reservation_token!;
    await retryPendingLabelObjectCleanup(admin, auth.user.id);

    const { error: storageError } = await admin.storage
      .from("food-labels")
      .upload(objectPath, image.bytes, {
        contentType: image.mimeType,
        cacheControl: "3600",
        upsert: false,
      });
    if (storageError) {
      await abandonLabelUpload(admin, auth.user.id, reservationToken);
      return apiError(
        "LABEL_IMAGE_UPLOAD_FAILED",
        "The label image could not be uploaded.",
        500,
        {
          details:
            "The private draft remains saved. Check the connection and retry the same photo.",
          retryable: true,
          action: { kind: "retry", label: "Retry photo upload" },
        },
      );
    }
    const storedResult = await trustedRpc(admin)(
      "mark_food_label_upload_stored",
      {
        target_user_id: auth.user.id,
        target_reservation_token: reservationToken,
      },
    );
    if (storedResult.error || storedResult.data !== true) {
      await abandonLabelUpload(admin, auth.user.id, reservationToken);
      if (!storedResult.error && storedResult.data === false) {
        return apiError(
          "LABEL_UPLOAD_SUPERSEDED",
          "A newer photo replaced this upload before it finished.",
          409,
          {
            details:
              "The older private object was queued for deletion and was not attached to the draft. Keep the newest photo shown in the form or upload it again if needed.",
            retryable: false,
            action: { kind: "edit", label: "Keep the newest photo" },
          },
        );
      }
      await retryPendingLabelObjectCleanup(admin, auth.user.id);
      return apiError(
        "LABEL_IMAGE_SAVE_FAILED",
        "The uploaded image could not be attached to the private draft.",
        503,
        {
          details:
            "Its unique object path was recorded for cleanup and the previous label image remains unchanged. Check the connection, then retry the same photo.",
          retryable: true,
          action: { kind: "retry", label: "Retry photo upload" },
        },
      );
    }

    const finalizeResult = await trustedRpc(admin)(
      "finalize_food_label_upload",
      {
        target_user_id: auth.user.id,
        target_submission_id: id,
        target_reservation_token: reservationToken,
        target_mime_type: image.mimeType,
        target_byte_size: image.bytes.length,
        target_pixel_width: image.width,
        target_pixel_height: image.height,
        target_sha256: image.sha256,
      },
    );
    const finalized = Array.isArray(finalizeResult.data)
      ? (finalizeResult.data[0] as FinalizedUpload | undefined)
      : undefined;
    if (finalizeResult.error || !finalized) {
      await abandonLabelUpload(admin, auth.user.id, reservationToken);
      return apiError(
        "LABEL_IMAGE_SAVE_FAILED",
        "The image uploaded but its label record could not be saved.",
        503,
        {
          details:
            "The unique object path remains durably tracked for cleanup and the previous label image remains unchanged. Check the connection, then retry the same photo.",
          retryable: true,
          action: { kind: "retry", label: "Retry photo upload" },
        },
      );
    }
    if (!finalized.accepted || finalized.reservation_conflict) {
      await retryPendingLabelObjectCleanup(admin, auth.user.id);
      return apiError(
        "LABEL_UPLOAD_SUPERSEDED",
        "A newer photo replaced this upload before it finished.",
        409,
        {
          details:
            "The losing private object was queued for deletion and was not attached to the draft. Keep the newest photo shown in the form or upload it again if needed.",
          retryable: false,
          action: { kind: "edit", label: "Keep the newest photo" },
        },
      );
    }
    const cleanupComplete = await retryPendingLabelObjectCleanup(
      admin,
      auth.user.id,
    );
    return apiSuccess(
      {
        id: finalized.image_id,
        image_kind: finalized.image_kind,
        byte_size: finalized.byte_size,
        pixel_width: finalized.pixel_width,
        pixel_height: finalized.pixel_height,
        cleanup_pending: !cleanupComplete,
      },
      201,
    );
  } catch {
    return apiError(
      "SERVICE_UNAVAILABLE",
      "Label-upload services are temporarily unavailable.",
      503,
      {
        details:
          "The private draft remains unchanged. Check the connection and retry the photo upload.",
        retryable: true,
        action: { kind: "retry", label: "Retry photo upload" },
      },
    );
  }
}
