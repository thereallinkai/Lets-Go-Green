import { removeNegatedAllergenMentions } from "@/src/lib/allergen-text";

type FoodLabelOcrWord = {
  text: string;
  confidence: number;
};

export type FoodLabelOcrLine = {
  text: string;
  confidence: number;
  words?: FoodLabelOcrWord[];
};

export type FoodLabelOcrField =
  | "brandName"
  | "productName"
  | "variantName"
  | "packageDescription"
  | "servingDescription"
  | "servingWeightGrams"
  | "calories"
  | "energyKilojoules"
  | "proteinGrams"
  | "carbohydrateGrams"
  | "fatGrams"
  | "fiberGrams"
  | "sodiumMilligrams"
  | "saturatedFatGrams"
  | "transFatGrams"
  | "totalSugarsGrams"
  | "addedSugarsGrams"
  | "cholesterolMilligrams"
  | "potassiumMilligrams"
  | "calciumMilligrams"
  | "ironMilligrams"
  | "vitaminDMicrograms"
  | "ingredientsText"
  | "allergenStatement";

export type FoodLabelOcrValue = string | number;

export type FoodLabelOcrResult = {
  values: Partial<Record<FoodLabelOcrField, FoodLabelOcrValue>>;
  confidenceByField: Partial<Record<FoodLabelOcrField, number>>;
  evidenceByField: Partial<Record<FoodLabelOcrField, string>>;
  allergenSuggestions: string[];
  unreadableRequiredFields: string[];
  warnings: string[];
  overallConfidence: number;
  quality: "strong" | "review-carefully" | "unreadable";
};

const MIN_FIELD_CONFIDENCE = 65;
const NUMBER_PATTERN = String.raw`(?:0|[1-9]\d*)(?:\.\d+)?`;

export const foodLabelOcrFieldLabels: Record<FoodLabelOcrField, string> = {
  brandName: "Brand",
  productName: "Product",
  variantName: "Flavor or variant",
  packageDescription: "Package size",
  servingDescription: "Serving description",
  servingWeightGrams: "Serving weight",
  calories: "Calories",
  energyKilojoules: "Energy",
  proteinGrams: "Protein",
  carbohydrateGrams: "Carbohydrate",
  fatGrams: "Total fat",
  fiberGrams: "Fiber",
  sodiumMilligrams: "Sodium",
  saturatedFatGrams: "Saturated fat",
  transFatGrams: "Trans fat",
  totalSugarsGrams: "Total sugars",
  addedSugarsGrams: "Added sugars",
  cholesterolMilligrams: "Cholesterol",
  potassiumMilligrams: "Potassium",
  calciumMilligrams: "Calcium",
  ironMilligrams: "Iron",
  vitaminDMicrograms: "Vitamin D",
  ingredientsText: "Ingredients",
  allergenStatement: "Package allergen statement",
};

const requiredFields: FoodLabelOcrField[] = [
  "brandName",
  "productName",
  "servingWeightGrams",
  "calories",
  "proteinGrams",
  "carbohydrateGrams",
  "fatGrams",
  "ingredientsText",
  "allergenStatement",
];

const numericLimits: Partial<
  Record<FoodLabelOcrField, { minimum: number; maximum: number; positive?: boolean }>
> = {
  servingWeightGrams: { minimum: 0, maximum: 10_000, positive: true },
  calories: { minimum: 0, maximum: 10_000 },
  energyKilojoules: { minimum: 0, maximum: 100_000 },
  proteinGrams: { minimum: 0, maximum: 10_000 },
  carbohydrateGrams: { minimum: 0, maximum: 10_000 },
  fatGrams: { minimum: 0, maximum: 10_000 },
  fiberGrams: { minimum: 0, maximum: 10_000 },
  sodiumMilligrams: { minimum: 0, maximum: 1_000_000 },
  saturatedFatGrams: { minimum: 0, maximum: 10_000 },
  transFatGrams: { minimum: 0, maximum: 10_000 },
  totalSugarsGrams: { minimum: 0, maximum: 10_000 },
  addedSugarsGrams: { minimum: 0, maximum: 10_000 },
  cholesterolMilligrams: { minimum: 0, maximum: 1_000_000 },
  potassiumMilligrams: { minimum: 0, maximum: 1_000_000 },
  calciumMilligrams: { minimum: 0, maximum: 1_000_000 },
  ironMilligrams: { minimum: 0, maximum: 1_000_000 },
  vitaminDMicrograms: { minimum: 0, maximum: 1_000_000 },
};

