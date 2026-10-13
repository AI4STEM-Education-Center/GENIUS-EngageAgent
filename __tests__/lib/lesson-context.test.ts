import { describe, expect, it } from "vitest";

import {
  getLessonGenerationContext,
  getStrategyContext,
  resolveQuizEvidence,
} from "@/lib/lesson-context";

describe("getLessonGenerationContext", () => {
  it("returns the lesson objective context for a lesson", () => {
    expect(getLessonGenerationContext(1)).toEqual({
      lessonNumber: 1,
      lessonTitle: "Lesson 1",
      learningObjective:
        "Students will construct temporal visual models and causal explanations to link unobservable energy transfer and interaction forces to the observable macroscopic changes in an object's shape and motion before and after an impact.",
    });
  });
});

describe("getStrategyContext", () => {
  it("returns the human-friendly label and description for a strategy", () => {
    expect(getStrategyContext("cognitive conflict")).toEqual({
      id: "cognitive conflict",
      label: "Cognitive Conflict",
      description:
        "Challenges a student’s current belief with surprising evidence so they rethink the concept.",
    });
  });
});

describe("resolveQuizEvidence", () => {
  it("resolves selected answers, confidence, correctness, and misconception text", () => {
    const evidence = resolveQuizEvidence(1, {
      L1_Q1: "D",
      L1_Q1_confidence: "B",
    });

    expect(evidence[0]).toEqual({
      itemId: "L1_Q1",
      questionNumber: 1,
      stem: "A phone drops onto a soft pillow. The phone looks the same afterward. Which statement best describes the collision?",
      selectedOption: "D",
      selectedText: "The force was weak because nothing was damaged.",
      correctOption: "C",
      correctText: "The phone and pillow pushed on each other.",
      isCorrect: false,
      confidenceOption: "B",
      confidenceText: "Somewhat confident",
      misconceptionCode: "a",
      misconceptionText:
        "If nothing looks damaged after the collision, the force must have been weak.",
    });
  });
});

describe("current curriculum slide focus", () => {
  it.each(["analogy", "cognitive conflict", "experience bridging"] as const)("keeps %s on the current camp topic instead of a numbered lesson's old example", async strategy => {
    const { slidePrompt } = await import("@/lib/slides/prompts");
    const context = JSON.parse(slidePrompt(getLessonGenerationContext(8)!, strategy).user);
    expect(context.referenceVariables.TOPIC).toContain("superball, a clay ball, and a steel ball");
    expect(context.referenceVariables.TARGET_CONCEPT).toBe("Conservation of energy and energy transfer (PS3.B)");
    expect(context.lessonFocus).not.toContain("cart-launcher");
    expect(context.lessonFocus).toContain("Do not invent observations or measurements");
  });
});
