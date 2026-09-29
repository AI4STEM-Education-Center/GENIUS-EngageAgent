import { resolveSurveyStatus } from "./survey-schedule";
import type { Survey } from "./types";

export type SurveyAvailability =
  | { open: true; late: boolean }
  | { open: false; reason: "draft" | "scheduled" | "closed"; message: string };

/**
 * Whether a student may open and submit a survey right now (UC-SV-02, #79).
 * Drafts are never shown to students; scheduled surveys report when they open;
 * closed surveys refuse submissions. A survey past its due time that still
 * accepts late work is open, but submissions are flagged late.
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
    const opens = survey.schedule ? new Date(survey.schedule.publish_at).toLocaleString() : "";
    return {
      open: false,
      reason: "scheduled",
      message: opens ? `This survey opens on ${opens}.` : "This survey is not open yet.",
    };
  }
  if (status === "closed") {
    return {
      open: false,
      reason: "closed",
      message: "This survey is closed. The due date has passed.",
    };
  }
  const late =
    Boolean(survey.schedule) &&
    now.getTime() > Date.parse(survey.schedule!.due_at);
  return { open: true, late };
};

/** Every response field is required in V1. Returns the unanswered ones. */
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

/** Keeps only answers for fields that exist on the survey, as trimmed-safe strings. */
export const sanitizeAnswers = (
  survey: Pick<Survey, "questions">,
  answers: unknown,
): Record<string, string> => {
  if (!answers || typeof answers !== "object") return {};
  const known = new Set(
    survey.questions.flatMap((q) => q.response_fields.map((f) => f.field_id)),
  );
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
    if (known.has(key) && typeof value === "string") clean[key] = value;
  }
  return clean;
};
