import type { QuizItem, Survey } from "./types";

/**
 * "Get ready for the lesson" (#180): how the student's task is laid out and
 * counted. A quiz question and its paired confidence check ("<id>_confidence")
 * share one card; each counts as its own answer, as in the v8.3 prototype.
 */
export type QuizCard = { question: QuizItem; confidence?: QuizItem };

export function groupQuizItems(items: QuizItem[]): QuizCard[] {
  const byId = new Map(items.map((item) => [item.item_id, item]));
  const paired = new Set<string>();
  const cards: QuizCard[] = [];
  for (const item of items) {
    if (item.type !== "multiple_choice") continue;
    const confidence = byId.get(`${item.item_id}_confidence`);
    if (confidence?.type === "confidence_check") paired.add(confidence.item_id);
    cards.push({ question: item, confidence: confidence?.type === "confidence_check" ? confidence : undefined });
  }
  // A confidence check without its question still has to be answered.
  for (const item of items) {
    if (item.type === "confidence_check" && !paired.has(item.item_id)) cards.push({ question: item });
  }
  return cards;
}

const surveyQuestionAnswered = (question: Survey["questions"][number], answers: Record<string, string>) =>
  question.response_fields.every((field) => Boolean(answers[field.field_id]?.trim()));

/** "{done} of {total} answered": every quiz item, plus each survey question once all its boxes are filled. */
export function countAnswered(
  quizItems: QuizItem[],
  answers: Record<string, string>,
  survey: Pick<Survey, "questions"> | null,
  surveyAnswers: Record<string, string>,
) {
  const surveyQuestions = survey?.questions ?? [];
  return {
    done:
      quizItems.filter((item) => answers[item.item_id]).length +
      surveyQuestions.filter((question) => surveyQuestionAnswered(question, surveyAnswers)).length,
    total: quizItems.length + surveyQuestions.length,
  };
}

/** Where "Next unanswered" goes: the first card, in page order, with anything left to answer. */
export function firstUnanswered(
  cards: QuizCard[],
  answers: Record<string, string>,
  survey: Pick<Survey, "questions"> | null,
  surveyAnswers: Record<string, string>,
): { part: "quiz" | "survey"; itemId: string } | null {
  for (const { question, confidence } of cards) {
    if (!answers[question.item_id] || (confidence && !answers[confidence.item_id])) {
      return { part: "quiz", itemId: question.item_id };
    }
  }
  const open = survey?.questions.find((question) => !surveyQuestionAnswered(question, surveyAnswers));
  return open ? { part: "survey", itemId: open.item_id } : null;
}
