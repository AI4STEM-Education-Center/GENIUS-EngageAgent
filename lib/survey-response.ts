import { resolveSurveyStatus } from "./survey-schedule";
import type { Survey } from "./types";

export type SurveyAvailability =
  | { open: true }
  | { open: false; reason: "draft" | "scheduled" | "closed"; message: string };

/**
 * Whether a student can answer the survey right now (UC-SV-02, #79).
 * Drafts are hidden, a scheduled survey says when it opens, and a survey past
 * its due date is closed (there are no late submissions, #106).
 */
export const getSurveyAvailability = (
  survey: Pick<Survey, "status" | "schedule">,
  now: Date = new Date(),
): SurveyAvailability => {
  const status = resolveSurveyStatus(survey, now);
  if (status === "draft") {
    return { open: false, reason: "draft", message: "This survey is not available." };
  }
  if (status === "scheduled") {
    const opens = survey.schedule?.publish_at
      ? new Date(survey.schedule.publish_at).toLocaleString()
      : "";
    return {
      open: false,
      reason: "scheduled",
      message: opens ? `The survey opens on ${opens}.` : "The survey is not open yet.",
    };
  }
  if (status === "closed") {
    return { open: false, reason: "closed", message: "The survey is closed. The due date has passed." };
  }
  return { open: true };
};

/** Every response field is required. Returns the unanswered ones. */
export const findMissingAnswers = (
  survey: Pick<Survey, "questions">,
  answers: Record<string, string>,
): Array<{ questionNumber: number; fieldId: string; label: string }> => {
  const missing: Array<{ questionNumber: number; fieldId: string; label: string }> = [];
  survey.questions.forEach((q, qi) => {
    q.response_fields.forEach((f) => {
      if (!answers[f.field_id]?.trim()) {
        missing.push({ questionNumber: qi + 1, fieldId: f.field_id, label: f.label });
      }
    });
  });
  return missing;
};

/** Keeps only string answers for fields that exist on the survey. */
export const sanitizeAnswers = (survey: Pick<Survey, "questions">, answers: unknown): Record<string, string> => {
  if (!answers || typeof answers !== "object") return {};
  const known = new Set(survey.questions.flatMap((q) => q.response_fields.map((f) => f.field_id)));
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
    if (known.has(key) && typeof value === "string") clean[key] = value;
  }
  return clean;
};
