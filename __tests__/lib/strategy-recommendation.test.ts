import { describe, expect, it } from "vitest";

import { engagementStrategies } from "@/lib/engagement-strategies";
import { getAllLessons, getLesson } from "@/lib/quiz-data";
import {
  buildLearnerSummary,
  buildPromptVariables,
  countClassResponses,
  formatPercent,
  getLessonAnalogyLabel,
  getMultipleChoiceItems,
  recommendStrategy,
  resolveOptionMisconception,
  type RecommendedStrategy,
} from "@/lib/strategy-recommendation";
import type { Lesson } from "@/lib/types";

/** `count` copies of one answer ("" is a blank). */
const repeat = (answer: string, count: number) => Array.from({ length: count }, () => answer);

/** One answer list per question number; student i gives answers[q][i]. */
function makeSubmissions(lessonNumber: number, answersByQuestion: Record<number, string[]>) {
  const lists = Object.entries(answersByQuestion);
  const students = lists[0][1].length;
  if (lists.some(([, answers]) => answers.length !== students)) {
    throw new Error("Every question needs one answer per student.");
  }
  return Array.from({ length: students }, (_, student) => {
    const submission: Record<string, string> = {};
    for (const [question, answers] of lists) {
      submission[`L${lessonNumber}_Q${question}`] = answers[student];
    }
    return submission;
  });
}

function requireLesson(lessonNumber: number): Lesson {
  const lesson = getLesson(lessonNumber);
  if (!lesson) {
    throw new Error(`Lesson ${lessonNumber} is missing from the lesson data.`);
  }
  return lesson;
}

function countOf(lessonNumber: number, submissions: Record<string, string>[], id: string) {
  const counts = countClassResponses(requireLesson(lessonNumber), submissions);
  return counts.misconceptions.find((misconception) => misconception.id === id)?.count;
}

// The five worked examples of the rule, each a class of 20 students (R = 80).

// Case 1 — L2, 60 of 80 correct.
const case1 = makeSubmissions(2, {
  1: [...repeat("C", 15), ...repeat("B", 5)],
  2: [...repeat("D", 15), ...repeat("A", 5)],
  3: [...repeat("B", 15), ...repeat("C", 5)],
  4: [...repeat("D", 15), ...repeat("C", 5)],
});

// Case 2 — L2, exactly 70%: 3-b 8, 2-a 5, 1-a 4, 3-a 4, 1-b 1, unlinked 2.
const case2 = makeSubmissions(2, {
  1: [...repeat("C", 15), ...repeat("B", 4), ...repeat("D", 1)],
  2: [...repeat("D", 16), ...repeat("A", 4)],
  3: [...repeat("B", 15), ...repeat("C", 5)],
  4: [...repeat("D", 10), ...repeat("C", 8), ...repeat("A", 2)],
});

// Case 3 — L4: 2-a 7, 4-a 7, 1-b 6, 3-b 4, 1-a 3, unlinked 3 (two of them blank).
const case3 = makeSubmissions(4, {
  1: [...repeat("D", 12), ...repeat("A", 3), ...repeat("C", 4), ...repeat("B", 1)],
  2: [...repeat("C", 13), ...repeat("D", 4), ...repeat("B", 3)],
  3: [...repeat("C", 13), ...repeat("A", 3), ...repeat("B", 2), ...repeat("", 2)],
  4: [...repeat("A", 12), ...repeat("B", 6), ...repeat("C", 2)],
});

// Case 4 — L1: a 12, b 12, unlinked 8 (a tie above 25%).
const case4 = makeSubmissions(1, {
  1: [...repeat("C", 12), ...repeat("D", 6), ...repeat("A", 2)],
  2: [...repeat("A", 12), ...repeat("D", 6), ...repeat("B", 2)],
  3: [...repeat("A", 12), ...repeat("D", 6), ...repeat("B", 2)],
  4: [...repeat("D", 12), ...repeat("A", 6), ...repeat("B", 2)],
});

// Case 5 — L7, exactly 25%: b 10, a 9, c 8, d 5, unlinked 8.
const case5 = makeSubmissions(7, {
  1: [...repeat("C", 10), ...repeat("B", 6), ...repeat("D", 4)],
  2: [...repeat("B", 10), ...repeat("A", 5), ...repeat("D", 4), ...repeat("C", 1)],
  3: [...repeat("D", 10), ...repeat("A", 4), ...repeat("C", 4), ...repeat("B", 2)],
  4: [...repeat("B", 10), ...repeat("A", 4), ...repeat("D", 5), ...repeat("C", 1)],
});

