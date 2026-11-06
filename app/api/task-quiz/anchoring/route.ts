import { taskQuizView } from "@/lib/task-quiz";
import { quizActivity, quizBody, quizFailure, quizJson, quizRevision, quizTeacher } from "@/lib/task-quiz-api";
import { saveAnchoringPhenomenon } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

/** POST { classId, assignmentId, anchoringPhenomenon, revision? } saves the optional text box on the lesson card. */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const user = await quizTeacher(request);
    const body = await quizBody(request);
    if (typeof body.anchoringPhenomenon !== "string") return quizJson({ error: "Anchoring phenomenon must be text." }, 400);
    const quiz = await saveAnchoringPhenomenon(user, quizActivity(body), body.anchoringPhenomenon, quizRevision(body));
    return quizJson({ quiz: taskQuizView(quiz) });
  } catch (error) { return quizFailure(error); }
}
