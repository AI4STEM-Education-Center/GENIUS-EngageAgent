import { studentQuizHeading, studentQuizItems } from "@/lib/task-quiz";
import { quizActivityFromUrl, quizFailure, quizJson, quizTeacher } from "@/lib/task-quiz-api";
import { getTaskQuizForPreview } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

/** GET ?classId&assignmentId is "Preview as student": no answer keys and no misconceptions. Teachers only. */
export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    await quizTeacher(request);
    const quiz = await getTaskQuizForPreview(quizActivityFromUrl(request));
    return quizJson({ heading: studentQuizHeading(quiz), items: studentQuizItems(quiz) });
  } catch (error) { return quizFailure(error); }
}
