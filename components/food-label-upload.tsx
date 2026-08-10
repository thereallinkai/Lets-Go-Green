"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiErrorNotice } from "@/components/api-error-notice";
import styles from "@/components/food-discovery.module.css";
import type { ApiError } from "@/src/lib/api-response";
import {
  apiErrorFromPayload,
  clientApiError,
} from "@/src/lib/client-api-error";
import type { FoodLabelData } from "@/src/lib/domain/food-label";

type ApiEnvelope<T> = { data?: T | null; error?: unknown } | null;

type ResumeState = {
  draftId: string;
  labelFingerprint: string;
  imageUploaded: boolean;
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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);
  const [catalogRefresh, setCatalogRefresh] =
    useState<CatalogRefresh | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  function reportError(nextError: ApiError) {
    setMessage(null);
    setError(nextError);
    window.requestAnimationFrame(() => errorRef.current?.focus());
  }

  function releasePreview() {
    if (previewUrlRef.current && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = null;
    setPreviewUrl(null);
  }

  useEffect(() => () => {
    if (previewUrlRef.current && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(previewUrlRef.current);
    }
  }, []);

  function selectPhoto(file: File | undefined, input: HTMLInputElement) {
    if (!file) return;
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
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
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
          "Review the serving nutrition, ingredients, and allergen statement, then select the manual-confirmation checkbox.",
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
      categorySlugs: form.getAll("categorySlugs").map(String),
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
    let operationFallback = clientApiError(
      "LABEL_DRAFT_NETWORK_ERROR",
      "The private label draft was not saved.",
      "The label service could not be reached. Your photo and transcription remain in this browser.",
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
          body: JSON.stringify(labelData),
        });
        const draft = (await draftResponse.json().catch(() => null)) as ApiEnvelope<{
          id: string;
        }>;
        if (
          !draftResponse.ok ||
          !draft?.data ||
          typeof draft.data.id !== "string"
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
      formElement.reset();
      setConfirmed(false);
      setPhotoName(null);
      setSelectedPhoto(null);
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
      } else {
        formRef.current?.requestSubmit();
      }
      return;
    }
    if (error?.action?.kind !== "edit") return;
    if (error.code.includes("IMAGE")) {
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
      aria-busy={pending}
      noValidate
      onChange={(event) => {
        const changedControl = event.target as unknown;
        if (changedControl !== photoInputRef.current) setError(null);
      }}
      onSubmit={submit}
      ref={formRef}
    >
      <fieldset className={styles.labelTransaction} disabled={pending}>
        <legend className="sr-only">Package-label submission</legend>
        <section className={styles.photoFirst} aria-labelledby="label-photo-heading">
        <h3 id="label-photo-heading">1. Start with the package label</h3>
        <p className={styles.photoIntro}>
          This image becomes private, server-re-encoded evidence, not an automatic
          nutrition reading. The app does not use it to guess or silently fill any
          field.
        </p>
        <ul className={styles.requirements} id="label-photo-requirements">
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
            aria-describedby="label-photo-requirements label-photo-privacy"
            required
            ref={photoInputRef}
            onChange={(event) =>
              selectPhoto(event.currentTarget.files?.[0], event.currentTarget)
            }
          />
          <span className={styles.photoIntro} id="label-photo-privacy">
            The original upload is not retained as-is. Server-re-encoded evidence
            stays private and is never shared.
          </span>
        </label>
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
        </section>

        <section className={styles.manualSection} aria-labelledby="manual-label-heading">
        <div className={styles.manualHeading}>
          <h3 id="manual-label-heading">2. Copy the printed facts</h3>
          <p>
            Enter only what you can read on this exact package. Leave optional
            nutrients blank when the panel does not state them; do not estimate.
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
            <input name="servingDescription" defaultValue="1 scoop" maxLength={160} />
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
            checked={confirmed}
            onChange={(event) => {
              setConfirmed(event.target.checked);
              setError(null);
            }}
          />
          <span>
            I manually copied the serving nutrition, ingredients, and allergen
            statement from this exact package. I did not estimate missing facts.
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
            disabled={pending}
          >
            {pending ? "Saving private food…" : "Confirm and save private food"}
          </button>
          <p>
            Your confirmed private food can be used in your plan. Sharing is
            optional and every reusable copy remains review-gated.
          </p>
        </div>
        </section>
      </fieldset>
    </form>
  );
}
