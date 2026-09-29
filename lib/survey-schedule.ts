import type { Survey, SurveySchedule, SurveyStatus } from "./types";

/**
 * Resolves the status a survey actually has right now (UC-SV-03, #80).
 *
 * A survey with no schedule is still a draft. Otherwise the status follows the
 * clock: before the publish time it is "scheduled", between publish and due it
 * is "published", and after the due time it is "closed" unless late
 * submissions are allowed (in which case it stays open and late work is
 * flagged at submission time).
 */
export const resolveSurveyStatus = (
  survey: Pick<Survey, "status" | "schedule">,
  now: Date = new Date(),
): SurveyStatus => {
  const schedule = survey.schedule;
  if (!schedule) return "draft";

  const publishAt = Date.parse(schedule.publish_at);
  const dueAt = Date.parse(schedule.due_at);
  if (Number.isNaN(publishAt) || Number.isNaN(dueAt)) return survey.status;

  const current = now.getTime();
  if (current < publishAt) return "scheduled";
  if (current <= dueAt) return "published";
  return schedule.allow_late_submissions ? "published" : "closed";
};

/** True when a submission made now would count as late. */
export const isLateSubmission = (
  schedule: SurveySchedule | undefined,
  now: Date = new Date(),
): boolean => {
  if (!schedule) return false;
  const dueAt = Date.parse(schedule.due_at);
  if (Number.isNaN(dueAt)) return false;
  return now.getTime() > dueAt;
};

/**
 * Validates publish settings. Returns human-readable problems; empty = valid.
 */
export const validateSchedule = (
  schedule: Partial<SurveySchedule> | undefined,
): string[] => {
  const errors: string[] = [];
  if (!schedule?.publish_at) {
    errors.push("Publish date and time are required.");
  }
  if (!schedule?.due_at) {
    errors.push("Due date and time are required.");
  }
  if (schedule?.publish_at && schedule?.due_at) {
    const publishAt = Date.parse(schedule.publish_at);
    const dueAt = Date.parse(schedule.due_at);
    if (Number.isNaN(publishAt)) errors.push("Publish date and time are invalid.");
    if (Number.isNaN(dueAt)) errors.push("Due date and time are invalid.");
    if (!Number.isNaN(publishAt) && !Number.isNaN(dueAt) && dueAt <= publishAt) {
      errors.push("Due date and time must be after the publish date and time.");
    }
  }
  return errors;
};

/**
 * Validates that a survey is complete enough to publish: it needs at least one
 * question, and every question needs at least one response field.
 */
export const validateSurveyIsPublishable = (
  survey: Pick<Survey, "questions">,
): string[] => {
  const errors: string[] = [];
  if (survey.questions.length === 0) {
    errors.push("A survey must contain at least one question before publishing.");
  }
  survey.questions.forEach((q, i) => {
    if (!q.stem?.trim()) {
      errors.push(`Question ${i + 1} needs a prompt before publishing.`);
    }
    if (!q.response_fields || q.response_fields.length === 0) {
      errors.push(`Question ${i + 1} needs at least one response field.`);
    }
  });
  return errors;
};
