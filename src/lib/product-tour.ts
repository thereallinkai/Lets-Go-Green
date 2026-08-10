export const CURRENT_PRODUCT_TOUR_VERSION = 3;
export const PRODUCT_TOUR_OPEN_EVENT = "lets-go-green:open-product-tour";
export const PRODUCT_TOUR_REPLAY_REQUEST_KEY =
  "lets-go-green-product-tour-replay-requested-v3";
export const PRODUCT_TOUR_REPLAY_HASH = "#tutorial";
export const PRODUCT_TOUR_SESSION_SKIP_KEY =
  "lets-go-green-product-tour-skipped-v3";

export type ProductTourStep = {
  eyebrow: string;
  title: string;
  description: string;
  detail: string;
};

export const PRODUCT_TOUR_STEPS: readonly ProductTourStep[] = [
  {
    eyebrow: "Welcome",
    title: "A greener, calmer way to plan",
    description:
      "Let's Go Green! keeps what you provide, what the app calculates, and what AI suggests clearly separated.",
    detail:
      "Nothing is silently accepted for you. You stay in control of your meals, profile, and plan versions.",
  },
  {
    eyebrow: "Appearance and inputs",
    title: "Match your device, keep calculations grounded",
    description:
      "System appearance follows your device's live Light or Dark setting. Onboarding uses the height you selected alongside age, weight, activity, and timeline inputs.",
    detail:
      "You can choose a Light or Dark override in Settings. Height feeds the deterministic energy range; AI receives the confirmed value but does not guess or recalculate it.",
  },
  {
    eyebrow: "Foods and products",
    title: "Choose the exact food you mean",
    description:
      "Search once by food, brand, product, or flavor. Saved catalog, USDA, and Open Food Facts matches appear together; use a private package-label photo when no source match is available.",
    detail:
      "Online search runs only when you press its button. Choose the intended meal, review source and nutrition, and remember that an imported source record stays pending until reviewed. If a product is missing, photograph its label and enter exactly what it says.",
  },
  {
    eyebrow: "Today",
    title: "Record all six eating windows",
    description:
      "Today separates breakfast, morning snack, lunch, afternoon snack, dinner, and evening snack so extra foods have a clear place.",
    detail:
      "You can add or remove foods, mark a main meal eaten, or skip it. A skip reason is optional, and snack windows never force you to record anything.",
  },
  {
    eyebrow: "My Plan",
    title: "Review before you accept",
    description:
      "Generated plans remain drafts until you explicitly accept one. Your current accepted plan stays in place during review.",
    detail:
      "Nutrition totals come from stored, eligible food records rather than invented values.",
  },
  {
    eyebrow: "Calendar and progress",
    title: "Notice patterns without judgment",
    description:
      "Calendar shows daily history, while Progress keeps weight changes and missing data in context.",
    detail:
      "A blank day stays blank. The app does not turn incomplete data into a failure or a zero.",
  },
  {
    eyebrow: "Profile",
    title: "Your preferences, privacy, and controls",
    description:
      "Open your avatar for profile details, device-time-zone controls, tutorial replay, settings, and shopping shortcuts.",
    detail:
      "Nearby-shopping buttons open clearly labeled external map searches. They do not claim that a product is in stock. Settings also lets you replay this tutorial and choose System, Light, or Dark appearance.",
  },
] as const;
