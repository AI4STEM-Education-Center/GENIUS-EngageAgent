import { describe, it, expect } from "vitest";
import { getAllLessons, getLesson, getLessonQuizItems } from "@/lib/quiz-data";

describe("getAllLessons", () => {
  it("should return all 8 lessons", () => {
    const lessons = getAllLessons();
    expect(lessons).toHaveLength(8);
  });

  it("should have correct lesson numbers", () => {
    const lessons = getAllLessons();
    for (let i = 0; i < 8; i++) {
      expect(lessons[i].lesson_number).toBe(i + 1);
    }
  });

  it("each lesson should have quiz items", () => {
    const lessons = getAllLessons();
    for (const lesson of lessons) {
      expect(lesson.quiz_items.length).toBeGreaterThan(0);
    }
  });

  it("each lesson should have a beginning-of-lesson survey", () => {
    const lessons = getAllLessons();
    for (const lesson of lessons) {
      expect(lesson.survey_items.length).toBeGreaterThanOrEqual(2);
      for (const item of lesson.survey_items) {
        expect(item.response_fields.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses unique survey response field IDs across all lessons", () => {
    const fieldIds = getAllLessons().flatMap((lesson) =>
      lesson.survey_items.flatMap((item) =>
        item.response_fields.map((field) => field.field_id),
      ),
    );

    expect(new Set(fieldIds).size).toBe(fieldIds.length);
  });

  it("gives every choice response a non-empty option list", () => {
    const choiceFields = getAllLessons().flatMap((lesson) =>
      lesson.survey_items.flatMap((item) =>
        item.response_fields.filter((field) => field.response_type === "choice"),
      ),
    );

    expect(choiceFields.length).toBeGreaterThan(0);
    for (const field of choiceFields) {
      expect(field.options?.length).toBeGreaterThan(1);
    }
  });

  it("each lesson should have misconceptions", () => {
    const lessons = getAllLessons();
    for (const lesson of lessons) {
      expect(Object.keys(lesson.misconceptions).length).toBeGreaterThan(0);
    }
  });

  it("most lessons should have core ideas", () => {
    const lessons = getAllLessons();
    const withCoreIdeas = lessons.filter((l) => l.core_ideas.length > 0);
    expect(withCoreIdeas.length).toBeGreaterThanOrEqual(7);
  });
});

describe("getLesson", () => {
  it("should return lesson 1", () => {
    const lesson = getLesson(1);
    expect(lesson).not.toBeNull();
    expect(lesson!.lesson_number).toBe(1);
  });

  it("should return null for non-existent lesson", () => {
    expect(getLesson(0)).toBeNull();
    expect(getLesson(9)).toBeNull();
    expect(getLesson(99)).toBeNull();
  });
});

describe("getLessonQuizItems", () => {
  it("should return quiz items for lesson 1", () => {
    const items = getLessonQuizItems(1);
    expect(items.length).toBeGreaterThan(0);
  });

  it("should include both multiple choice and confidence check items", () => {
    const items = getLessonQuizItems(1);
    const types = new Set(items.map((item) => item.type));
    expect(types.has("multiple_choice")).toBe(true);
    expect(types.has("confidence_check")).toBe(true);
  });

  it("each multiple choice item should have options A-D", () => {
    const items = getLessonQuizItems(1).filter((i) => i.type === "multiple_choice");
    for (const item of items) {
      expect(item.options).toHaveProperty("A");
      expect(item.options).toHaveProperty("B");
      expect(item.options).toHaveProperty("C");
      expect(item.options).toHaveProperty("D");
    }
  });

  it("each lesson should have a learning objective", () => {
    const lessons = getAllLessons();
    for (const lesson of lessons) {
      expect(lesson.learning_objective).toBeTruthy();
    }
  });

  it("should return empty for non-existent lesson", () => {
    expect(getLessonQuizItems(99)).toEqual([]);
  });
});
