"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiErrorNotice } from "@/components/api-error-notice";
import styles from "@/components/food-discovery.module.css";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromPayload,
  clientApiError,
} from "@/src/lib/client-api-error";
import type { FoodLabelData } from "@/src/lib/domain/food-label";
import {
  FoodLabelOcrClientError,
  inspectFoodLabelImage,
  recognizeFoodLabelInBrowser,
  type FoodLabelOcrProgress,
} from "@/src/lib/food-label-ocr-client";
import {
  foodLabelOcrFieldLabels,
  type FoodLabelOcrField,
  type FoodLabelOcrResult,
  type FoodLabelOcrValue,
} from "@/src/lib/food-label-ocr";

type ApiEnvelope<T> = { data?: T | null; error?: unknown } | null;

type ResumeState = {
  draftId: string;
  labelFingerprint: string;
  imageUploaded: boolean;
};

type DraftAttempt = {
  draftId: string;
  labelFingerprint: string;
};

type CatalogRefresh = { foodId: string; displayName: string };

const fieldLabels: Record<string, string> = {
  brandName: "Brand",
  productName: "Product",
  nutritionImage: "Package-label photo",
  servingWeightGrams: "Serving weight",
  calories: "Calories",
  proteinGrams: "Protein",
  carbohydrateGrams: "Carbohydrate",
  fatGrams: "Total fat",
  ingredientsText: "Ingredients",
  allergenStatement: "Package allergen statement",
  categorySlugs: "Food category",
  allergensReviewed: "Allergen review confirmation",
  restrictionsReviewed: "Diet review confirmation",
};

const optionalNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);

function invalidFieldNames(form: HTMLFormElement) {
  const names = Array.from(form.elements).flatMap((element) => {
    if (
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) ||
      element.name === "nutritionImage" ||
      element.checkValidity()
    ) {
      return [];
    }
    return [fieldLabels[element.name] ?? "A highlighted field"];
  });
  return [...new Set(names)].slice(0, 5);
}

const categories = [
  ["carbohydrate", "Carbohydrate"],
  ["protein", "Protein"],
  ["vegetable", "Vegetable"],
  ["fruit", "Fruit"],
  ["fat", "Fat"],
  ["dairy", "Dairy"],
  ["supplement", "Supplement"],
] as const;

const allergens = [
  ["milk", "Milk"],
  ["egg", "Egg"],
  ["fish", "Fish"],
  ["shellfish", "Shellfish"],
  ["tree-nuts", "Tree nuts"],
  ["peanuts", "Peanuts"],
  ["wheat", "Wheat"],
  ["soy", "Soy"],
  ["sesame", "Sesame"],
] as const;

const restrictions = [
  ["vegetarian", "Vegetarian"],
  ["vegan", "Vegan"],
  ["pescatarian", "Pescatarian"],
  ["gluten-free", "Gluten-free"],
  ["dairy-free", "Dairy-free"],
] as const;

