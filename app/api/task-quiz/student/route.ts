import { quizActivityFromUrl, quizFailure, quizJson } from "@/lib/task-quiz-api";
import { getStudentTaskQuizItems } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

/**
 * GET ?classId&assignmentId → { items } with this task's published quiz for its
 * students: no answer keys, misconceptions or explanations. `items` is null for a
 * task with no quiz published this way, which keeps reading its lesson.
 */
export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const { classId, assignmentId } = quizActivityFromUrl(request);
    return quizJson({ items: await getStudentTaskQuizItems(classId, assignmentId) });
  } catch (error) { return quizFailure(error); }
}
