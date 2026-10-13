import type { QuizItem } from "./types";

/** Version 2 adds ungraded experience questions to the lesson quiz. */
export const CURRENT_QUIZ_VERSION = 2;
export const MAX_QUIZ_TEXT_LENGTH = 4000;

/** Keep an already-published legacy quiz consistent with what students received. */
export function getQuizItemsForVersion(
  items: readonly QuizItem[],
  version?: number,
): QuizItem[] {
  if (typeof version === "number" && version >= CURRENT_QUIZ_VERSION) {
    return [...items];
  }

  const experienceIds = new Set(
    items.filter((item) => item.type === "experience").map((item) => item.item_id),
  );
  return items.filter(
    (item) =>
      item.type !== "experience" &&
      !(
        item.type === "confidence_check" &&
        experienceIds.has(item.item_id.replace(/_confidence$/, ""))
      ),
  );
}

export function getQuizQuestionCount(items: readonly QuizItem[]): number {
  return items.filter((item) => item.type !== "confidence_check").length;
}

/** Shared by the student form and API so both require the same complete response. */
export function getQuizAnswerValidationError(
  items: readonly QuizItem[],
  answers: Record<string, unknown>,
): string | null {
  if (items.length === 0) return "This quiz has no questions.";

  for (const item of items) {
    if (item.type === "experience") {
      const fields = item.response_fields;
      if (!fields?.length) return `Question ${item.question_number ?? item.item_id} has no answer fields.`;
      for (const field of fields) {
        const value = answers[field.field_id];
        if (typeof value !== "string" || !value.trim()) {
          return `Complete “${field.label}” in question ${item.question_number ?? item.item_id}.`;
        }
        if (value.length > MAX_QUIZ_TEXT_LENGTH) {
          return `Keep “${field.label}” within ${MAX_QUIZ_TEXT_LENGTH} characters.`;
        }
        if (field.response_type === "choice" && !field.options?.includes(value)) {
          return `Choose a listed answer for “${field.label}”.`;
        }
      }
      continue;
    }

    const value = answers[item.item_id];
    if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(item.options, value)) {
      return item.type === "confidence_check"
        ? "Choose a confidence level for every question."
        : `Choose an answer for question ${item.question_number ?? item.item_id}.`;
    }
  }

  return null;
}

export function isQuizComplete(
  items: readonly QuizItem[],
  answers: Record<string, unknown>,
): boolean {
  return getQuizAnswerValidationError(items, answers) === null;
}
