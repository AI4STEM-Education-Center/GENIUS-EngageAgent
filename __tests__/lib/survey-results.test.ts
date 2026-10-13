import { describe, it, expect } from "vitest";
import {
  buildLessonSurveySource,
  buildTeacherSurveySource,
  countAnswered,
  entryToCsv,
} from "@/lib/survey-results";
import type { StudentAnswer, SurveyItem, SurveyResponse } from "@/lib/types";

const questions: SurveyItem[] = [
  { item_id: "q1", question_number: 1, category: "familiarity", stem: "Hobby?",
    response_fields: [{ field_id: "f1", label: "Answer", response_type: "text" }] },
  { item_id: "q2", question_number: 2, category: "experience_details", stem: "Collision?",
    response_fields: [
      { field_id: "f2", label: "Fast thing", response_type: "text" },
      { field_id: "f3", label: "Which changed more?", response_type: "choice", options: ["Lighter", "Heavier"] },
    ] },
];

const answer = (id: string, name: string, answers: Record<string, string>): StudentAnswer => ({
  student_id: id, student_name: name, class_id: "c", assignment_id: "a",
  lesson_number: 1, answers, submitted_at: "2026-09-14T15:42:00.000Z",
});

describe("buildLessonSurveySource", () => {
  it("returns null when the lesson has no survey", () => {
    expect(buildLessonSurveySource({ lesson_number: 1, survey_items: [] }, [])).toBeNull();
  });

  it("includes only students who answered a survey field, sorted by name, without quiz answers", () => {
    const src = buildLessonSurveySource({ lesson_number: 2, survey_items: questions }, [
      answer("s2", "Maya", { L1_Q1: "C", f1: "Gaming" }),
      answer("s1", "Alex", { f1: "Soccer", f2: "Ball", f3: "Lighter" }),
      answer("s3", "Quiz Only", { L1_Q1: "A" }),
    ])!;
    expect(src.subtitle).toBe("Lesson 2");
    expect(src.entries.map((e) => e.name)).toEqual(["Alex", "Maya"]);
    expect(src.entries[1].answers).toEqual({ f1: "Gaming", f2: "", f3: "" });
  });
});

describe("buildTeacherSurveySource", () => {
  const resp = (id: string, status: "draft" | "submitted", late = false): SurveyResponse => ({
    survey_id: "s1", class_id: "c", assignment_id: "a", student_id: id,
    student_name: id.toUpperCase(), answers: { f1: "x" }, status, is_late: late,
    submitted_at: status === "submitted" ? "2026-09-14T00:00:00.000Z" : undefined,
    updated_at: "2026-09-14T00:00:00.000Z",
  });

  it("shows submitted responses and counts drafts as in progress", () => {
    const src = buildTeacherSurveySource(
      { survey_id: "s1", title: "Check", daily_experience_topic: "Collisions", questions },
      [resp("b", "submitted", true), resp("a", "submitted"), resp("c", "draft"),
       { ...resp("d", "submitted"), survey_id: "other" }],
    );
    expect(src.entries.map((e) => e.studentId)).toEqual(["a", "b"]);
    expect(src.entries[1].late).toBe(true);
    expect(src.inProgress).toBe(1);
  });
});

describe("countAnswered", () => {
  it("counts a question as answered when any field has a value", () => {
    expect(countAnswered(questions, { f1: "x", f3: "Lighter" })).toEqual({ answered: 2, total: 2 });
    expect(countAnswered(questions, { f1: " " })).toEqual({ answered: 0, total: 2 });
  });
});

describe("entryToCsv", () => {
  it("writes one row per field and escapes quotes", () => {
    const src = buildLessonSurveySource({ lesson_number: 1, survey_items: questions }, [
      answer("s1", "Alex", { f1: 'He said "hi"', f2: "Ball", f3: "Lighter" }),
    ])!;
    const csv = entryToCsv(src, src.entries[0]).split("\n");
    expect(csv).toHaveLength(4);
    expect(csv[1]).toBe('"Alex","1. Hobby?","Answer","He said ""hi"""');
  });
});
