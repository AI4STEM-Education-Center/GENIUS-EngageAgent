import { describe, it, expect } from "vitest";
import {
  buildPerformanceReport,
  confidenceLevel,
  EMPTY_FILTERS,
  filterRows,
  hasActiveFilters,
} from "@/lib/quiz-performance";
import type { StudentAnswer } from "@/lib/types";

// Lesson 1 key: Q1=C (D→a), Q2=A (D→a), Q3=A (D→b), Q4=D (A→b).
const submit = (id: string, name: string, answers: Record<string, string>, lesson = 1): StudentAnswer => ({
  student_id: id,
  student_name: name,
  class_id: "c",
  assignment_id: "a",
  lesson_number: lesson,
  answers,
  submitted_at: "2026-10-14T15:00:00.000Z",
});

const allRight = {
  L1_Q1: "C", L1_Q1_confidence: "A",
  L1_Q2: "A", L1_Q2_confidence: "A",
  L1_Q3: "A", L1_Q3_confidence: "B",
  L1_Q4: "D", L1_Q4_confidence: "B",
};
const someWrong = {
  L1_Q1: "D", L1_Q1_confidence: "D", // wrong, mapped to misconception a
  L1_Q2: "A", L1_Q2_confidence: "C",
  L1_Q3: "C", L1_Q3_confidence: "C", // wrong, not in map -> falls back to b
  // L1_Q4 left blank
};

describe("confidenceLevel", () => {
  it("maps A–D to 4–1", () => {
    expect(["A", "B", "C", "D"].map(confidenceLevel)).toEqual([4, 3, 2, 1]);
    expect(confidenceLevel(null)).toBeNull();
    expect(confidenceLevel("Z")).toBeNull();
  });
});

describe("buildPerformanceReport", () => {
  it("returns null without a lesson", () => {
    expect(buildPerformanceReport(null, [])).toBeNull();
    expect(buildPerformanceReport(99, [])).toBeNull();
  });

  it("shows questions as Not available when nobody has submitted (A1)", () => {
    const report = buildPerformanceReport(1, [])!;
    expect(report.submitted).toBe(0);
    expect(report.questionCount).toBe(4);
    expect(report.questions.every((q) => q.correctPercent === null && q.averageConfidence === null)).toBe(true);
  });

  it("only counts answers for the current lesson", () => {
    const report = buildPerformanceReport(1, [
      submit("s1", "Alex", allRight),
      submit("s9", "Other lesson", { L2_Q1: "A" }, 2),
    ])!;
    expect(report.submitted).toBe(1);
    expect(new Set(report.rows.map((r) => r.studentId))).toEqual(new Set(["s1"]));
  });

  it("summarises each question", () => {
    const report = buildPerformanceReport(1, [submit("s1", "Alex", allRight), submit("s2", "Maya", someWrong)])!;
    const [q1, q2, , q4] = report.questions;

    expect(q1).toMatchObject({ responses: 2, noResponse: 0, correct: 1, correctPercent: 50, averageConfidence: 2.5 });
    expect(q1.optionCounts).toEqual({ A: 0, B: 0, C: 1, D: 1 });
    expect(q2).toMatchObject({ correct: 2, correctPercent: 100, averageConfidence: 3 });
    // Maya left Q4 blank: one response, one no-response.
    expect(q4).toMatchObject({ responses: 1, noResponse: 1, correctPercent: 100 });
  });

  it("gives every student row its answer, correctness, confidence and diagnostic type", () => {
    const report = buildPerformanceReport(1, [submit("s2", "Maya", someWrong)])!;
    const byQ = Object.fromEntries(report.rows.map((r) => [r.itemId, r]));

    expect(byQ.L1_Q1).toMatchObject({
      selectedOption: "D",
      isCorrect: false,
      confidenceLevel: 1,
      confidenceText: "Just guessing",
      diagnosticKey: "a",
    });
    expect(byQ.L1_Q1.diagnosticLabel).toMatch(/^a: /);
    expect(byQ.L1_Q2).toMatchObject({ isCorrect: true, diagnosticKey: "correct", diagnosticLabel: "Correct" });
    // Wrong answer outside the map falls back to the question's matched misconception,
    // the same way the strategy recommendations read it.
    expect(byQ.L1_Q3).toMatchObject({ isCorrect: false, diagnosticKey: "b" });
    expect(byQ.L1_Q4).toMatchObject({ selectedOption: null, isCorrect: null, diagnosticKey: "no-answer" });
  });

  it("lists the lesson's diagnostic categories for the filter", () => {
    const keys = buildPerformanceReport(1, [])!.diagnosticOptions.map((o) => o.key);
    expect(keys).toEqual(["correct", "a", "b", "uncategorized", "no-answer"]);
  });
});

describe("filterRows", () => {
  const report = buildPerformanceReport(1, [submit("s1", "Alex Johnson", allRight), submit("s2", "Maya Patel", someWrong)])!;
  const run = (f: Partial<typeof EMPTY_FILTERS>) => filterRows(report.rows, { ...EMPTY_FILTERS, ...f });

  it("returns everything with no filters (Full Report)", () => {
    expect(run({})).toHaveLength(8);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("filters to one question (View Details)", () => {
    const rows = run({ question: "L1_Q1" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.itemId === "L1_Q1")).toBe(true);
  });

  it("filters by student name, option, confidence, diagnostic type and correctness", () => {
    expect(run({ student: "maya" }).every((r) => r.studentId === "s2")).toBe(true);
    expect(run({ question: "L1_Q1", option: "D" }).map((r) => r.studentName)).toEqual(["Maya Patel"]);
    expect(run({ confidence: "4" }).map((r) => r.itemId)).toEqual(["L1_Q1", "L1_Q2"]);
    expect(run({ diagnostic: "a" }).map((r) => r.itemId)).toEqual(["L1_Q1"]);
    expect(run({ correct: "false" })).toHaveLength(2);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, correct: "false" })).toBe(true);
  });
});
