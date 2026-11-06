import { quizActivityFromUrl, quizFailure, quizJson, quizTeacher } from "@/lib/task-quiz-api";
import { getTaskQuizState } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

/** GET ?classId&assignmentId → the task's quiz, for the teacher's Step 1 screen (#177). */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    await quizTeacher(request);
    return quizJson(await getTaskQuizState(quizActivityFromUrl(request)));
  } catch (error) { return quizFailure(error); }
}