function cleanLine(value: string) {
  return value
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[µμ]/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function relevantConfidence(line: FoodLabelOcrLine, amountText?: string) {
  const lineConfidence = clampConfidence(line.confidence);
  const words = (line.words ?? []).filter((word) => word.text.trim());
  if (!words.length) return lineConfidence;

  if (amountText) {
    const normalizedAmount = amountText.toLocaleLowerCase("en-US").replace(/\s/g, "");
    const amountWord = words.find((word) =>
      word.text
        .toLocaleLowerCase("en-US")
        .replace(/[µμ]/g, "u")
        .replace(/\s/g, "")
        .includes(normalizedAmount),
    );
    if (amountWord) {
      return Math.min(lineConfidence, clampConfidence(amountWord.confidence));
    }
  }

  const sorted = words
    .map((word) => clampConfidence(word.confidence))
    .sort((left, right) => left - right);
  const lowerQuartile = sorted[Math.floor((sorted.length - 1) * 0.25)] ?? 0;
  return Math.min(lineConfidence, lowerQuartile);
}

type Candidate = {
  value: FoodLabelOcrValue;
  confidence: number;
  evidence: string;
};

function textCandidate(
  line: FoodLabelOcrLine,
  pattern: RegExp,
  maximumLength: number,
): Candidate | null {
  const text = cleanLine(line.text);
  const match = text.match(pattern);
  const value = cleanLine(match?.[1] ?? "").slice(0, maximumLength);
  const confidence = relevantConfidence(line);
  if (!value || confidence < MIN_FIELD_CONFIDENCE) return null;
  return { value, confidence, evidence: text };
}

function amountCandidates(
  line: FoodLabelOcrLine,
  labelPattern: RegExp,
  units: readonly string[],
  transform: (value: number, unit: string) => number,
): Candidate[] {
  const text = cleanLine(line.text);
  if (!labelPattern.test(text)) return [];
  labelPattern.lastIndex = 0;
  if (/(?:<\s*\d|less\s+than\s+\d|\btrace\b)/i.test(text)) return [];

  const unitAlternation = units.join("|");
  const matches = [
    ...text.matchAll(
      new RegExp(`(${NUMBER_PATTERN})\\s*(${unitAlternation})(?![a-z])`, "gi"),
    ),
  ];
  if (matches.length !== 1) return [];
  const rawNumber = matches[0]?.[1];
  const rawUnit = matches[0]?.[2];
  if (!rawNumber || !rawUnit) return [];
  const value = transform(Number(rawNumber), rawUnit.toLocaleLowerCase("en-US"));
  const amountText = `${rawNumber}${rawUnit}`;
  const confidence = relevantConfidence(line, amountText);
  if (!Number.isFinite(value) || confidence < MIN_FIELD_CONFIDENCE) return [];
  return [{ value, confidence, evidence: text }];
}

function calorieCandidates(line: FoodLabelOcrLine): Candidate[] {
  const text = cleanLine(line.text);
  if (
    /calories?\s+from\s+fat/i.test(text) ||
    /(?:<\s*\d|less\s+than\s+\d|\btrace\b)/i.test(text)
  ) {
    return [];
  }
  const matches = [
    ...text.matchAll(new RegExp(`\\bcalories?\\s*[:=-]?\\s*(${NUMBER_PATTERN})\\b`, "gi")),
  ];
  if (matches.length !== 1) return [];
  const rawNumber = matches[0]?.[1];
  if (!rawNumber) return [];
  const confidence = relevantConfidence(line, rawNumber);
  if (confidence < MIN_FIELD_CONFIDENCE) return [];
  return [{ value: Number(rawNumber), confidence, evidence: text }];
}

function servingCandidates(line: FoodLabelOcrLine) {
  const text = cleanLine(line.text);
  const match = text.match(/^serving\s+size\s*[:=-]?\s*(.+)$/i);
  if (!match?.[1]) return null;
  const fullDescription = cleanLine(match[1]);
  const gramMatches = [
    ...fullDescription.matchAll(new RegExp(`(${NUMBER_PATTERN})\\s*g(?![a-z])`, "gi")),
  ];
  if (gramMatches.length !== 1) return null;
  const rawNumber = gramMatches[0]?.[1];
  if (!rawNumber) return null;
  const confidence = relevantConfidence(line, `${rawNumber}g`);
  if (confidence < MIN_FIELD_CONFIDENCE) return null;
  const servingWeight = Number(rawNumber);
  const description = cleanLine(
    fullDescription.replace(/\(?\s*(?:0|[1-9]\d*)(?:\.\d+)?\s*g\s*\)?/i, ""),
  );
  return {
    weight: {
      value: servingWeight,
      confidence,
      evidence: text,
    } satisfies Candidate,
    description: description
      ? ({ value: description, confidence, evidence: text } satisfies Candidate)
      : null,
  };
}

function chooseCandidate(
  field: FoodLabelOcrField,
  candidates: Candidate[],
  result: FoodLabelOcrResult,
) {
  const valid = candidates.filter((candidate) => {
    if (typeof candidate.value !== "number") return true;
    const limits = numericLimits[field];
    if (!limits) return true;
    return (
      candidate.value >= limits.minimum &&
      candidate.value <= limits.maximum &&
      (!limits.positive || candidate.value > 0)
    );
  });
  const distinctValues = new Set(
    valid.map((candidate) =>
      typeof candidate.value === "number"
        ? candidate.value.toString()
        : candidate.value.toLocaleLowerCase("en-US"),
    ),
  );
  if (distinctValues.size > 1) {
    result.warnings.push(
      `Multiple ${foodLabelOcrFieldLabels[field].toLocaleLowerCase("en-US")} values were visible, so none was filled. Choose the value for the intended serving column.`,
    );
    return;
  }
  const selected = valid.sort(
    (left, right) => right.confidence - left.confidence,
  )[0];
  if (!selected) return;
  result.values[field] = selected.value;
  result.confidenceByField[field] = selected.confidence;
  result.evidenceByField[field] = selected.evidence;
}

function isStructuredLabelLine(text: string) {
  return /^(?:nutrition facts\b|servings? per container\b|serving size\b|amount per serving\b|calories?(?:\s+from\s+fat)?\b|%?\s*daily value\b|total fat\b|saturated fat\b|trans fat\b|cholesterol\b|sodium\b|total carbohydrates?\b|dietary fib(?:er|re)\b|total sugars?\b|includes?\b.*added sugars?\b|added sugars?\b|protein\b|vitamin d\b|calcium\b|iron\b|potassium\b|energy\b|brand\s*:|product(?: name)?\s*:|flavou?r\s*:|variant\s*:|net (?:wt|weight)\b|package size\b)/i.test(
    text,
  );
}

function extractIngredients(lines: FoodLabelOcrLine[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const first = cleanLine(lines[index]?.text ?? "");
    const match = first.match(/^ingredients?\s*:\s*(.*)$/i);
    if (!match) continue;
    const parts = match[1] ? [cleanLine(match[1])] : [];
    const evidence = [first];
    const confidences = [relevantConfidence(lines[index]!)];
    let partial = false;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex]!;
      const next = cleanLine(nextLine.text);
      if (
        !next ||
        isExplicitAllergenStatement(next) ||
        isStructuredLabelLine(next) ||
        /^(?:distributed by\b|manufactured (?:by|for)\b|www\.|https?:)/i.test(
          next,
        )
      ) {
        break;
      }
      const confidence = relevantConfidence(nextLine);
      if (confidence < MIN_FIELD_CONFIDENCE) {
        partial = true;
        break;
      }
      parts.push(next);
      evidence.push(next);
      confidences.push(confidence);
    }
    const value = cleanLine(parts.join(" ")).slice(0, 10_000);
    const confidence = Math.min(...confidences);
    if (!value || confidence < MIN_FIELD_CONFIDENCE) return null;
    return {
      candidate: { value, confidence, evidence: evidence.join(" ") } satisfies Candidate,
      partial,
    };
  }
  return null;
}

