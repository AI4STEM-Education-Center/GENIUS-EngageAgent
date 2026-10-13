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

  it("keeps experience questions in the quiz rather than a separate survey", () => {
    for (const lesson of getAllLessons()) {
      expect(lesson).not.toHaveProperty("survey_items");
    }
  });

  it("appends all 21 lesson-specific experience questions after the four scored questions", () => {
    const counts = [3, 3, 3, 3, 3, 2, 2, 2];
    for (const lesson of getAllLessons()) {
      const experiences = lesson.quiz_items.filter((item) => item.type === "experience");
      expect(experiences).toHaveLength(counts[lesson.lesson_number - 1]);
      expect(lesson.quiz_items.slice(0, 8).every((item) => item.type !== "experience")).toBe(true);
      experiences.forEach((item, index) => {
        expect(item.item_id).toBe(`L${lesson.lesson_number}_S${index + 1}`);
        expect(item.question_number).toBe(index + 5);
        expect(item.correct_answer).toBeUndefined();
        expect(item.options).toEqual({});
        expect(item.response_fields?.length).toBeGreaterThan(0);
        expect(item.response_fields?.every((field) => field.response_type === "text")).toBe(true);
        const next = lesson.quiz_items[lesson.quiz_items.indexOf(item) + 1];
        expect(next.item_id).toBe(`${item.item_id}_confidence`);
        expect(next.type).toBe("confidence_check");
        expect(next.stem).toContain("your experience");
        expect(Object.keys(next.options)).toEqual(["A", "B", "C", "D"]);
      });
    }
  });

  it("preserves the supplied lesson contexts and original response IDs", () => {
    const distinctiveTopics = [
      [1, "L1_S3", "fell or crashed"],
      [2, "L2_S2", "moving fast hit something slower"],
      [3, "L3_S1", "sting or buzzing vibration"],
      [4, "L4_S3", "stayed loose or bent"],
      [5, "L5_S3", "stop or push something heavy"],
      [6, "L6_S1", "prevent damage during a collision"],
      [7, "L7_S2", "harder to stop"],
      [8, "L8_S1", "store energy before releasing"],
    ] as const;
    for (const [number, id, phrase] of distinctiveTopics) {
      const item = getLessonQuizItems(number).find((question) => question.item_id === id)!;
      expect(item.stem).toContain(phrase);
      expect(item.response_fields!.every((field) => field.field_id.startsWith(`${id}_`))).toBe(true);
    }
    expect(JSON.stringify(getAllLessons())).not.toContain("XXX");
    expect(getLessonQuizItems(2).find((item) => item.item_id === "L2_S3")?.response_fields)
      .toContainEqual(expect.objectContaining({ field_id: "L2_S3_changed_more", response_type: "text" }));
    expect(getLessonQuizItems(8).find((item) => item.item_id === "L8_S2")?.response_fields)
      .toContainEqual(expect.objectContaining({ label: expect.stringContaining("warmth") }));
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
