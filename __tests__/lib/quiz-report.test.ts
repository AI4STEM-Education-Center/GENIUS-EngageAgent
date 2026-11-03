import { expect, it } from "vitest";
import { getLesson } from "@/lib/quiz-data";
import { buildQuizReport } from "@/lib/quiz-report";

const lesson = getLesson(3)!;
const questions = lesson.quiz_items.filter(item => item.type === "multiple_choice");

it("lists each quiz question with the answer, the correct answer and the confidence", () => {
  const [first, second] = questions;
  const wrong = Object.keys(second.options).find(key => key !== second.correct_answer)!;
  const report = buildQuizReport(lesson, {
    [first.item_id]: first.correct_answer, [`${first.item_id}_confidence`]: "B",
    [second.item_id]: wrong,
  });
  expect(report).toMatchObject({ lessonNumber: 3, lessonTitle: lesson.lesson_title, correct: 1, total: questions.length });
  expect(report.items[0]).toEqual({
    number: 1, stem: first.stem, isCorrect: true, confidence: "Somewhat confident",
    answer: { key: first.correct_answer, text: first.options[first.correct_answer!] },
    correctAnswer: { key: first.correct_answer, text: first.options[first.correct_answer!] },
  });
  expect(report.items[1]).toMatchObject({ isCorrect: false, answer: { key: wrong }, confidence: null });
  // Unanswered questions are not correct.
  expect(report.items.slice(2).every(item => item.answer === null && !item.isCorrect)).toBe(true);
});

it("adds the Why line only for items that have an explanation", () => {
  const withWhy = { ...lesson, quiz_items: lesson.quiz_items.map((item, i) => (i === 0 ? { ...item, explanation: " Steel bends a tiny amount. " } : item)) };
  const report = buildQuizReport(withWhy, {});
  expect(report.items[0].explanation).toBe("Steel bends a tiny amount.");
  expect(report.items[1]).not.toHaveProperty("explanation");
});
