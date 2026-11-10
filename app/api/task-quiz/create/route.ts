import { createdMessage, ITEM_COUNTS, READING_LEVELS, taskQuizView, type ReadingLevel } from "@/lib/task-quiz";
import { createQuizItems, quizAiClient, QuizAiError } from "@/lib/task-quiz-ai";
import { quizActivity, quizBody, quizFailure, quizJson, quizTeacher } from "@/lib/task-quiz-api";
import { prepareQuizReplace, replaceQuizItems } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";
export const maxDuration = 60;

const FAILED = "Couldn't create items — try again";

/**
 * POST { classId, assignmentId, count: 3|4|5, focus: "all" or a core idea's number,
 * readingLevel: "Grade 6"|"Grade 7"|"Grade 8", confirmReplace? } (UC 4.3).
 */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const user = await quizTeacher(request);
    const body = await quizBody(request);
    const { count, focus, readingLevel } = body;
    if (!ITEM_COUNTS.includes(count as (typeof ITEM_COUNTS)[number])) return quizJson({ error: "Number of items must be 3, 4, or 5." }, 400);
    if (!READING_LEVELS.includes(readingLevel as ReadingLevel)) return quizJson({ error: "Reading level must be Grade 6, Grade 7, or Grade 8." }, 400);
    if (focus !== "all" && (typeof focus !== "number" || !Number.isInteger(focus) || focus < 1)) return quizJson({ error: "Focus must be all core ideas or one of them." }, 400);
    const activity = quizActivity(body);
    const confirmReplace = body.confirmReplace === true;
    const before = await prepareQuizReplace(activity, "ai", confirmReplace);
    if (focus !== "all" && (focus as number) > before.lesson!.coreIdeas.length) return quizJson({ error: "Focus must be all core ideas or one of them." }, 400);
    const client = quizAiClient();
    if (!client) return quizJson({ error: FAILED }, 503);
    let items;
    try {
      items = await createQuizItems(client, before, { count: count as number, focus: focus as "all" | number, readingLevel: readingLevel as ReadingLevel });
    } catch (error) {
      if (error instanceof QuizAiError) {
        console.error("Quiz item creation failed");
        return quizJson({ error: FAILED }, 502);
      }
      throw error;
    }
    const quiz = await replaceQuizItems(user, activity, { source: "ai", items, sourceDetail: null, confirmReplace, builtFrom: before.lesson! });
    return quizJson({ message: createdMessage(items), quiz: taskQuizView(quiz) });
  } catch (error) { return quizFailure(error); }
}
