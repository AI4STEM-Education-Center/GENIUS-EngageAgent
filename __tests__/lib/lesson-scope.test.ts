import { describe, expect, it } from "vitest";
import { registerLesson } from "@/lib/lesson-registry";
import { enterLessonScope, runInLessonScope } from "@/lib/lesson-scope";
import { getAllLessons, getLesson } from "@/lib/quiz-data";
import { lessonFromDraft, emptyDraftQuizItem } from "@/lib/lessons";
import { MisconceptionId } from "@/lib/misconceptions";
import { getSlideLearningTarget } from "@/lib/slides/learning-target";
import { getLessonGenerationContext, resolveQuizEvidence } from "@/lib/lesson-context";
import { buildMaterialPrompt, summarizeDiagnosticAnswers } from "@/lib/material-prompts";
import { getStrategyContext } from "@/lib/lesson-context";
import { slidePrompt } from "@/lib/slides/prompts";
import { defaultStrategyFocus, lessonCoreIdeas, lessonFocusMisconceptions, classQuizCounts } from "@/lib/strategy-focus";
import { buildClassPlan, buildPromptVariables, buildTeacherSummary, getMultipleChoiceItems, recommendStrategy } from "@/lib/strategy-recommendation";
import { buildQuizReport } from "@/lib/quiz-report";
import type { Lesson } from "@/lib/types";

const stored = (lessonNumber: number, objective: string): Lesson => ({ ...getAllLessons()[0], lesson_number: lessonNumber, learning_objective: objective });

it("inside a request, only that request's lessons count: never the files", () => {
  const edited = stored(1, "edited");
  runInLessonScope([edited], () => {
    expect(getLesson(1)).toBe(edited);
    expect(getLesson(2)).toBeNull();
  });
  expect(getLesson(1)?.learning_objective).toBe(getAllLessons()[0].learning_objective);
});

it("outside a request, only lessons 1-8 fall back to the files", () => {
  expect(getLesson(8)?.lesson_number).toBe(8);
  expect(getLesson(9)).toBeNull();
});

it("keeps requests apart when they wait on each other", async () => {
  const request = async (objective: string, delay: number) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    enterLessonScope(new Map([[1, stored(1, objective)]]));
    await new Promise((resolve) => setTimeout(resolve, delay));
    const first = getLesson(1)?.learning_objective;
    await Promise.all([new Promise((resolve) => setTimeout(resolve, delay))]);
    return [first, getLesson(1)?.learning_objective];
  };
  const results = await Promise.all(["a", "b", "c", "d"].map((objective, index) => request(objective, 4 - index)));
  expect(results).toEqual([["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"]]);
  // And nothing leaks back to the caller.
  expect(getLesson(1)?.learning_objective).toBe(getAllLessons()[0].learning_objective);
});

it("refuses to register a lesson on the server, where it would be shared between requests", () => {
  expect(() => registerLesson(stored(1, "x"))).toThrow("browser");
});

it("takes a new lesson's slide heading from its topic, and fails clearly when it isn't loaded", () => {
  expect(getSlideLearningTarget(1)).toBe("Shape and motion during contact");
  expect(() => getSlideLearningTarget(9)).toThrow("learning target");
  const mc = MisconceptionId.NoVisibleDamageMeansWeakForce;
  const nine = lessonFromDraft({ title: "W", objective: "o", topic: " Waves ", targetConcept: "c", coreIdeas: ["i"], misconceptions: [mc], quizItems: [emptyDraftQuizItem("q")] }, 9);
  expect(runInLessonScope([nine], () => getSlideLearningTarget(9))).toBe("Waves");
});

describe("lessons 1-8 give exactly the same results read from storage as from the files", () => {
  /** Everything the app computes from a lesson, for three different classes of answers. */
  const results = (lesson: Lesson) => {
    const n = lesson.lesson_number;
    const context = getLessonGenerationContext(n)!;
    const items = getMultipleChoiceItems(lesson);
    const classes = [0, 1, 2].map((shift) => ["A", "B", "C", "D"].map((_, student) => Object.fromEntries(items.map((item, index) => {
      const options = Object.keys(item.options);
      return [item.item_id, options[(index + student + shift) % options.length]];
    }))));
    return JSON.stringify({
      context, misconceptions: lessonFocusMisconceptions(n), ideas: lessonCoreIdeas(n), target: getSlideLearningTarget(n),
      perClass: classes.map((answers) => {
        const recommendation = recommendStrategy(n, answers);
        return {
          recommendation, summary: buildTeacherSummary(recommendation), plan: buildClassPlan(recommendation),
          variables: recommendation.strategy === "cognitive conflict" && !recommendation.target ? null : buildPromptVariables(recommendation),
          counts: classQuizCounts(n, answers), focus: defaultStrategyFocus(n, recommendation.counts),
          evidence: resolveQuizEvidence(n, answers[0]), diagnostic: summarizeDiagnosticAnswers(n, answers), report: buildQuizReport(lesson, answers[0]),
        };
      }),
      prompts: ["analogy", "cognitive conflict", "experience bridging", "engaged critiquing"].map((strategy) => buildMaterialPrompt(context, getStrategyContext(strategy))),
      slides: (["cognitive conflict", "experience bridging", "engaged critiquing"] as const).map((strategy) => slidePrompt(context, strategy)),
    });
  };

  it.each(getAllLessons().map((lesson) => [lesson.lesson_number]))("lesson %i", async (n) => {
    const { getTaskLesson } = await import("@/lib/lessons-store");
    const fromStorage = (await getTaskLesson("c", "t", n))!;
    const fromFile = getAllLessons()[n - 1];
    expect(fromStorage.version).toBe(1);
    expect(JSON.stringify(fromStorage.lesson)).toBe(JSON.stringify(fromFile));
    const expected = results(fromFile);
    expect(runInLessonScope([fromStorage.lesson], () => results(fromStorage.lesson))).toBe(expected);
  });
});
