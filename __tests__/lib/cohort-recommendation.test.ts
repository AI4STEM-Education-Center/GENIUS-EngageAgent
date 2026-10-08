import { expect, it } from "vitest";
import { recommendWorkspaceCohort, workspaceQuizAnswers } from "@/lib/cohort-recommendation";
import { recommendStrategy } from "@/lib/strategy-recommendation";
import type { StudentAnswer } from "@/lib/types";

const scope = { classId: "ea-class-a", assignmentId: "ea-task-a", lessonNumber: 8 };
const answer: StudentAnswer = { student_id: "s1", student_name: "Student", class_id: scope.classId,
  assignment_id: scope.assignmentId, lesson_number: 8, submitted_at: "2026-10-07T00:00:00Z",
  answers: { L8_Q1: "C", L8_Q2: "C", L8_Q3: "C", L8_Q4: "B" } };

it("uses the same class rule and excludes answers from another class, task or lesson", () => {
  const inputs = [answer,
    { ...answer, class_id: "ea-class-other" },
    { ...answer, assignment_id: "ea-task-other" },
    { ...answer, lesson_number: 7 },
  ];
  expect(workspaceQuizAnswers(inputs, scope)).toEqual([answer]);
  const result = recommendWorkspaceCohort(inputs, scope);
  expect(result).toEqual(recommendStrategy(8, [answer.answers]));
  expect(result).toMatchObject({ strategy: "cognitive conflict", counts: { students: 1, correct: 2, responses: 4 } });
});

it("supports Dynamo's physical class key and returns no recommendation before current quiz responses arrive", () => {
  expect(recommendWorkspaceCohort([{ ...answer, class_id: `CLASS#${scope.classId}` }], scope)).toEqual(recommendWorkspaceCohort([answer], scope));
  expect(recommendWorkspaceCohort([], scope)).toBeNull();
  expect(recommendWorkspaceCohort([{ ...answer, lesson_number: 7 }], scope)).toBeNull();
});
