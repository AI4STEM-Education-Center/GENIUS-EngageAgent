/**
 * Where getLesson looks before the lesson files (#175). Stored lessons are the
 * source of truth, but getLesson stays synchronous because the browser uses it
 * too, so a lesson must be loaded before anything asks for it:
 * - On the server, lib/lesson-scope.ts holds the lessons for this one request.
 *   Inside a request only those count, and the files are never consulted.
 * - In the browser, the page registers what it loaded (lib/lesson-client.ts).
 *
 * No lesson data lives here, so it's cheap to import anywhere.
 */
import type { Lesson } from "./types";

type LessonScopeReader = () => ReadonlyMap<number, Lesson> | undefined;
let readLessonScope: LessonScopeReader = () => undefined;

/** Server only. Lets lib/lesson-scope.ts plug in without its node: import reaching a browser bundle. */
export function setLessonScopeReader(reader: LessonScopeReader) {
  readLessonScope = reader;
}

const registeredLessons = new Map<number, Lesson>();

/**
 * Browser only: this page's task reads this lesson. It throws on the server,
 * where a map keyed by lesson number would let two requests read each other's version.
 */
export function registerLesson(lesson: Lesson) {
  if (typeof window === "undefined") throw new Error("registerLesson is for the browser. On the server, use a lesson scope.");
  registeredLessons.set(lesson.lesson_number, lesson);
}

/** The loaded lesson. null means a request is in scope and doesn't have it; undefined means nothing was loaded. */
export function loadedLesson(lessonNumber: number): Lesson | null | undefined {
  const scope = readLessonScope();
  return scope ? scope.get(lessonNumber) ?? null : registeredLessons.get(lessonNumber);
}
