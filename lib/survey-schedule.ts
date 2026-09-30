import type { Survey, SurveySchedule, SurveyStatus } from "./types";

const parse = (value?: string) => (value ? Date.parse(value) : NaN);

/**
 * The status a survey actually has right now (UC-SV-03, #80; dates optional
 * since #106).
 *
 * A survey that was never published is a draft. A published survey follows
 * its dates when it has them: before the publish date it is "scheduled", after
 * the due date it is "closed", otherwise it is "published".
 */
export const resolveSurveyStatus = (
  survey: Pick<Survey, "status" | "schedule">,
  now: Date = new Date(),
): SurveyStatus => {
  if (survey.status === "draft") return "draft";

  const publishAt = parse(survey.schedule?.publish_at);
  const dueAt = parse(survey.schedule?.due_at);
  const current = now.getTime();
  if (!Number.isNaN(publishAt) && current < publishAt) return "scheduled";
  if (!Number.isNaN(dueAt) && current > dueAt) return "closed";
  return "published";
};

/**
 * Validates publish settings. Both dates are optional, but a date that is
 * given must be valid, and the due date must come after the publish date.
 */
export const validateSchedule = (schedule: SurveySchedule | undefined): string[] => {
  const errors: string[] = [];
  const publishAt = parse(schedule?.publish_at);
  const dueAt = parse(schedule?.due_at);
  if (schedule?.publish_at && Number.isNaN(publishAt)) {
    errors.push("Publish date and time are invalid.");
  }
  if (schedule?.due_at && Number.isNaN(dueAt)) {
    errors.push("Due date and time are invalid.");
  }
  if (!Number.isNaN(publishAt) && !Number.isNaN(dueAt) && dueAt <= publishAt) {
    errors.push("Due date and time must be after the publish date and time.");
  }
  return errors;
};

/**
 * A survey needs at least one question, and every question needs a prompt and
 * a response field, before it can be published.
 */
export const validateSurveyIsPublishable = (survey: Pick<Survey, "questions">): string[] => {
  const errors: string[] = [];
  if (survey.questions.length === 0) {
    errors.push("A survey must contain at least one question before publishing.");
  }
  survey.questions.forEach((q, i) => {
    if (!q.stem?.trim()) errors.push(`Question ${i + 1} needs a prompt before publishing.`);
    if (!q.response_fields || q.response_fields.length === 0) {
      errors.push(`Question ${i + 1} needs at least one response field.`);
    }
  });
  return errors;
};

/**
 * Each learning task has one survey (#111). If older data holds more than
 * one, the most recently updated survey is the one in use.
 */
export const pickTaskSurvey = <T extends Pick<Survey, "updated_at">>(surveys: T[]): T | null =>
  surveys.length === 0
    ? null
    : [...surveys].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0];
