import { recommendStrategy } from "./strategy-recommendation";
import type { StudentAnswer } from "./types";

type CohortScope = { classId: string; assignmentId: string; lessonNumber: number };

/** The teacher workflow and dashboard use the same submitted cohort.
 * Dynamo records may expose the physical CLASS# key as class_id. */
export function workspaceQuizAnswers(answers: StudentAnswer[], scope: CohortScope): StudentAnswer[] {
  return answers.filter(answer =>
    (answer.class_id === scope.classId || answer.class_id === `CLASS#${scope.classId}`)
    && answer.assignment_id === scope.assignmentId
    && answer.lesson_number === scope.lessonNumber);
}

export function recommendWorkspaceCohort(answers: StudentAnswer[], scope: CohortScope) {
  const cohort = workspaceQuizAnswers(answers, scope);
  return cohort.length ? recommendStrategy(scope.lessonNumber, cohort.map(answer => answer.answers)) : null;
}
