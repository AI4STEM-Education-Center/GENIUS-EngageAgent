import { taskQuizView } from "@/lib/task-quiz";
import { quizActivity, quizBody, quizFailure, quizJson, quizTeacher } from "@/lib/task-quiz-api";
import { switchToProvidedQuiz } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

/**
 * POST { classId, assignmentId, source: "provided", confirmReplace? } switches
 * back to the lesson's quiz. The other two sources switch when their items
 * arrive, through /upload, /link and /create.
 */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const user = await quizTeacher(request);
    const body = await quizBody(request);
    if (body.source !== "provided") return quizJson({ error: "Use upload, link or create for that source." }, 400);
    const quiz = await switchToProvidedQuiz(user, quizActivity(body), body.confirmReplace === true);
    return quizJson({ quiz: taskQuizView(quiz) });
  } catch (error) { return quizFailure(error); }
}