export function FoodLabelUpload({
  onCreated,
}: {
  onCreated?: (
    foodId: string,
    displayName: string,
  ) => unknown | Promise<unknown>;
}) {
  const idPrefix = useId();
  const photoHeadingId = `${idPrefix}-label-photo-heading`;
  const photoRequirementsId = `${idPrefix}-label-photo-requirements`;
  const photoPrivacyId = `${idPrefix}-label-photo-privacy`;
  const recognitionHeadingId = `${idPrefix}-automatic-label-reading-heading`;
  const manualHeadingId = `${idPrefix}-manual-label-heading`;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recognition, setRecognition] = useState<FoodLabelOcrResult | null>(null);
  const [recognitionPending, setRecognitionPending] = useState(false);
  const [photoPreflightPending, setPhotoPreflightPending] = useState(false);
  const [recognitionProgress, setRecognitionProgress] =
    useState<FoodLabelOcrProgress | null>(null);
  const [skippedOcrFields, setSkippedOcrFields] = useState<string[]>([]);
  const [resume, setResume] = useState<ResumeState | null>(null);
  const [catalogRefresh, setCatalogRefresh] =
    useState<CatalogRefresh | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const recognitionAbortRef = useRef<AbortController | null>(null);
  const recognitionTaskRef = useRef<Promise<void> | null>(null);
  const recognitionRequestRef = useRef(0);
  const photoPreflightAbortRef = useRef<AbortController | null>(null);
  const photoSelectionRequestRef = useRef(0);
  const appliedOcrValuesRef = useRef<
    Partial<Record<FoodLabelOcrField, string>>
  >({});
  const draftAttemptRef = useRef<DraftAttempt | null>(null);

  function reportError(nextError: ApiError, options: { focus?: boolean } = {}) {
    setMessage(null);
    setError(nextError);
    if (options.focus !== false) {
      const focusOrigin = document.activeElement;
      window.requestAnimationFrame(() => {
        if (
          document.activeElement === focusOrigin ||
          document.activeElement === document.body
        ) {
          errorRef.current?.focus();
        }
      });
    }
  }

  function releasePreview() {
    if (previewUrlRef.current && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = null;
    setPreviewUrl(null);
  }

  useEffect(
    () => () => {
      recognitionRequestRef.current += 1;
      recognitionAbortRef.current?.abort();
      photoSelectionRequestRef.current += 1;
      photoPreflightAbortRef.current?.abort();
      if (previewUrlRef.current && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    },
    [],
  );

  function namedTextControl(name: FoodLabelOcrField) {
    const control = formRef.current?.elements.namedItem(name);
    return control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement
      ? control
      : null;
  }

  function clearAppliedOcrValues() {
    for (const [field, appliedValue] of Object.entries(
      appliedOcrValuesRef.current,
    ) as Array<[FoodLabelOcrField, string]>) {
      const control = namedTextControl(field);
      if (control?.value === appliedValue) control.value = "";
    }
    appliedOcrValuesRef.current = {};
  }

  function applyOcrValues(result: FoodLabelOcrResult) {
    const applied: Partial<Record<FoodLabelOcrField, string>> = {};
    const skipped: string[] = [];
    for (const [field, value] of Object.entries(result.values) as Array<
      [FoodLabelOcrField, FoodLabelOcrValue]
    >) {
      const control = namedTextControl(field);
      if (!control) continue;
      const nextValue = String(value);
      if (control.value.trim() && control.value !== nextValue) {
        skipped.push(foodLabelOcrFieldLabels[field]);
        continue;
      }
      control.value = nextValue;
      applied[field] = nextValue;
    }
    appliedOcrValuesRef.current = applied;
    setSkippedOcrFields(skipped);
  }

  function cancelRecognition(announce = true) {
    recognitionRequestRef.current += 1;
    recognitionAbortRef.current?.abort();
    recognitionAbortRef.current = null;
    setRecognitionPending(false);
    setRecognitionProgress(
      announce
        ? { progress: 0, status: "Automatic photo reading canceled. You can retry or enter printed facts yourself." }
        : null,
    );
  }

  function reportImageInspectionError(
    imageProblem: "OCR_IMAGE_CORRUPT" | "OCR_IMAGE_TOO_LARGE" | "OCR_IMAGE_TOO_SMALL",
    options: { focus?: boolean } = {},
  ) {
    const tooSmall = imageProblem === "OCR_IMAGE_TOO_SMALL";
    const tooLarge = imageProblem === "OCR_IMAGE_TOO_LARGE";
    reportError(
      clientApiError(
        tooSmall
          ? "LABEL_IMAGE_RESOLUTION_TOO_LOW"
          : tooLarge
            ? "LABEL_IMAGE_PIXELS_TOO_LARGE"
            : "LABEL_IMAGE_CORRUPT",
        tooSmall
          ? "Use a clearer photo at least 480 pixels wide and tall."
          : tooLarge
            ? "Use a label photo no larger than 20 megapixels or 20,000 pixels on either side."
            : "This JPEG or PNG has an unreadable or damaged image header.",
        tooSmall
          ? "Retake the full label closer and in focus. The previously selected valid photo, if any, is unchanged."
          : tooLarge
            ? "Resize the photo before trying again. It was rejected before decoding, and the previously selected valid photo, if any, is unchanged."
            : "Export or retake the panel as a valid JPEG or PNG. The previously selected valid photo, if any, is unchanged.",
        {
          retryable: false,
          action: { kind: "edit", label: "Choose another photo" },
        },
      ),
      options,
    );
  }

  function analyzePhoto(file: File) {
    clearAppliedOcrValues();
    recognitionRequestRef.current += 1;
    const requestId = recognitionRequestRef.current;
    const previousTask = recognitionTaskRef.current;
    recognitionAbortRef.current?.abort();
    const controller = new AbortController();
    recognitionAbortRef.current = controller;
    setRecognition(null);
    setSkippedOcrFields([]);
    setRecognitionPending(true);
    setRecognitionProgress({
      progress: 0,
      status: "Starting private on-device label reading…",
    });
    setConfirmed(false);
    setError(null);

    const task = (async () => {
      // The client resolves an aborted attempt only after its worker termination
      // has completed. Waiting here guarantees that replacement and retry never
      // create two OCR workers at the same time.
      await previousTask?.catch(() => undefined);
      if (
        recognitionRequestRef.current !== requestId ||
        controller.signal.aborted
      ) {
        return;
      }

      try {
        const result = await recognizeFoodLabelInBrowser(file, {
          signal: controller.signal,
          onProgress(progress) {
            if (recognitionRequestRef.current === requestId) {
              setRecognitionProgress(progress);
            }
          },
        });
        if (recognitionRequestRef.current !== requestId) return;
        setRecognition(result);
        setConfirmed(false);
        applyOcrValues(result);
      } catch (recognitionError) {
        if (
          recognitionRequestRef.current !== requestId ||
          (recognitionError instanceof FoodLabelOcrClientError &&
            recognitionError.code === "OCR_ABORTED")
        ) {
          return;
        }
        const assetsUnavailable =
          recognitionError instanceof FoodLabelOcrClientError &&
          recognitionError.code === "OCR_ASSETS_UNAVAILABLE";
        const imageProblem =
          recognitionError instanceof FoodLabelOcrClientError
            ? recognitionError.code
            : null;
        if (
          imageProblem === "OCR_IMAGE_CORRUPT" ||
          imageProblem === "OCR_IMAGE_TOO_LARGE" ||
          imageProblem === "OCR_IMAGE_TOO_SMALL"
        ) {
          reportImageInspectionError(imageProblem, { focus: false });
          return;
        }
        const timedOut = imageProblem === "OCR_TIMEOUT";
        const downscaleFailed = imageProblem === "OCR_DOWNSCALE_FAILED";
        reportError(
          clientApiError(
            assetsUnavailable
              ? "LABEL_READER_ASSETS_UNAVAILABLE"
              : timedOut
                ? "LABEL_RECOGNITION_TIMED_OUT"
                : downscaleFailed
                  ? "LABEL_IMAGE_DOWNSCALE_FAILED"
                  : "LABEL_RECOGNITION_FAILED",
            assetsUnavailable
              ? "The private label reader is unavailable in this development session."
              : timedOut
                ? "The private label reader stopped after 60 seconds."
                : downscaleFailed
                  ? "This browser could not resize the large photo safely for local reading."
                  : "The private label reader could not finish this photo.",
            assetsUnavailable
              ? "Run npm run ocr:assets and restart the app, then retry. The photo stayed on this device and you can still enter printed facts yourself."
              : timedOut
                ? "The worker was stopped and the photo stayed on this device. Retry with a closer crop, or enter only facts you can read yourself."
                : downscaleFailed
                  ? "Crop or resize the photo, then choose it again. The current photo remains available for manual review and no value was guessed."
                  : "The photo stayed on this device and no values were guessed. Retry once, retake the panel in even light, or enter only facts you can read yourself.",
            {
              retryable: !downscaleFailed,
              action: downscaleFailed
                ? { kind: "edit", label: "Choose a cropped photo" }
                : { kind: "retry", label: "Retry private photo reading" },
            },
          ),
          { focus: false },
        );
      } finally {
        if (recognitionRequestRef.current === requestId) {
          recognitionAbortRef.current = null;
          setRecognitionPending(false);
        }
      }
    })();
    recognitionTaskRef.current = task;
    return task;
  }

  async function selectPhoto(file: File | undefined, input: HTMLInputElement) {
    if (!file) return;
    photoSelectionRequestRef.current += 1;
    const requestId = photoSelectionRequestRef.current;
    photoPreflightAbortRef.current?.abort();
    photoPreflightAbortRef.current = null;
    setPhotoPreflightPending(false);
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      input.value = "";
      reportError(
        clientApiError(
          "LABEL_IMAGE_TYPE_UNSUPPORTED",
          "This package-label photo type is not supported.",
          "Choose a JPEG or PNG image. The previously selected valid photo, if any, is unchanged.",
          {
            retryable: false,
            action: { kind: "edit", label: "Choose a JPEG or PNG" },
          },
        ),
      );
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      input.value = "";
      reportError(
        clientApiError(
          "LABEL_IMAGE_TOO_LARGE",
          "This package-label photo is larger than 8 MB.",
          "Choose a smaller JPEG or PNG. The previously selected valid photo, if any, is unchanged.",
          {
            retryable: false,
            action: { kind: "edit", label: "Choose a smaller photo" },
          },
        ),
      );
      return;
    }
    const controller = new AbortController();
    photoPreflightAbortRef.current = controller;
    setPhotoPreflightPending(true);
    setError(null);
    try {
      await inspectFoodLabelImage(file, controller.signal);
    } catch (inspectionError) {
      if (
        photoSelectionRequestRef.current !== requestId ||
        (inspectionError instanceof FoodLabelOcrClientError &&
          inspectionError.code === "OCR_ABORTED")
      ) {
        return;
      }
      input.value = "";
      if (
        inspectionError instanceof FoodLabelOcrClientError &&
        (inspectionError.code === "OCR_IMAGE_CORRUPT" ||
          inspectionError.code === "OCR_IMAGE_TOO_LARGE" ||
          inspectionError.code === "OCR_IMAGE_TOO_SMALL")
      ) {
        reportImageInspectionError(inspectionError.code);
      } else {
        reportError(
          clientApiError(
            "LABEL_IMAGE_PREFLIGHT_FAILED",
            "The package-label photo could not be checked safely.",
            "Choose the JPEG or PNG again. The previously selected valid photo, if any, is unchanged.",
            {
              retryable: true,
              action: { kind: "retry", label: "Choose the photo again" },
            },
          ),
        );
      }
      return;
    } finally {
      if (photoSelectionRequestRef.current === requestId) {
        photoPreflightAbortRef.current = null;
        setPhotoPreflightPending(false);
      }
    }
    if (photoSelectionRequestRef.current !== requestId) return;
    // The selected File is held in component state. Clearing the native input
    // lets a user choose the same image again and prevents a rejected
    // replacement from making browser constraint validation disagree with the
    // still-valid photo in state.
    input.value = "";
    cancelRecognition(false);
    clearAppliedOcrValues();
    releasePreview();
    setError(null);
    setCatalogRefresh(null);
    setPhotoName(null);
    setSelectedPhoto(null);
    setConfirmed(false);
    setMessage(null);
    setResume((current) =>
      current ? { ...current, imageUploaded: false } : null,
    );
    setPhotoName(file.name);
    setSelectedPhoto(file);
    if (typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    }
    void analyzePhoto(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (photoPreflightPending) {
      reportError(
        clientApiError(
          "LABEL_IMAGE_PREFLIGHT_IN_PROGRESS",
          "The new photo is still being checked safely.",
          "Wait for its dimensions and image header to be checked before saving. The previous valid photo has not been replaced yet.",
          {
            retryable: false,
            action: { kind: "edit", label: "Wait for the photo check" },
          },
        ),
      );
      return;
    }
    if (recognitionPending) {
      reportError(
        clientApiError(
          "LABEL_RECOGNITION_IN_PROGRESS",
          "The private label reader is still checking this photo.",
          "Wait for the reading to finish or cancel it before reviewing and saving the printed facts.",
          {
            retryable: false,
            action: { kind: "edit", label: "Wait or cancel photo reading" },
          },
        ),
      );
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = selectedPhoto;
    setError(null);
    setCatalogRefresh(null);
    if (!file || !file.size) {
      reportError(
        clientApiError(
          "LABEL_IMAGE_REQUIRED",
          "A package-label photo is required.",
          "Take or choose a clear JPEG or PNG showing the full Nutrition Facts panel before saving this food.",
          {
            retryable: false,
            action: { kind: "edit", label: "Choose a package-label photo" },
          },
        ),
      );
      return;
    }
    if (!confirmed) {
      reportError(
        clientApiError(
          "LABEL_TRANSCRIPTION_UNCONFIRMED",
          "The package transcription has not been confirmed.",
          "Review the serving nutrition, ingredients, and allergen statement, then select the final accuracy-confirmation checkbox.",
          {
            retryable: false,
            action: { kind: "edit", label: "Review the confirmation" },
          },
        ),
      );
      return;
    }
    const invalidFields = invalidFieldNames(formElement);
    if (invalidFields.length) {
      reportError(
        clientApiError(
          "LABEL_FIELDS_INCOMPLETE",
          "Some package-label fields are incomplete or outside supported ranges.",
          `Complete or correct: ${invalidFields.join(", ")}. Copy only values printed on this package.`,
          {
            retryable: false,
            action: { kind: "edit", label: "Review highlighted fields" },
          },
        ),
      );
      return;
    }
    const selectedCategories = form.getAll("categorySlugs").map(String);
    if (selectedCategories.length === 0) {
      reportError(
        clientApiError(
          "LABEL_CATEGORY_REQUIRED",
          "Choose at least one food category.",
          "Select every category that clearly describes this exact product before saving.",
          {
            retryable: false,
            action: { kind: "edit", label: "Choose a food category" },
          },
        ),
      );
      return;
    }
    const number = (name: string) => Number(form.get(name));
    const optional = (name: string) =>
      optionalNumber(String(form.get(name) ?? ""));
    const labelData: FoodLabelData = {
      brandName: String(form.get("brandName") ?? "").trim(),
      productName: String(form.get("productName") ?? "").trim(),
      variantName: String(form.get("variantName") ?? "").trim(),
      gtin: "",
      packageDescription: String(form.get("packageDescription") ?? "").trim(),
      servingWeightGrams: number("servingWeightGrams"),
      servingDescription:
        String(form.get("servingDescription") ?? "").trim() || "1 serving",
      calories: number("calories"),
      energyKilojoules: optional("energyKilojoules"),
      proteinGrams: number("proteinGrams"),
      carbohydrateGrams: number("carbohydrateGrams"),
      fatGrams: number("fatGrams"),
      fiberGrams: optional("fiberGrams"),
      sodiumMilligrams: optional("sodiumMilligrams"),
      saturatedFatGrams: optional("saturatedFatGrams"),
      transFatGrams: optional("transFatGrams"),
      totalSugarsGrams: optional("totalSugarsGrams"),
      addedSugarsGrams: optional("addedSugarsGrams"),
      cholesterolMilligrams: optional("cholesterolMilligrams"),
      potassiumMilligrams: optional("potassiumMilligrams"),
      calciumMilligrams: optional("calciumMilligrams"),
      ironMilligrams: optional("ironMilligrams"),
      vitaminDMicrograms: optional("vitaminDMicrograms"),
      ingredientsText: String(form.get("ingredientsText") ?? "").trim(),
      allergenStatement: String(form.get("allergenStatement") ?? "").trim(),
      categorySlugs: selectedCategories,
      allergenSlugs: form.getAll("allergenSlugs").map(String),
      restrictionSlugs: form.getAll("restrictionSlugs").map(String),
      sourceNote: "",
      shareNormalizedProduct: form.get("shareNormalizedProduct") === "on",
      allergensReviewed: form.get("allergensReviewed") === "on",
      restrictionsReviewed: form.get("restrictionsReviewed") === "on",
      confirmedAccurate: false,
    };
    const labelFingerprint = JSON.stringify(labelData);
    let currentResume =
      resume?.labelFingerprint === labelFingerprint ? resume : null;
    let draftAttempt = draftAttemptRef.current;
    if (!currentResume && draftAttempt?.labelFingerprint !== labelFingerprint) {
      draftAttempt = {
        draftId: globalThis.crypto.randomUUID(),
        labelFingerprint,
      };
      draftAttemptRef.current = draftAttempt;
    }
    let operationFallback = clientApiError(
      "LABEL_DRAFT_NETWORK_ERROR",
      "The private label draft response was not received.",
      "Retry this unchanged form. The same one-use draft ID will be reused, so a server-committed draft is not duplicated.",
      {
        retryable: true,
        action: { kind: "retry", label: "Retry saving" },
      },
    );

    setPending(true);
    setMessage(
      currentResume
        ? "Resuming your private label submission…"
        : "Creating your private label draft…",
    );
    try {
      if (!currentResume) {
        const draftResponse = await fetch("/api/food-labels", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draftId: draftAttempt!.draftId,
            labelData,
          }),
        });
        const draft = (await draftResponse.json().catch(() => null)) as ApiEnvelope<{
          id: string;
        }>;
        if (
          !draftResponse.ok ||
          !draft?.data ||
          typeof draft.data.id !== "string" ||
          draft.data.id !== draftAttempt!.draftId
        ) {
          throw apiErrorFromPayload(
            draft,
            clientApiError(
              "LABEL_DRAFT_RESPONSE_INVALID",
              "The private label draft was not saved.",
              "The label service returned an unreadable response. Your photo and transcription remain in this browser.",
              {
                retryable: true,
                action: { kind: "retry", label: "Retry saving" },
              },
            ),
          );
        }
        currentResume = {
          draftId: draft.data.id,
          labelFingerprint,
          imageUploaded: false,
        };
        draftAttemptRef.current = null;
        setResume(currentResume);
      }

      if (!currentResume.imageUploaded) {
        operationFallback = clientApiError(
          "LABEL_IMAGE_NETWORK_ERROR",
          "The private label photo was not uploaded.",
          "The draft was saved. Check the connection and retry; the same draft will be reused.",
          {
            retryable: true,
            action: { kind: "retry", label: "Retry photo upload" },
          },
        );
        setMessage("Removing embedded metadata and uploading the private photo…");
        const imageForm = new FormData();
        imageForm.set("imageKind", "nutrition");
        imageForm.set("file", file);
        const uploadResponse = await fetch(
          `/api/food-labels/${currentResume.draftId}/images`,
          { method: "POST", body: imageForm },
        );
        const upload = (await uploadResponse.json().catch(() => null)) as ApiEnvelope<unknown>;
        if (!uploadResponse.ok || !upload?.data) {
          throw apiErrorFromPayload(
            upload,
            clientApiError(
              "LABEL_IMAGE_RESPONSE_INVALID",
              "The private label photo was not uploaded.",
              "The upload service returned an unreadable response. The draft remains saved; retry the photo upload.",
              {
                retryable: true,
                action: { kind: "retry", label: "Retry photo upload" },
              },
            ),
          );
        }
        currentResume = { ...currentResume, imageUploaded: true };
        setResume(currentResume);
      }

      operationFallback = clientApiError(
        "LABEL_CONFIRM_NETWORK_ERROR",
        "The confirmed product was not saved.",
        "The draft and private photo are saved. Check the connection and retry; they will not be uploaded again.",
        {
          retryable: true,
          action: { kind: "retry", label: "Retry confirmation" },
        },
      );
      setMessage("Saving only the package facts you confirmed…");
      const confirmResponse = await fetch(`/api/food-labels/${currentResume.draftId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          labelData: { ...labelData, confirmedAccurate: true },
        }),
      });
      const result = (await confirmResponse.json().catch(() => null)) as ApiEnvelope<{
        foodId: string;
      }>;
      if (
        !confirmResponse.ok ||
        !result?.data ||
        typeof result.data.foodId !== "string"
      ) {
        throw apiErrorFromPayload(
          result,
          clientApiError(
            "LABEL_CONFIRM_RESPONSE_INVALID",
            "The confirmed product was not saved.",
            "The confirmation service returned an unreadable response. The draft and photo remain saved for a retry.",
            {
              retryable: true,
              action: { kind: "retry", label: "Retry confirmation" },
            },
          ),
        );
      }
      const displayName = [
        labelData.brandName,
        labelData.productName,
        labelData.variantName,
      ]
        .filter(Boolean)
        .join(" ");
      setMessage(
        labelData.shareNormalizedProduct
          ? "Saved as a private food for your plans. Your opt-in to create a photo-free normalized copy for pending catalog review was recorded. The original upload was not retained as-is; server-re-encoded evidence stays private and is never shared. The shared copy cannot enter plans until approved."
          : "Saved as a private food for your plans only. The original upload was not retained as-is; server-re-encoded evidence stays private and is never shared. No shared catalog copy was requested.",
      );
      setResume(null);
      draftAttemptRef.current = null;
      formElement.reset();
      const categoryControls = Array.from(
        formElement.querySelectorAll<HTMLInputElement>(
          'input[name="categorySlugs"]',
        ),
      );
      categoryControls.forEach((control, index) => {
        control.required = index === 0;
        control.setCustomValidity("");
      });
      setConfirmed(false);
      setPhotoName(null);
      setSelectedPhoto(null);
      setRecognition(null);
      setRecognitionProgress(null);
      setSkippedOcrFields([]);
      appliedOcrValuesRef.current = {};
      releasePreview();
      try {
        const refreshed = await onCreated?.(result.data.foodId, displayName);
        if (refreshed === false) {
          throw new Error("catalog_refresh_not_confirmed");
        }
      } catch {
        const refresh = { foodId: result.data.foodId, displayName };
        setCatalogRefresh(refresh);
        reportError(
          clientApiError(
            "PRIVATE_FOOD_REFRESH_FAILED",
            `${displayName} was saved, but the current food list did not refresh.`,
            "Do not submit the label again. Retry the list refresh; the private food and photo are already saved.",
            {
              retryable: true,
              action: { kind: "retry", label: "Refresh saved foods" },
            },
          ),
        );
      }
    } catch (error) {
      reportError(apiErrorFromPayload({ error }, operationFallback));
    } finally {
      setPending(false);
    }
  }

  async function retryCatalogRefresh() {
    if (!catalogRefresh || pending) return;
    setPending(true);
    setError(null);
    setMessage("Refreshing saved foods…");
    try {
      const refreshed = await onCreated?.(
        catalogRefresh.foodId,
        catalogRefresh.displayName,
      );
      if (refreshed === false) {
        throw new Error("catalog_refresh_not_confirmed");
      }
      setCatalogRefresh(null);
      setMessage("The saved-food list is up to date.");
    } catch {
      reportError(
        clientApiError(
          "PRIVATE_FOOD_REFRESH_FAILED",
          `${catalogRefresh.displayName} is saved, but the current food list still did not refresh.`,
          "Do not submit the label again. Check the connection and retry the list refresh later.",
          {
            retryable: true,
            action: { kind: "retry", label: "Refresh saved foods" },
          },
        ),
      );
    } finally {
      setPending(false);
    }
  }

  function handleErrorAction() {
    if (error?.action?.kind === "retry") {
      if (catalogRefresh) {
        void retryCatalogRefresh();
      } else if (error.code === "LABEL_IMAGE_PREFLIGHT_FAILED") {
        photoInputRef.current?.focus();
        photoInputRef.current?.click();
      } else if (error.code.includes("RECOGNITION") || error.code.includes("READER")) {
        if (selectedPhoto) void analyzePhoto(selectedPhoto);
      } else {
        formRef.current?.requestSubmit();
      }
      return;
    }
    if (error?.action?.kind !== "edit") return;
    if (error.code === "LABEL_TRANSCRIPTION_UNCONFIRMED") {
      confirmationInputRef.current?.focus();
      return;
    }
    if (error.code.includes("IMAGE") || error.code.includes("RECOGNITION")) {
      photoInputRef.current?.focus();
      return;
    }
    const invalid = Array.from(formRef.current?.elements ?? []).find(
      (element) =>
        (element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement) &&
        !element.checkValidity(),
    );
    const target =
      invalid instanceof HTMLElement
        ? invalid
        : formRef.current?.querySelector<HTMLElement>(
            "input:not([type='hidden']), textarea, select",
          );
    target?.focus();
  }

  return (
    <form
      className={styles.labelForm}
      aria-busy={pending || recognitionPending || photoPreflightPending}
      noValidate
      onChange={(event) => {
        const changedControl = event.target as unknown;
        if (
          changedControl !== photoInputRef.current &&
          changedControl !== confirmationInputRef.current
        ) {
          setConfirmed(false);
        }
        if (changedControl !== photoInputRef.current) setError(null);
      }}
      onSubmit={submit}
      ref={formRef}
    >
      <fieldset className={styles.labelTransaction} disabled={pending}>
        <legend className="sr-only">Package-label submission</legend>
        <section className={styles.photoFirst} aria-labelledby={photoHeadingId}>
        <h3 id={photoHeadingId}>1. Start with the package label</h3>
        <p className={styles.photoIntro}>
          The app reads this photo on this device and fills only clearly labeled,
          high-confidence facts. The photo is not sent to an OCR or AI provider.
          Nothing is confirmed automatically, and unreadable values stay blank.
        </p>
        <ul className={styles.requirements} id={photoRequirementsId}>
          <li>Show the full Nutrition Facts panel straight-on and in focus.</li>
          <li>Include the product or flavor name in the frame when possible.</li>
          <li>
            Use a JPEG or PNG at least 480 px wide and 480 px tall, no larger
            than 8 MB or 20 megapixels.
          </li>
          <li>Avoid glare, cropped serving sizes, and covered ingredient text.</li>
        </ul>
        <label className={styles.photoPicker}>
          <span>{photoName ? "Replace package-label photo" : "Take or choose a package-label photo"}</span>
          <input
            className={styles.photoInput}
            type="file"
            name="nutritionImage"
            accept="image/jpeg,image/png"
            capture="environment"
            aria-describedby={`${photoRequirementsId} ${photoPrivacyId}`}
            ref={photoInputRef}
            onChange={(event) =>
              void selectPhoto(event.currentTarget.files?.[0], event.currentTarget)
            }
          />
          <span className={styles.photoIntro} id={photoPrivacyId}>
            The original upload is not retained as-is. Server-re-encoded evidence
            stays private and is never shared.
          </span>
        </label>
        {photoPreflightPending ? (
          <p className={styles.ocrCanceledStatus} role="status" aria-live="polite">
            Checking the new photo header and dimensions before any preview or
            reader starts. The previous valid photo is unchanged until this check
            passes.
          </p>
        ) : null}
        {photoName ? (
          <div className={styles.photoPreview} aria-live="polite">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={styles.photoPreviewImage}
                src={previewUrl}
                alt="Preview of the selected package label"
              />
            ) : null}
            <p className={styles.photoFileName}>
              Selected: <strong>{photoName}</strong>. Use the file control above to replace it.
            </p>
          </div>
        ) : null}
        {recognitionPending && recognitionProgress ? (
          <div
            className={styles.ocrProgressCard}
            role="status"
            aria-live="polite"
          >
            <div className={styles.ocrProgressHeading}>
              <strong>{recognitionProgress.status}</strong>
              <span>{Math.round(recognitionProgress.progress * 100)}%</span>
            </div>
            <progress
              aria-label="Private label reading progress"
              max="100"
              value={Math.round(recognitionProgress.progress * 100)}
            />
            <p>
              Worker, OCR model, and photo processing stay in this browser. You
              can cancel or replace the photo at any time.
            </p>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => cancelRecognition()}
            >
              Cancel photo reading
            </button>
          </div>
        ) : null}
        {!recognitionPending && recognitionProgress && !recognition ? (
          <div className={styles.ocrCanceledStatus}>
            <p role="status">{recognitionProgress.status}</p>
            {selectedPhoto ? (
              <button
                className="button button-quiet"
                type="button"
                onClick={() => void analyzePhoto(selectedPhoto)}
              >
                Read this photo again
              </button>
            ) : null}
          </div>
        ) : null}
        {recognition ? (
          <section
            className={styles.ocrReviewCard}
            aria-labelledby={recognitionHeadingId}
          >
            <div className={styles.ocrReviewHeading}>
              <div>
                <p className="eyebrow">Private on-device reading</p>
                <h4 id={recognitionHeadingId}>
                  Review every filled suggestion
                </h4>
              </div>
              <span>{Object.keys(recognition.values).length} fields read</span>
            </div>
            <p>
              These are OCR suggestions, not verified facts. Compare each one
              with the photo before confirming; reader confidence is not a
              guarantee of accuracy.
            </p>
            {!Object.keys(recognition.values).length ? (
              <p className={styles.ocrNeedsReview} role="status">
                No facts were clear enough to fill automatically, so nothing was
                guessed. Retake the full panel in even light or enter only values
                you can read yourself.
              </p>
            ) : null}
            {Object.keys(recognition.values).length ? (
              <details className={styles.ocrEvidence}>
                <summary>See recognized lines and confidence</summary>
                <ul>
                  {(Object.keys(recognition.values) as FoodLabelOcrField[]).map(
                    (field) => (
                      <li key={field}>
                        <strong>{foodLabelOcrFieldLabels[field]}</strong>{" "}
                        <span>
                          {Math.round(recognition.confidenceByField[field] ?? 0)}%
                          reader confidence · “{recognition.evidenceByField[field]}”
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </details>
            ) : null}
            {recognition.unreadableRequiredFields.length ? (
              <div className={styles.ocrNeedsReview}>
                <strong>Still needs manual entry or a clearer photo:</strong>{" "}
                {recognition.unreadableRequiredFields.join(", ")}.
                {recognition.unreadableRequiredFields.includes("Brand") ||
                recognition.unreadableRequiredFields.includes("Product")
                  ? " Nutrition panels often do not print a labeled Brand or Product field."
                  : ""}
              </div>
            ) : null}
            {skippedOcrFields.length ? (
              <p className={styles.ocrNeedsReview}>
                Existing entries were not overwritten: {skippedOcrFields.join(", ")}.
              </p>
            ) : null}
            {recognition.allergenSuggestions.length ? (
              <p className={styles.ocrNeedsReview}>
                Possible allergens in the explicit package statement:{" "}
                {recognition.allergenSuggestions
                  .map((slug) =>
                    allergens.find(([value]) => value === slug)?.[1] ?? slug,
                  )
                  .join(", ")}
                . Review and select them below; nothing was selected automatically.
              </p>
            ) : null}
            {recognition.warnings.length ? (
              <ul className={styles.ocrWarnings}>
                {recognition.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <button
              className="button button-quiet"
              type="button"
              onClick={() => selectedPhoto && void analyzePhoto(selectedPhoto)}
            >
              Read this photo again
            </button>
          </section>
        ) : null}
        </section>

        <fieldset
          className={styles.labelTransaction}
          disabled={photoPreflightPending || recognitionPending}
        >
        <legend className="sr-only">Review and confirm recognized package facts</legend>
        <section className={styles.manualSection} aria-labelledby={manualHeadingId}>
        <div className={styles.manualHeading}>
          <h3 id={manualHeadingId}>2. Review and complete the printed facts</h3>
          <p>
            The local reader fills only clear suggestions. Correct any mismatch,
            complete required blanks from this exact package, and leave optional
            nutrients blank when they are not printed. Do not estimate.
          </p>
        </div>
        <div className={styles.fieldGrid}>
          <label className={`field ${styles.labelField}`}>
            <span>Brand</span>
            <input name="brandName" required maxLength={160} placeholder="Optimum Nutrition" />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Product</span>
            <input name="productName" required maxLength={240} placeholder="Gold Standard 100% Whey" />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Flavor or variant</span>
            <input name="variantName" maxLength={160} placeholder="Double Rich Chocolate" />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Package size</span>
            <input name="packageDescription" maxLength={240} placeholder="2 lb tub" />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Serving description</span>
            <input name="servingDescription" maxLength={160} placeholder="1 scoop" />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Serving weight (g)</span>
            <input name="servingWeightGrams" type="number" min=".001" max="10000" step="any" required />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Calories</span>
            <input name="calories" type="number" min="0" max="10000" step="any" required />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Protein (g)</span>
            <input name="proteinGrams" type="number" min="0" max="10000" step="any" required />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Carbohydrate (g)</span>
            <input name="carbohydrateGrams" type="number" min="0" max="10000" step="any" required />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Total fat (g)</span>
            <input name="fatGrams" type="number" min="0" max="10000" step="any" required />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Fiber (g)</span>
            <input name="fiberGrams" type="number" min="0" max="10000" step="any" />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Sodium (mg)</span>
            <input name="sodiumMilligrams" type="number" min="0" max="1000000" step="any" />
          </label>
          <label className={`field ${styles.labelField}`}>
            <span>Total sugars (g)</span>
            <input name="totalSugarsGrams" type="number" min="0" max="10000" step="any" />
          </label>
        </div>

        <details className={styles.detailsPanel}>
          <summary>More printed nutrients</summary>
          <div className={styles.fieldGrid} style={{ marginTop: ".75rem" }}>
            {[
              ["energyKilojoules", "Energy (kJ)", "100000"],
              ["saturatedFatGrams", "Saturated fat (g)", "10000"],
              ["transFatGrams", "Trans fat (g)", "10000"],
              ["addedSugarsGrams", "Added sugars (g)", "10000"],
              ["cholesterolMilligrams", "Cholesterol (mg)", "1000000"],
              ["potassiumMilligrams", "Potassium (mg)", "1000000"],
              ["calciumMilligrams", "Calcium (mg)", "1000000"],
              ["ironMilligrams", "Iron (mg)", "1000000"],
              ["vitaminDMicrograms", "Vitamin D (mcg)", "1000000"],
            ].map(([name, label, maximum]) => (
              <label className={`field ${styles.labelField}`} key={name}>
                <span>{label}</span>
                <input name={name} type="number" min="0" max={maximum} step="any" />
              </label>
            ))}
          </div>
        </details>

        <label className={`field ${styles.labelField}`} style={{ marginTop: "1rem" }}>
          <span>Ingredients exactly as printed</span>
          <textarea name="ingredientsText" required maxLength={10000} />
        </label>
        <label className={`field ${styles.labelField}`} style={{ marginTop: "1rem" }}>
          <span>Package allergen statement</span>
          <textarea
            name="allergenStatement"
            required
            maxLength={4000}
            placeholder='For example: "Contains milk and soy." Enter "None stated on package" when applicable.'
          />
        </label>

        <fieldset className={styles.categoryFieldset}>
          <legend>Food categories (choose at least one)</legend>
          <p className={styles.photoIntro}>
            Categories support meal-balance checks. Choose only categories that
            clearly describe this exact product.
          </p>
          <div className={styles.chips}>
            {categories.map(([slug, label]) => (
              <label className={styles.chip} key={slug}>
                <input
                  type="checkbox"
                  name="categorySlugs"
                  value={slug}
                  required={slug === "carbohydrate"}
                  onInvalid={(event) =>
                    event.currentTarget.setCustomValidity(
                      "Choose at least one food category.",
                    )
                  }
                  onChange={(event) => {
                    const inputs = event.currentTarget.form
                      ? Array.from(
                          event.currentTarget.form.querySelectorAll<HTMLInputElement>(
                            'input[name="categorySlugs"]',
                          ),
                        )
                      : [];
                    const hasSelection = inputs.some((input) => input.checked);
                    inputs.forEach((input, index) => {
                      input.required = index === 0 && !hasSelection;
                      input.setCustomValidity("");
                    });
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.categoryFieldset}>
          <legend>Allergens stated on the package</legend>
          <div className={styles.chips}>
            {allergens.map(([slug, label]) => (
              <label className={styles.chip} key={slug}>
                <input type="checkbox" name="allergenSlugs" value={slug} />
                {label}
              </label>
            ))}
          </div>
          <label className={styles.confirmCard}>
            <input type="checkbox" name="allergensReviewed" required />
            <span>
              I reviewed the complete package statement and selected every named
              allergen, including “may contain” warnings. If none are named, I
              confirmed the statement says so.
            </span>
          </label>
        </fieldset>

        <fieldset className={styles.categoryFieldset}>
          <legend>This exact product is not suitable for</legend>
          <p className={styles.photoIntro}>
            Check each conflict you can confirm from the ingredients and package claims.
          </p>
          <div className={styles.chips}>
            {restrictions.map(([slug, label]) => (
              <label className={styles.chip} key={slug}>
                <input type="checkbox" name="restrictionSlugs" value={slug} />
                {label}
              </label>
            ))}
          </div>
          <label className={styles.confirmCard}>
            <input type="checkbox" name="restrictionsReviewed" required />
            <span>
              I reviewed the printed ingredients and claims against every diet
              listed above and selected each known conflict.
            </span>
          </label>
        </fieldset>

        <label className={styles.shareCard}>
          <input type="checkbox" name="shareNormalizedProduct" />
          <span>
            <strong>Optional: submit a photo-free normalized copy for shared catalog review.</strong>{" "}
            This may share the brand, product, variant, package description,
            confirmed nutrition, ingredients, allergens, categories, and diet
            conflicts. Server-re-encoded evidence stays private and is never
            shared; your account identity is not included. The copy remains
            unavailable to plans until approved. See the{" "}
            <a href="/privacy" target="_blank" rel="noreferrer">
              Privacy Notice v1.3
            </a>.
          </span>
        </label>

        <label className={styles.confirmCard}>
          <input
            type="checkbox"
            name="confirmedAccurate"
            checked={confirmed}
            ref={confirmationInputRef}
            onChange={(event) => {
              setConfirmed(event.target.checked);
              setError(null);
            }}
          />
          <span>
            I compared every automatic suggestion and manual entry with this exact
            package. I corrected any mismatch and did not estimate missing facts.
          </span>
        </label>

        {error ? (
          <ApiErrorNotice
            actionDisabled={pending}
            className={styles.labelApiError}
            error={error}
            heading="This food could not proceed as requested."
            onAction={
              error.action?.kind === "retry" || error.action?.kind === "edit"
                ? handleErrorAction
                : undefined
            }
            ref={errorRef}
          />
        ) : null}
        {message ? (
          <div className={styles.formStatus} role="status" aria-live="polite">
            {message}
          </div>
        ) : null}
        <div className={styles.submitActions}>
          <button
            className="button button-dark"
            type="submit"
            disabled={pending || recognitionPending || photoPreflightPending}
          >
            {pending
              ? "Saving private food…"
              : photoPreflightPending
                ? "Checking label photo…"
              : recognitionPending
                ? "Reading label photo…"
                : "Confirm and save private food"}
          </button>
          <p>
            Your confirmed private food can be used in your plan. Sharing is
            optional and every reusable copy remains review-gated.
          </p>
        </div>
        </section>
        </fieldset>
      </fieldset>
    </form>
  );
}
