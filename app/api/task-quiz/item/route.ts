import { parseItemChange, taskQuizView } from "@/lib/task-quiz";
import { quizActivity, quizBody, quizFailure, quizJson, quizRevision, quizTeacher } from "@/lib/task-quiz-api";
import { changeQuizItem } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

/**
 * POST { classId, assignmentId, itemId, action, ..., revision? }. Actions:
 * - setAnswer { letter }: "Set as answer", or another option's dashed letter
 * - setOptions { options: string[], answer? }: fix an item that doesn't have exactly A to D
 * - editText { stem?, explanation? }
 * - setMatch { letter, ids } or { letter, noMisconception: true }: "Change", "+ Add / change" and "×". Empty ids is "Not matched yet".
 * - addPossibleNew { letter, id }: "Add to lesson list and use"
 * - dismissPossibleNew { letter, id }: "Dismiss"
 * - confirm: "Confirm item"
 */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const user = await quizTeacher(request);
    const body = await quizBody(request);
    if (typeof body.itemId !== "string" || !body.itemId) return quizJson({ error: "Choose an item." }, 400);
    const change = parseItemChange(body);
    if ("error" in change) return quizJson({ error: change.error }, 400);
    const quiz = await changeQuizItem(user, quizActivity(body), body.itemId, change, quizRevision(body));
    return quizJson({ quiz: taskQuizView(quiz) });
  } catch (error) { return quizFailure(error); }
}