function isExplicitAllergenStatement(text: string) {
  if (
    /^(?:contains|may contain)\s*:?\s*(?:\d|less\s+than\s+\d|trace\b)/i.test(
      text,
    )
  ) {
    return false;
  }
  return /^(?:allergens?|contains|may contain)\s*:?\s*\S/i.test(text);
}

function allergenCandidate(line: FoodLabelOcrLine) {
  const text = cleanLine(line.text);
  if (!isExplicitAllergenStatement(text)) return null;
  const match = text.match(
    /^(?:allergens?|contains|may contain)\s*:?\s*(.+)$/i,
  );
  const value = cleanLine(match?.[1] ?? "");
  const confidence = relevantConfidence(line);
  if (!value || confidence < MIN_FIELD_CONFIDENCE) return null;
  const prefix = text.match(/^(?:allergens?|contains|may contain)/i)?.[0] ?? "Contains";
  return {
    value: `${prefix}: ${value}`,
    confidence,
    evidence: text,
  } satisfies Candidate;
}

const allergenPatterns: Record<string, RegExp> = {
  milk: /\b(?:milk|dairy|whey|casein|caseinate|lactalbumin)\b/i,
  egg: /\b(?:eggs?|albumen|ovalbumin)\b/i,
  fish: /\b(?:fish|anchov(?:y|ies)|cod|salmon|tuna)\b/i,
  shellfish: /\b(?:shellfish|shrimp|prawn|crab|lobster|crayfish)\b/i,
  "tree-nuts":
    /\b(?:tree[- ]?nuts?|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil[- ]?nuts?)\b/i,
  peanuts: /\bpeanuts?\b/i,
  wheat: /\b(?:wheat|spelt|semolina|durum)\b/i,
  soy: /\b(?:soy|soya)\b/i,
  sesame: /\bsesame\b/i,
};

