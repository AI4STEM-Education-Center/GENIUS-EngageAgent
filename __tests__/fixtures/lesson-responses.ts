import { getAllLessons } from "@/lib/quiz-data";
import { emptyTaskQuiz, taskQuizView } from "@/lib/task-quiz";

const lessonFile = (number: number) => getAllLessons().find((lesson) => lesson.lesson_number === number);

/** A task published the old way: pages that aren't about Step 1's quiz are tested through the older Step 1 and its lesson buttons. */
export const olderTaskQuizState = { quiz: taskQuizView(emptyTaskQuiz("class", "task")), legacyStatus: "published" };

/** What the lesson routes answer for a task reading the built-in lessons, or null for any other address. */
export function lessonResponse(url: string, title: (lessonNumber: number) => string = (n) => `Lesson ${n}`, changes: Record<string, unknown> = {}) {
  if (url.startsWith("/api/task-quiz")) return olderTaskQuizState;
  if (url.startsWith("/api/lessons?")) return { lessons: getAllLessons().map((lesson) => ({ lessonNumber: lesson.lesson_number, title: title(lesson.lesson_number), questionCount: 0 })) };
  const number = /^\/api\/lessons\/(\d+)(?:\?|$)/u.exec(url)?.[1];
  return number ? { ...lessonFile(Number(number)), lesson_title: title(Number(number)), ...changes } : null;
}
