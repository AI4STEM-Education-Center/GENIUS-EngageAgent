import { describe, it, expect } from "vitest";
import { getAllLessons } from "@/lib/quiz-data";
import {
  LESSON_MISCONCEPTIONS,
  MISCONCEPTION_TEXT,
  MisconceptionId,
  isMisconceptionId,
  listMisconceptions,
  toMisconceptionIds,
} from "@/lib/misconceptions";

describe("misconception enum", () => {
  it("maps every misconception code in every lesson, with the same text", () => {
    for (const lesson of getAllLessons()) {
      const mapped = LESSON_MISCONCEPTIONS[lesson.lesson_number];
      expect(Object.keys(mapped).sort()).toEqual(
        Object.keys(lesson.misconceptions).sort(),
      );
      for (const [code, text] of Object.entries(lesson.misconceptions)) {
        expect(MISCONCEPTION_TEXT[mapped[code]]).toBe(text);
      }
    }
  });

  it("resolves every code the quiz items point to", () => {
    for (const lesson of getAllLessons()) {
      for (const item of lesson.quiz_items) {
        const fields = [
          item.matched_misconception,
          ...Object.values(item.distractor_misconception_map ?? {}),
        ];
        for (const field of fields) {
          if (!field) continue;
          const codeCount = field.split(",").length;
          expect(toMisconceptionIds(lesson.lesson_number, field)).toHaveLength(codeCount);
        }
      }
    }
  });

  it("has one entry per distinct misconception, and every ID is used", () => {
    const texts = Object.values(MISCONCEPTION_TEXT);
    expect(new Set(texts).size).toBe(texts.length);

    const used = new Set(
      Object.values(LESSON_MISCONCEPTIONS).flatMap((codes) => Object.values(codes)),
    );
    expect(used).toEqual(new Set(Object.values(MisconceptionId)));
  });

  it("uses one ID for the misconceptions Lessons 3 and 4 share", () => {
    expect(LESSON_MISCONCEPTIONS[3].a).toBe(LESSON_MISCONCEPTIONS[4]["1-a"]);
    expect(LESSON_MISCONCEPTIONS[3].b).toBe(LESSON_MISCONCEPTIONS[4]["1-b"]);
  });

  it("splits multi-code fields and ignores unknown codes", () => {
    expect(toMisconceptionIds(5, "1-a, 2-a")).toEqual([
      MisconceptionId.HeavierObjectExertsLargerForce,
      MisconceptionId.MoreMassiveObjectHasLargerPeakForce,
    ]);
    expect(toMisconceptionIds(1, "a")).toEqual([MisconceptionId.NoVisibleDamageMeansWeakForce]);
    expect(toMisconceptionIds(1, "z")).toEqual([]);
    expect(toMisconceptionIds(1, undefined)).toEqual([]);
    expect(toMisconceptionIds(99, "a")).toEqual([]);
  });

  it("lists misconceptions in ID order and checks IDs", () => {
    const list = listMisconceptions();
    expect(list).toHaveLength(31);
    expect(list[0]).toEqual({
      id: "MC01",
      text: "If nothing looks damaged after the collision, the force must have been weak.",
    });
    expect(isMisconceptionId("MC31")).toBe(true);
    expect(isMisconceptionId("a")).toBe(false);
  });
});
