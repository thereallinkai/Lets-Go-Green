export const ALLERGEN_ALIASES: Readonly<Record<string, RegExp>> = {
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

const ALLERGEN_NEGATIVE_ALIAS =
  "(?:milk|dairy|whey|casein|caseinate|lactalbumin|eggs?|albumen|ovalbumin|fish|anchov(?:y|ies)|cod|salmon|tuna|shellfish|shrimp|prawn|crab|lobster|crayfish|tree[- ]?nuts?|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil[- ]?nuts?|peanuts?|wheat|spelt|semolina|durum|soy|soya|sesame)";

export function removeNegatedAllergenMentions(statement: string) {
  return statement
    .replace(
      new RegExp(`\\b${ALLERGEN_NEGATIVE_ALIAS}[- ]free\\b`, "gi"),
      "",
    )
    .replace(
      new RegExp(
        `\\b(?:no|without|free\\s+from)\\s+(?:declared\\s+)?${ALLERGEN_NEGATIVE_ALIAS}(?:\\s*(?:,|and|or)\\s*${ALLERGEN_NEGATIVE_ALIAS})*`,
        "gi",
      ),
      "",
    );
}
