import { listTaskLessons } from "@/lib/lessons-store";
import { lessonCard, taskQuizView } from "@/lib/task-quiz";
import { quizActivity, quizActivityFromUrl, quizBody, quizFailure, quizJson, quizRevision, quizTeacher } from "@/lib/task-quiz-api";
import { getLessonCard, getTaskQuizState, pickQuizLesson } from "@/lib/task-quiz-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

/**
 * GET ?classId&assignmentId[&lessonNumber] → the lessons to pick from, and the
 * card for one of them: the chosen one, the task's own, or the first.
 * Picking is a separate step, so looking at a lesson pins nothing.
 */
export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    await quizTeacher(request);
    const raw = new URL(request.url).searchParams.get("lessonNumber");
    const wanted = raw === null ? null : /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : NaN;
    if (Number.isNaN(wanted)) return quizJson({ error: "Lesson not found." }, 404);
    const activity = quizActivityFromUrl(request);
    const rows = await listTaskLessons(activity.classId, activity.assignmentId);
    const lessons = rows.map((row) => ({ lessonNumber: row.lessonNumber, title: row.title, currentVersion: row.version }));
    const { quiz } = await getTaskQuizState(activity);
    const number = wanted ?? quiz.lesson?.number ?? rows[0]?.lessonNumber ?? null;
    const card = number === null ? null : await getLessonCard(number);
    if (wanted !== null && !card) return quizJson({ error: "Lesson not found." }, 404);
    return quizJson({ lessons, lesson: card ? lessonCard(card) : null });
  } catch (error) { return quizFailure(error); }
}

/** POST { classId, assignmentId, lessonNumber, confirmReplace?, revision? } picks the lesson (UC 4.1). */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const user = await quizTeacher(request);
    const body = await quizBody(request);
    const { lessonNumber } = body;
    if (typeof lessonNumber !== "number" || !Number.isInteger(lessonNumber) || lessonNumber < 1 || lessonNumber > 999_999) return quizJson({ error: "Choose a lesson." }, 400);
    const quiz = await pickQuizLesson(user, quizActivity(body), lessonNumber, body.confirmReplace === true, quizRevision(body));
    return quizJson({ quiz: taskQuizView(quiz) });
  } catch (error) { return quizFailure(error); }
}
