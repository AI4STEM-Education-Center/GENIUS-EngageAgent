import { describe, expect, it } from "vitest";
import { getAllLessons, getLesson } from "@/lib/quiz-data";
import { countAnswered, firstUnanswered, groupQuizItems } from "@/lib/student-quiz-progress";
import type { QuizItem, Survey } from "@/lib/types";

const items = getLesson(1)!.quiz_items;
const survey: Pick<Survey, "questions"> = {
  questions: [
    { item_id: "s1", question_number: 1, category: "experience_details", stem: "One box", response_fields: [{ field_id: "a", label: "A", response_type: "text" }] },
    { item_id: "s2", question_number: 2, category: "experience_details", stem: "Two boxes", response_fields: [
      { field_id: "b", label: "B", response_type: "text" },
      { field_id: "c", label: "C", response_type: "text" },
    ] },
  ],
};

describe("groupQuizItems", () => {
  it("puts every lesson question in one card with its confidence check", () => {
    for (const lesson of getAllLessons()) {
      const cards = groupQuizItems(lesson.quiz_items);
      expect(cards).toHaveLength(4);
      for (const card of cards) {
        expect(card.question.type).toBe("multiple_choice");
        expect(card.confidence?.item_id).toBe(`${card.question.item_id}_confidence`);
      }
    }
  });

  it("still shows a confidence check that has no question", () => {
    const orphan: QuizItem = { item_id: "X_confidence", type: "confidence_check", stem: "How confident?", options: { A: "Very" } };
    const cards = groupQuizItems([items[0], orphan]);
    expect(cards.map((c) => c.question.item_id)).toEqual(["L1_Q1", "X_confidence"]);
    expect(cards[0].confidence).toBeUndefined();
  });
});

describe("countAnswered", () => {
  it("counts each quiz answer and confidence, and each finished survey question (Lesson 1 + 2 survey questions = 10)", () => {
    expect(countAnswered(items, {}, survey, {})).toEqual({ done: 0, total: 10 });
    const answers = { L1_Q1: "C", L1_Q1_confidence: "A", L1_Q2: "A" };
    expect(countAnswered(items, answers, survey, { a: "yes", b: "half", c: "  " })).toEqual({ done: 4, total: 10 });
    expect(countAnswered(items, answers, survey, { a: "yes", b: "half", c: "done" })).toEqual({ done: 5, total: 10 });
  });

  it("works without a quiz or without a survey", () => {
    expect(countAnswered([], {}, survey, { a: "x" })).toEqual({ done: 1, total: 2 });
    expect(countAnswered(items, {}, null, {})).toEqual({ done: 0, total: 8 });
  });
});

describe("firstUnanswered", () => {
  const cards = groupQuizItems(items);

  it("finds the first card with a missing answer or confidence, then the survey", () => {
    expect(firstUnanswered(cards, {}, survey, {})).toEqual({ part: "quiz", itemId: "L1_Q1" });
    expect(firstUnanswered(cards, { L1_Q1: "C" }, survey, {})).toEqual({ part: "quiz", itemId: "L1_Q1" });
    expect(firstUnanswered(cards, { L1_Q1: "C", L1_Q1_confidence: "A", L1_Q3: "A" }, survey, {})).toEqual({ part: "quiz", itemId: "L1_Q2" });

    const quizDone = Object.fromEntries(items.map((item) => [item.item_id, "A"]));
    expect(firstUnanswered(cards, quizDone, survey, { a: "yes", b: "x" })).toEqual({ part: "survey", itemId: "s2" });
    expect(firstUnanswered(cards, quizDone, survey, { a: "yes", b: "x", c: "y" })).toBeNull();
  });
});
