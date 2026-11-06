import { publishedMessage, taskQuizView } from "@/lib/task-quiz";
import { quizActivity, quizBody, quizFailure, quizJson, quizRevision, quizTeacher } from "@/lib/task-quiz-api";
import { publishedBar, publishTaskQuiz } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

/** POST { classId, assignmentId, revision? } is "Publish task" (UC 4.5). A second publish changes nothing and says so. */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const user = await quizTeacher(request);
    const body = await quizBody(request);
    const activity = quizActivity(body);
    const { quiz, alreadyPublished } = await publishTaskQuiz(user, activity, quizRevision(body));
    const bar = await publishedBar(activity, quiz);
    return quizJson({ message: publishedMessage(bar.classSize), alreadyPublished, publishedBar: bar, quiz: taskQuizView(quiz) }, alreadyPublished ? 200 : 201);
  } catch (error) { return quizFailure(error); }
}
