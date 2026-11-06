/**
 * The lessons one server request reads (#175). Server only: this module's
 * node: import must never reach a browser bundle, so nothing a page imports may
 * import it. It plugs itself in as getLesson's first stop (lib/lesson-registry.ts).
 *
 * Right after a route's access check:
 *   enterLessonScope(await loadTaskLessons({ classId, assignmentId }, lessonNumber));
 *
 * Everything that route calls then sees those lessons through getLesson, and
 * only those. A lesson that doesn't exist reads as null; if storage can't be
 * read, loadTaskLessons throws so the request fails instead of using a wrong lesson.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getTaskLesson } from "./lessons-store";
import { setLessonScopeReader } from "./lesson-registry";
import type { Lesson } from "./types";

type LessonScope = ReadonlyMap<number, Lesson>;

const storage = new AsyncLocalStorage<LessonScope>();
setLessonScopeReader(() => storage.getStore());

/** Takes unchecked input: anything that isn't a lesson number is left out, for the route's own check to refuse. */
export async function loadTaskLessons(task: { classId: string; assignmentId: string }, ...lessonNumbers: unknown[]): Promise<LessonScope> {
  const wanted = [...new Set(lessonNumbers)].filter((n): n is number => Number.isInteger(n) && (n as number) > 0);
  const found = await Promise.all(wanted.map((n) => getTaskLesson(task.classId, task.assignmentId, n)));
  return new Map(found.flatMap((version) => (version ? [[version.lessonNumber, version.lesson] as const] : [])));
}

/**
 * Applies to the rest of the calling function and everything it calls, and to
 * nothing else, so requests running at the same time can't see each other's lessons.
 * It has to be called in the function that goes on to read the lesson: a helper
 * that awaited the load and then entered would only change its own context.
 */
export function enterLessonScope(lessons: LessonScope) {
  storage.enterWith(lessons);
}

/** The same, for code with a clear start and end. */
export function runInLessonScope<T>(lessons: Iterable<Lesson>, work: () => T): T {
  return storage.run(new Map([...lessons].map((lesson) => [lesson.lesson_number, lesson])), work);
}
