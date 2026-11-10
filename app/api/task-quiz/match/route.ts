import { taskQuizView } from "@/lib/task-quiz";
import { matchQuizItems, quizAiClient, QuizAiError } from "@/lib/task-quiz-ai";
import { quizActivity, quizBody, quizFailure, quizJson, quizTeacher } from "@/lib/task-quiz-api";
import { prepareQuizMatch, saveMatchResults } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";
export const maxDuration = 60;

const FAILED = "Couldn't match — try again";

/** POST { classId, assignmentId } is "Match all items" (UC 4.4). Only "Not matched yet" options are filled in. */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const user = await quizTeacher(request);
    const body = await quizBody(request);
    const activity = quizActivity(body);
    const before = await prepareQuizMatch(activity);
    const client = quizAiClient();
    if (!client) return quizJson({ error: FAILED }, 503);
    let results;
    try {
      results = await matchQuizItems(client, before);
    } catch (error) {
      if (error instanceof QuizAiError) {
        console.error("Quiz matching failed");
        return quizJson({ error: FAILED }, 502);
      }
      throw error;
    }
    const quiz = results.length ? await saveMatchResults(user, activity, results) : before;
    return quizJson({ message: "Suggestions ready — review each item", quiz: taskQuizView(quiz) });
  } catch (error) { return quizFailure(error); }
}
