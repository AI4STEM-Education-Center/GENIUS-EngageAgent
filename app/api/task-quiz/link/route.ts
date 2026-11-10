import { linkImportMessage, taskQuizView } from "@/lib/task-quiz";
import { extractQuizItems, quizAiClient, QuizAiError } from "@/lib/task-quiz-ai";
import { quizActivity, quizBody, quizFailure, quizJson, quizTeacher } from "@/lib/task-quiz-api";
import { noQuestionsMessage, parseQuizLink, QuizLinkError, readQuizLink } from "@/lib/task-quiz-link";
import { prepareQuizReplace, replaceQuizItems } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";
export const maxDuration = 60;

const READ_FAILED = "Couldn't read this link — try again";

/** POST { classId, assignmentId, url, confirmReplace? } imports a link's questions (UC 4.2 flows A, B, C). */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const user = await quizTeacher(request);
    const body = await quizBody(request);
    const activity = quizActivity(body);
    const confirmReplace = body.confirmReplace === true;
    const url = parseQuizLink(body.url);
    await prepareQuizReplace(activity, "uploaded", confirmReplace);
    const { info, text } = await readQuizLink(url);
    const client = quizAiClient();
    if (!client) return quizJson({ error: READ_FAILED }, 503);
    let items;
    try {
      items = await extractQuizItems(client, { type: "text", text });
    } catch (error) {
      if (error instanceof QuizAiError) {
        console.error("Quiz link read failed");
        return quizJson({ error: READ_FAILED }, 502);
      }
      throw error;
    }
    if (!items.length) return quizJson({ error: noQuestionsMessage(info) }, 422);
    const quiz = await replaceQuizItems(user, activity, {
      source: "uploaded", items, confirmReplace,
      sourceDetail: { kind: "link", url: url.href, site: info.site, at: new Date().toISOString() },
    });
    return quizJson({ message: linkImportMessage(items, info.site), quiz: taskQuizView(quiz) });
  } catch (error) {
    if (error instanceof QuizLinkError) return quizJson({ error: error.message }, error.status);
    return quizFailure(error);
  }
}