describe("lesson data used by the rule", () => {
  it("gives every lesson four multiple-choice items whose correct answer is an option", () => {
    for (const lesson of getAllLessons()) {
      const items = getMultipleChoiceItems(lesson);
      expect(items).toHaveLength(4);
      for (const item of items) {
        expect(Object.keys(item.options)).toContain(item.correct_answer);
      }
    }
  });

  it("links each labeled option to exactly one listed misconception and never labels a correct option", () => {
    for (const lesson of getAllLessons()) {
      for (const item of getMultipleChoiceItems(lesson)) {
        for (const option of Object.keys(item.distractor_misconception_map ?? {})) {
          expect(option).not.toBe(item.correct_answer);
          expect(Object.keys(item.options)).toContain(option);
          expect(() => resolveOptionMisconception(lesson, item, option)).not.toThrow();
        }
      }
    }
  });

  it("uses strategy ids the app already knows", () => {
    const strategies: RecommendedStrategy[] = [
      "engaged critiquing",
      "cognitive conflict",
      "analogy",
      "experience bridging",
    ];
    const knownIds = engagementStrategies.map((strategy) => strategy.id);
    for (const strategy of strategies) {
      expect(knownIds).toContain(strategy);
    }
  });
});

describe("getLessonAnalogyLabel", () => {
  it("recommends analogy for L2, L3, L5, L6 and L7 only", () => {
    const labels = [1, 2, 3, 4, 5, 6, 7, 8].map((lessonNumber) => getLessonAnalogyLabel(lessonNumber));
    expect(labels).toEqual([
      "not recommend",
      "recommend",
      "recommend",
      "not recommend",
      "recommend",
      "recommend",
      "recommend",
      "not recommend",
    ]);
  });

  it("throws for a lesson without a label", () => {
    expect(() => getLessonAnalogyLabel(9)).toThrow("No analogy label");
  });
});

describe("countClassResponses", () => {
  it("counts blanks and anything that is not one option letter as incorrect and unlinked", () => {
    const counts = countClassResponses(requireLesson(1), [
      { L1_Q1: "C", L1_Q2: "", L1_Q3: "E", L1_Q4: "a" },
      { L1_Q1: "AB", L1_Q3: "toString", L1_Q4: "D" },
    ]);
    expect(counts.responses).toBe(8);
    expect(counts.correct).toBe(2);
    expect(counts.incorrect).toBe(6);
    expect(counts.unlinked).toBe(6);
  });

  it("counts Lesson 5's two-label option once, toward the merged 1-a", () => {
    const submissions = makeSubmissions(5, {
      1: repeat("B", 5),
      2: repeat("C", 5),
      3: repeat("D", 5),
      4: repeat("A", 5),
    });
    const counts = countClassResponses(requireLesson(5), submissions);
    expect(countOf(5, submissions, "1-a")).toBe(5);
    expect(counts.misconceptions.map((misconception) => misconception.id)).not.toContain("2-a");
    expect(counts.unlinked).toBe(0);
  });

  it("refuses to run without a submitted quiz", () => {
    expect(() => countClassResponses(requireLesson(1), [])).toThrow("at least one submitted quiz");
  });
});

describe("recommendStrategy — worked examples", () => {
  it("case 1: accuracy above 70% gives engaged critiquing", () => {
    const result = recommendStrategy(2, case1);
    expect(result.counts.correct).toBe(60);
    expect(result.strategy).toBe("engaged critiquing");
    expect(result.decidedAtStep).toBe(1);
  });

  it("case 2: exactly 70% goes to step 2, and 3-b above 25% gives cognitive conflict", () => {
    const result = recommendStrategy(2, case2);
    expect(result.counts.correct).toBe(56);
    expect(result.counts.incorrect).toBe(24);
    expect(result.counts.unlinked).toBe(2);
    expect(result.strategy).toBe("cognitive conflict");
    expect(result.decidedAtStep).toBe(2);
    expect(result.target?.id).toBe("3-b");
    expect(result.target?.count).toBe(8);
  });

  it("case 3: no misconception above 25% and L4 not recommend give experience bridging", () => {
    const result = recommendStrategy(4, case3);
    expect(result.counts.correct).toBe(50);
    expect(result.counts.incorrect).toBe(30);
    expect(result.counts.unlinked).toBe(3);
    expect(countOf(4, case3, "2-a")).toBe(7);
    expect(countOf(4, case3, "4-a")).toBe(7);
    expect(result.strategy).toBe("experience bridging");
    expect(result.decidedAtStep).toBe(3);
  });

  it("case 4: a tie above 25% gives cognitive conflict and leaves the target to the teacher", () => {
    const result = recommendStrategy(1, case4);
    expect(result.counts.incorrect).toBe(32);
    expect(result.strategy).toBe("cognitive conflict");
    expect(result.targetCandidates.map((misconception) => misconception.id)).toEqual(["a", "b"]);
    expect(result.target).toBe(null);
  });

  it("case 5: exactly 25% is not dominant, and L7 recommend gives analogy", () => {
    const result = recommendStrategy(7, case5);
    expect(result.counts.incorrect).toBe(40);
    expect(countOf(7, case5, "b")).toBe(10);
    expect(result.strategy).toBe("analogy");
    expect(result.decidedAtStep).toBe(3);
  });

  it("gives engaged critiquing when every answer is correct", () => {
    const result = recommendStrategy(
      3,
      makeSubmissions(3, { 1: repeat("D", 3), 2: repeat("A", 3), 3: repeat("D", 3), 4: repeat("C", 3) }),
    );
    expect(result.counts.incorrect).toBe(0);
    expect(result.strategy).toBe("engaged critiquing");
  });

  it("throws for an unknown lesson", () => {
    expect(() => recommendStrategy(9, case1)).toThrow("Unknown lesson 9");
  });
});

