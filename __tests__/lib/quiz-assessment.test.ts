import { describe, expect, it } from "vitest";
import { getAllLessons, getLesson } from "@/lib/quiz-data";
import {
  CURRENT_QUIZ_VERSION,
  MAX_QUIZ_TEXT_LENGTH,
  getQuizAnswerValidationError,
  getQuizItemsForVersion,
  getQuizQuestionCount,
  isQuizComplete,
} from "@/lib/quiz-assessment";
import { resolveQuizEvidence } from "@/lib/lesson-context";
import { countClassResponses } from "@/lib/strategy-recommendation";
import type { QuizItem } from "@/lib/types";

function completedAnswers(items: QuizItem[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const item of items) {
    if (item.type === "experience") {
      for (const field of item.response_fields ?? []) answers[field.field_id] = "My own experience";
    } else {
      answers[item.item_id] = item.correct_answer ?? "A";
    }
  }
  return answers;
}

describe("quiz publication versions", () => {
  it("keeps older published quizzes at four scored questions and four confidence checks", () => {
    for (const lesson of getAllLessons()) {
      for (const version of [undefined, 1]) {
        const items = getQuizItemsForVersion(lesson.quiz_items, version);
        expect(items).toHaveLength(8);
        expect(getQuizQuestionCount(items)).toBe(4);
        expect(items.every((item) => !item.item_id.includes("_S"))).toBe(true);
      }
    }
  });

  it("includes all experience questions and confidence checks in a new publication", () => {
    for (const lesson of getAllLessons()) {
      const items = getQuizItemsForVersion(lesson.quiz_items, CURRENT_QUIZ_VERSION);
      expect(getQuizQuestionCount(items)).toBe(lesson.lesson_number <= 5 ? 7 : 6);
      expect(items).toEqual(lesson.quiz_items);
      expect(items).not.toBe(lesson.quiz_items);
    }
  });
});

describe("unified quiz completion", () => {
  const lesson = getLesson(2)!;
  const items = lesson.quiz_items;

  it("accepts a complete response for every lesson", () => {
    for (const current of getAllLessons()) {
      expect(isQuizComplete(current.quiz_items, completedAnswers(current.quiz_items))).toBe(true);
    }
  });

  it("requires the experience answers and every new confidence check", () => {
    const legacy = getQuizItemsForVersion(items, 1);
    expect(isQuizComplete(legacy, completedAnswers(legacy))).toBe(true);
    expect(isQuizComplete(items, completedAnswers(legacy))).toBe(false);

    const answers = completedAnswers(items);
    answers.L2_S2_hit_object = " \n\t ";
    expect(getQuizAnswerValidationError(items, answers)).toContain("What it hit");
    answers.L2_S2_hit_object = "The fence";
    delete answers.L2_S3_confidence;
    expect(getQuizAnswerValidationError(items, answers)).toContain("confidence");
    answers.L2_S3_confidence = "D";
    expect(isQuizComplete(items, answers)).toBe(true);
  });

  it("allows honest absence of experience rather than requiring invented memories", () => {
    const answers = completedAnswers(items);
    for (const item of items.filter((question) => question.type === "experience")) {
      for (const field of item.response_fields!) answers[field.field_id] = "I don't remember an example.";
    }
    expect(isQuizComplete(items, answers)).toBe(true);
  });

  it("rejects invalid options, non-string text, and oversized answers", () => {
    const answers: Record<string, unknown> = completedAnswers(items);
    answers.L2_Q1 = "toString";
    expect(isQuizComplete(items, answers)).toBe(false);
    answers.L2_Q1 = "A";
    answers.L2_S1_activity = 12;
    expect(isQuizComplete(items, answers)).toBe(false);
    answers.L2_S1_activity = "a".repeat(MAX_QUIZ_TEXT_LENGTH + 1);
    expect(getQuizAnswerValidationError(items, answers)).toContain(`${MAX_QUIZ_TEXT_LENGTH}`);
    answers.L2_S1_activity = "a".repeat(MAX_QUIZ_TEXT_LENGTH);
    expect(isQuizComplete(items, answers)).toBe(true);
    expect(isQuizComplete([], {})).toBe(false);
  });

  it("does not score personal experience or change the misconception denominator", () => {
    const answers = completedAnswers(items);
    const legacyAnswers = completedAnswers(getQuizItemsForVersion(items, 1));
    const evidence = resolveQuizEvidence(2, answers);
    expect(evidence).toHaveLength(4);
    expect(evidence.every((item) => item.isCorrect)).toBe(true);
    expect(countClassResponses(lesson, [answers])).toEqual(countClassResponses(lesson, [legacyAnswers]));
  });
});
