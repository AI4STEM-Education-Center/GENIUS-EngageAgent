import { quizActivityFromUrl, quizFailure, quizJson, quizTeacher } from "@/lib/task-quiz-api";
import { quizFileUrl } from "@/lib/task-quiz-file";
import { getTaskQuizSourceFile } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

/** GET ?classId&assignmentId → a short-lived download link for the file the items came from. */
export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    await quizTeacher(request);
    const file = await getTaskQuizSourceFile(quizActivityFromUrl(request));
    if (!file) return quizJson({ error: "This quiz didn't come from a file." }, 404);
    return quizJson({ url: await quizFileUrl(file), fileName: file.fileName });
  } catch (error) { return quizFailure(error); }
}
