/**
 * Where a task's quiz rows live, and how to read its published copy (#177). It's
 * apart from lib/task-quiz-store.ts because lib/lessons-store.ts needs the published
 * copy and task-quiz-store needs lessons-store, so neither can import the other.
 */
import type { TaskQuiz } from "./task-quiz";
import { workspaceGet } from "./workspace-store";

export type QuizActivity = { classId: string; assignmentId: string };

export const quizPartition = ({ classId, assignmentId }: QuizActivity) =>
  `WORKSPACE_TASK_QUIZ#${encodeURIComponent(classId)}#${encodeURIComponent(assignmentId)}`;
export const PUBLISHED_KEY = "PUBLISHED";

/** The published copy, or null when this task has no quiz published this way. It can't change after publishing. */
export async function getPublishedTaskQuiz(classId: string, assignmentId: string): Promise<TaskQuiz | null> {
  return workspaceGet<TaskQuiz>(quizPartition({ classId, assignmentId }), PUBLISHED_KEY);
}
