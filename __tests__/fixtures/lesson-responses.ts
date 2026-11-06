import { getAllLessons } from "@/lib/quiz-data";

const lessonFile = (number: number) => getAllLessons().find((lesson) => lesson.lesson_number === number);

/** What the lesson routes answer for a task reading the built-in lessons, or null for any other address. */
export function lessonResponse(url: string, title: (lessonNumber: number) => string = (n) => `Lesson ${n}`, changes: Record<string, unknown> = {}) {
  if (url.startsWith("/api/lessons?")) return { lessons: getAllLessons().map((lesson) => ({ lessonNumber: lesson.lesson_number, title: title(lesson.lesson_number), questionCount: 0 })) };
  const number = /^\/api\/lessons\/(\d+)(?:\?|$)/u.exec(url)?.[1];
  return number ? { ...lessonFile(Number(number)), lesson_title: title(Number(number)), ...changes } : null;
}
