export type ConcerningSymptom =
  | "dizziness"
  | "fainting"
  | "heart_palpitations"
  | "severe_weakness";

type SafetyFlagCode =
  | "under_18"
  | "pregnant_or_nursing"
  | "eating_disorder_history"
  | "medical_concern"
  | "concerning_symptom"
  | "goal_direction_conflict"
  | "aggressive_goal_rate";

export interface SafetyContext {
  ageYears?: number | null;
  pregnantOrNursing?: boolean | null;
  eatingDisorderHistory?: boolean | null;
  relevantMedicalConcerns?: boolean | null;
  symptoms?: readonly ConcerningSymptom[];
  goalDirectionConflict?: boolean | null;
  aggressiveGoalRate?: boolean | null;
}

export interface SafetyAssessment {
  flags: Array<{
    code: SafetyFlagCode;
    detail?: string;
  }>;
  requiresNonRestrictivePlan: boolean;
  allowNonRestrictiveTracking: true;
  message: string | null;
}

export const SAFETY_GUIDANCE_MESSAGE =
  "Your responses suggest that a restrictive plan may not be appropriate. You can still use non-restrictive tracking features, and a qualified healthcare professional or registered dietitian can help with individualized guidance.";

export function evaluateSafetyContext(
  context: SafetyContext,
): SafetyAssessment {
  const flags: SafetyAssessment["flags"] = [];
  if (
    context.ageYears !== null &&
    context.ageYears !== undefined &&
    context.ageYears < 18
  ) {
    flags.push({ code: "under_18" });
  }
  if (context.pregnantOrNursing) {
    flags.push({ code: "pregnant_or_nursing" });
  }
  if (context.eatingDisorderHistory) {
    flags.push({ code: "eating_disorder_history" });
  }
  if (context.relevantMedicalConcerns) {
    flags.push({ code: "medical_concern" });
  }
  for (const symptom of [...new Set(context.symptoms ?? [])]) {
    flags.push({ code: "concerning_symptom", detail: symptom });
  }
  if (context.goalDirectionConflict) {
    flags.push({ code: "goal_direction_conflict" });
  }
  if (context.aggressiveGoalRate) {
    flags.push({ code: "aggressive_goal_rate" });
  }

  return {
    flags,
    requiresNonRestrictivePlan: flags.length > 0,
    allowNonRestrictiveTracking: true,
    message: flags.length > 0 ? SAFETY_GUIDANCE_MESSAGE : null,
  };
}