function removePhysicallyImpossibleValues(result: FoodLabelOcrResult) {
  const servingWeight = result.values.servingWeightGrams;
  if (typeof servingWeight !== "number") return;
  const impossible: FoodLabelOcrField[] = [];
  const gramFields: FoodLabelOcrField[] = [
    "proteinGrams",
    "carbohydrateGrams",
    "fatGrams",
    "fiberGrams",
    "saturatedFatGrams",
    "transFatGrams",
    "totalSugarsGrams",
    "addedSugarsGrams",
  ];
  for (const field of gramFields) {
    const value = result.values[field];
    if (typeof value === "number" && value > servingWeight * 1.25 + 1) {
      impossible.push(field);
    }
  }
  const calories = result.values.calories;
  if (
    typeof calories === "number" &&
    calories > servingWeight * 9 + 50
  ) {
    impossible.push("calories");
  }
  for (const field of [...new Set(impossible)]) {
    delete result.values[field];
    delete result.confidenceByField[field];
    delete result.evidenceByField[field];
    result.warnings.push(
      `${foodLabelOcrFieldLabels[field]} was not filled because the reading conflicts with the printed serving weight. Check the photo and enter the printed value yourself.`,
    );
  }
}

function removeGrosslyCalorieInconsistentValues(result: FoodLabelOcrResult) {
  const calories = result.values.calories;
  if (typeof calories !== "number") return;

  // Nutrition-label rounding and alternative energy factors can create small
  // differences. This deliberately generous ceiling catches only a single
  // macro reading that could not plausibly fit within the printed calories.
  // It is especially useful when OCR mistakes a trailing unit for a digit and
  // no serving weight was read for the separate mass-conservation check.
  const maximumPlausibleContribution = Math.max(
    calories * 2,
    calories + 50,
  );
  const macroFields: Array<[FoodLabelOcrField, number]> = [
    ["proteinGrams", 4],
    ["fatGrams", 9],
  ];

  for (const [field, caloriesPerGram] of macroFields) {
    const value = result.values[field];
    if (
      typeof value !== "number" ||
      value * caloriesPerGram <= maximumPlausibleContribution
    ) {
      continue;
    }
    delete result.values[field];
    delete result.confidenceByField[field];
    delete result.evidenceByField[field];
    result.warnings.push(
      `${foodLabelOcrFieldLabels[field]} was not filled because the reading conflicts with the printed calories. Check the photo and enter the printed value yourself.`,
    );
  }
}

