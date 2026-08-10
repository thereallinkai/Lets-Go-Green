import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError, apiSuccess } from "@/src/lib/api-response";
import { sanitizeFoodLabelImage } from "@/src/lib/food-label-image";
import { isDevelopmentDemo } from "@/src/lib/env";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const paramsSchema = z.string().uuid();
const kindSchema = z.enum(["front", "nutrition", "ingredients"]);

type UploadReservation = {
  allowed: boolean;
  rate_limited: boolean;
  existing_image_id: string | null;
  existing_object_path: string | null;
};

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
    if (authError) {
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
    if (!auth.user) {
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
    const reserveUpload = admin.rpc.bind(admin) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: UploadReservation[] | null;
      error: { code?: string } | null;
    }>;
    const { data: reservationRows, error: reservationError } =
      await reserveUpload("reserve_food_label_upload", {
        target_user_id: auth.user.id,
        target_submission_id: id,
        target_image_kind: kind.data,
      });
    const reservation = reservationRows?.[0];
    if (reservationError || !reservation) {
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
    const { error: storageError } = await admin.storage
      .from("food-labels")
      .upload(objectPath, image.bytes, {
        contentType: image.mimeType,
        cacheControl: "3600",
        upsert: false,
      });
    if (storageError) {
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
    const { data, error } = await admin
      .from("food_label_images")
      .upsert(
        {
          submission_id: id,
          user_id: auth.user.id,
          object_path: objectPath,
          image_kind: kind.data,
          mime_type: image.mimeType,
          byte_size: image.bytes.length,
          pixel_width: image.width,
          pixel_height: image.height,
          sha256: image.sha256,
        },
        {
          onConflict: "submission_id,image_kind",
        },
      )
      .select("id,image_kind,byte_size,pixel_width,pixel_height")
      .single();
    if (error || !data) {
      await admin.storage.from("food-labels").remove([objectPath]);
      return apiError(
        "LABEL_IMAGE_SAVE_FAILED",
        "The image uploaded but its label record could not be saved.",
        500,
        {
          details:
            "The incomplete storage object was removed. The private draft remains saved; retry the same photo.",
          retryable: true,
          action: { kind: "retry", label: "Retry photo upload" },
        },
      );
    }
    if (
      reservation.existing_object_path &&
      reservation.existing_object_path !== objectPath
    ) {
      const { error: cleanupError } = await admin.storage
        .from("food-labels")
        .remove([reservation.existing_object_path]);
      if (cleanupError) {
        console.error("replaced food label image cleanup failed", {
          submissionId: id,
          imageKind: kind.data,
        });
      }
    }
    return apiSuccess(data, 201);
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
