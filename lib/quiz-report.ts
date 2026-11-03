import type { Lesson } from "./types";

/**
 * A student's feedback report for one lesson's quiz (#182): each question with
 * their answer, the correct answer and how confident they felt. The teacher
 * releases reports for the whole task, after the lesson is taught or earlier.
 */

export type ReportRelease = { releasedAt: string; reason: "taught" | "early"; lessonNumber: number };

export type ReportOption = { key: string; text: string };
export type QuizReportItem = {
  number: number;
  stem: string;
  answer: ReportOption | null;
  correctAnswer: ReportOption | null;
  isCorrect: boolean;
  confidence: string | null;
  /** Written per quiz item in the lesson data; most items don't have one yet. */
  explanation?: string;
};
export type QuizReport = { lessonNumber: number; lessonTitle: string; correct: number; total: number; items: QuizReportItem[] };

const option = (options: Record<string, string>, key: string | undefined): ReportOption | null =>
  key && options[key] !== undefined ? { key, text: options[key] } : null;

export function buildQuizReport(lesson: Lesson, answers: Record<string, string | undefined>): QuizReport {
  const confidence = new Map(lesson.quiz_items.filter(item => item.type === "confidence_check").map(item => [item.item_id, item]));
  const items = lesson.quiz_items.filter(item => item.type === "multiple_choice").map((item, index): QuizReportItem => {
    const answer = option(item.options, answers[item.item_id]);
    const check = confidence.get(`${item.item_id}_confidence`);
    return {
      number: item.question_number ?? index + 1,
      stem: item.stem,
      answer,
      correctAnswer: option(item.options, item.correct_answer),
      isCorrect: Boolean(answer && answer.key === item.correct_answer),
      confidence: check ? option(check.options, answers[check.item_id])?.text ?? null : null,
      ...(item.explanation?.trim() ? { explanation: item.explanation.trim() } : {}),
    };
  });
  return {
    lessonNumber: lesson.lesson_number,
    lessonTitle: lesson.lesson_title,
    correct: items.filter(item => item.isCorrect).length,
    total: items.length,
    items,
  };
}