export function parseFoodLabelOcr(
  rawLines: FoodLabelOcrLine[],
  rawOverallConfidence: number,
): FoodLabelOcrResult {
  const lines = rawLines
    .map((line) => ({ ...line, text: cleanLine(line.text) }))
    .filter((line) => line.text);
  const overallConfidence = clampConfidence(rawOverallConfidence);
  const result: FoodLabelOcrResult = {
    values: {},
    confidenceByField: {},
    evidenceByField: {},
    allergenSuggestions: [],
    unreadableRequiredFields: [],
    warnings: [],
    overallConfidence,
    quality:
      overallConfidence >= 80
        ? "strong"
        : overallConfidence >= 50
          ? "review-carefully"
          : "unreadable",
  };

  const textFields: Array<
    [FoodLabelOcrField, RegExp, number]
  > = [
    ["brandName", /^brand\s*:\s*(.+)$/i, 160],
    ["productName", /^product(?: name)?\s*:\s*(.+)$/i, 240],
    ["variantName", /^(?:flavou?r|variant)\s*:\s*(.+)$/i, 160],
    ["packageDescription", /^(?:net wt|net weight|package size)\s*[:=-]?\s*(.+)$/i, 240],
  ];
  for (const [field, pattern, maximumLength] of textFields) {
    chooseCandidate(
      field,
      lines.flatMap((line) => {
        const candidate = textCandidate(line, pattern, maximumLength);
        return candidate ? [candidate] : [];
      }),
      result,
    );
  }

  const serving = lines.flatMap((line) => {
    const candidate = servingCandidates(line);
    return candidate ? [candidate] : [];
  });
  chooseCandidate(
    "servingWeightGrams",
    serving.map((candidate) => candidate.weight),
    result,
  );
  chooseCandidate(
    "servingDescription",
    serving.flatMap((candidate) =>
      candidate.description ? [candidate.description] : [],
    ),
    result,
  );

  const amountDefinitions: Array<[
    FoodLabelOcrField,
    RegExp,
    readonly string[],
    (value: number, unit: string) => number,
  ]> = [
    ["energyKilojoules", /\benergy\b/i, ["kj"], (value) => value],
    ["proteinGrams", /(?:^|\s)protein\s*[:=-]?/i, ["g"], (value) => value],
    ["carbohydrateGrams", /\b(?:total\s+)?carbohydrate(?:s)?\b/i, ["g"], (value) => value],
    ["fatGrams", /\btotal\s+fat\b/i, ["g"], (value) => value],
    ["fiberGrams", /\b(?:dietary\s+)?fib(?:er|re)\b/i, ["g"], (value) => value],
    ["sodiumMilligrams", /\bsodium\b/i, ["mg", "g"], (value, unit) => unit === "g" ? value * 1_000 : value],
    ["saturatedFatGrams", /\bsaturated\s+fat\b/i, ["g"], (value) => value],
    ["transFatGrams", /\btrans\s+fat\b/i, ["g"], (value) => value],
    ["totalSugarsGrams", /\btotal\s+sugars?\b/i, ["g"], (value) => value],
    ["addedSugarsGrams", /\badded\s+sugars?\b/i, ["g"], (value) => value],
    ["cholesterolMilligrams", /\bcholesterol\b/i, ["mg", "g"], (value, unit) => unit === "g" ? value * 1_000 : value],
    ["potassiumMilligrams", /\bpotassium\b/i, ["mg", "g"], (value, unit) => unit === "g" ? value * 1_000 : value],
    ["calciumMilligrams", /\bcalcium\b/i, ["mg", "g"], (value, unit) => unit === "g" ? value * 1_000 : value],
    ["ironMilligrams", /(?:^|\s)iron\s*[:=-]?/i, ["mg", "g"], (value, unit) => unit === "g" ? value * 1_000 : value],
    ["vitaminDMicrograms", /\bvitamin\s+d\b/i, ["mcg", "ug"], (value) => value],
  ];
  chooseCandidate(
    "calories",
    lines.flatMap(calorieCandidates),
    result,
  );
  for (const [field, labelPattern, units, transform] of amountDefinitions) {
    chooseCandidate(
      field,
      lines.flatMap((line) =>
        amountCandidates(line, labelPattern, units, transform),
      ),
      result,
    );
  }

  const ingredients = extractIngredients(lines);
  if (ingredients) {
    chooseCandidate("ingredientsText", [ingredients.candidate], result);
    if (ingredients.partial) {
      result.warnings.push(
        "Only the clearly readable part of the ingredients statement was filled. Compare it with the complete package before confirming.",
      );
    }
  }

  const allergenCandidates = lines.flatMap((line) => {
    const candidate = allergenCandidate(line);
    return candidate ? [candidate] : [];
  });
  if (allergenCandidates.length) {
    const combined = allergenCandidates
      .map((candidate) => String(candidate.value))
      .join(" ")
      .slice(0, 4_000);
    const confidence = Math.min(
      ...allergenCandidates.map((candidate) => candidate.confidence),
    );
    result.values.allergenStatement = combined;
    result.confidenceByField.allergenStatement = confidence;
    result.evidenceByField.allergenStatement = allergenCandidates
      .map((candidate) => candidate.evidence)
      .join(" ");
    const positiveAllergenText = removeNegatedAllergenMentions(combined);
    result.allergenSuggestions = Object.entries(allergenPatterns).flatMap(
      ([slug, pattern]) => (pattern.test(positiveAllergenText) ? [slug] : []),
    );
  }

  removePhysicallyImpossibleValues(result);
  removeGrosslyCalorieInconsistentValues(result);

  result.unreadableRequiredFields = requiredFields.flatMap((field) =>
    result.values[field] === undefined ? [foodLabelOcrFieldLabels[field]] : [],
  );
  if (overallConfidence < 50) {
    result.warnings.unshift(
      "The overall photo reading was low confidence. Only individually clear lines were filled; retake the photo if the panel is hard to compare.",
    );
  }
  return result;
}
