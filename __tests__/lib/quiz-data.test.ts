import { existsSync } from "node:fs";
import { join } from "node:path";
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

  it("does not include the removed built-in lesson surveys", () => {
    for (const lesson of getAllLessons()) {
      expect(lesson).not.toHaveProperty("survey_items");
    }
  });

  it("each lesson should have quiz items", () => {
    const lessons = getAllLessons();
    for (const lesson of lessons) {
      expect(lesson.quiz_items.length).toBeGreaterThan(0);
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

  it("provides a local illustration for every multiple choice question", () => {
    const lessons = getAllLessons();
    const mcqs = lessons.flatMap((lesson) =>
      lesson.quiz_items.filter((item) => item.type === "multiple_choice"),
    );
    expect(mcqs).toHaveLength(32);

    for (const item of mcqs) {
      if (!item.image) throw new Error(`Missing illustration for ${item.item_id}`);
      expect(item.image).toBe(`/quiz-images/${item.item_id}.webp`);
      expect(existsSync(join(process.cwd(), "public", item.image.slice(1)))).toBe(true);
    }

    const confidenceChecks = lessons.flatMap((lesson) =>
      lesson.quiz_items.filter((item) => item.type === "confidence_check"),
    );
    expect(confidenceChecks.every((item) => !item.image)).toBe(true);
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