describe("formatPercent", () => {
  it("shows one decimal place, rounded half up", () => {
    expect(formatPercent(1, 8)).toBe("12.5%");
    expect(formatPercent(1, 16)).toBe("6.3%");
    expect(formatPercent(2, 3)).toBe("66.7%");
    expect(formatPercent(56, 80)).toBe("70.0%");
    expect(formatPercent(0, 5)).toBe("0.0%");
  });
});

describe("buildLearnerSummary", () => {
  it("lists misconceptions largest first, ties in list order, then the unlinked line", () => {
    const statements = requireLesson(2).misconceptions;
    expect(buildLearnerSummary(recommendStrategy(2, case2))).toBe(
      [
        "Lesson: L2 · Students: 20 · Responses: 80",
        "Class accuracy: 70.0% (56 of 80 correct; blanks count as incorrect)",
        "Incorrect responses: 24",
        `  3-b) ${statements["3-b"]}: 8 of 24 (33.3%)`,
        `  2-a) ${statements["2-a"]}: 5 of 24 (20.8%)`,
        `  1-a) ${statements["1-a"]}: 4 of 24 (16.7%)`,
        `  3-a) ${statements["3-a"]}: 4 of 24 (16.7%)`,
        `  1-b) ${statements["1-b"]}: 1 of 24 (4.2%)`,
        "  Not linked to a listed misconception: 2 of 24 (8.3%)",
        "Recommended strategy: Cognitive Conflict",
        `Target misconception: 3-b) ${statements["3-b"]}`,
      ].join("\n"),
    );
  });

  it("shows no error lines when there are no incorrect responses", () => {
    const summary = buildLearnerSummary(
      recommendStrategy(
        3,
        makeSubmissions(3, { 1: repeat("D", 2), 2: repeat("A", 2), 3: repeat("D", 2), 4: repeat("C", 2) }),
      ),
    );
    expect(summary).toContain("Incorrect responses: 0");
    expect(summary).not.toContain("\n  ");
  });

  it("lists every tied misconception until the teacher chooses", () => {
    const result = recommendStrategy(1, case4);
    const statements = requireLesson(1).misconceptions;
    expect(buildLearnerSummary(result)).toContain(
      `Target misconception (teacher chooses one): a) ${statements.a}; b) ${statements.b}`,
    );
    expect(buildLearnerSummary(result, "b")).toContain(`Target misconception: b) ${statements.b}`);
    expect(() => buildLearnerSummary(result, "c")).toThrow("not a target candidate");
  });
});

describe("buildPromptVariables", () => {
  it("fills cognitive conflict with the target's statement", () => {
    const variables = buildPromptVariables(recommendStrategy(2, case2));
    expect(variables.SELECTED_STRATEGY).toBe("Cognitive Conflict");
    expect(variables.MISCONCEPTION_OR_GAP).toBe(requireLesson(2).misconceptions["3-b"]);
    expect(variables.CURRENT_UNDERSTANDING).toContain("Class accuracy: 70.0%");
  });

  it("waits for the teacher's choice when misconceptions are tied", () => {
    const result = recommendStrategy(1, case4);
    expect(() => buildPromptVariables(result)).toThrow("teacher must choose");
    expect(buildPromptVariables(result, "a").MISCONCEPTION_OR_GAP).toBe(requireLesson(1).misconceptions.a);
  });

  it("fills analogy and experience bridging with the error lines", () => {
    const analogy = buildPromptVariables(recommendStrategy(7, case5));
    expect(analogy.MISCONCEPTION_OR_GAP).toContain(
      "No misconception accounts for more than 25% of incorrect responses.\nIncorrect responses: 40",
    );
    const bridging = buildPromptVariables(recommendStrategy(4, case3));
    expect(bridging.KNOWLEDGE_GAP).toContain(
      "No misconception accounts for more than 25% of incorrect responses.\nIncorrect responses: 30",
    );
  });

  it("fills engaged critiquing with the error lines and the labeled quiz items", () => {
    const variables = buildPromptVariables(recommendStrategy(2, case1));
    expect(variables.MISCONCEPTION_OR_GAP).toContain("Accuracy is above 70%.\nIncorrect responses: 20");
    expect(variables.QUIZ_ITEMS).toContain("Q1. ");
    expect(variables.QUIZ_ITEMS).toContain("(correct)");
    expect(variables.QUIZ_ITEMS).toContain(`[misconception 1-a: ${requireLesson(2).misconceptions["1-a"]}]`);
  });
});
