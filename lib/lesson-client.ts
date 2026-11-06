/**
 * Loading lessons in the browser (#175). getLesson is synchronous, so a page
 * loads the lesson its task reads and registers it before anything computes with it.
 */
import { useEffect, useState } from "react";
import { scopedTaskFetch } from "./client-auth";
import { registerLesson } from "./lesson-registry";
import { getAllLessons } from "./quiz-data";
import type { Lesson } from "./types";

type Task = { classId?: string; assignmentId?: string };

export const taskLessonQuery = ({ classId, assignmentId }: Task) =>
  classId && assignmentId ? `classId=${encodeURIComponent(classId)}&assignmentId=${encodeURIComponent(assignmentId)}` : "";

/** The version this task reads, or the current one when there's no task. Fails rather than falling back to another version. */
export async function loadTaskLesson(task: Task, lessonNumber: number): Promise<Lesson> {
  const query = taskLessonQuery(task);
  const response = await scopedTaskFetch(task, `/api/lessons/${lessonNumber}${query ? `?${query}` : ""}`, { cache: "no-store" });
  const lesson = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(lesson?.quiz_items)) throw new Error(lesson?.error ?? `Lesson ${lessonNumber} could not be loaded.`);
  registerLesson(lesson);
  return lesson;
}

/**
 * A lesson this component needs. It's null until it has loaded and registered,
 * including right after the task or lesson number changes.
 */
export function useTaskLesson(task: Task, lessonNumber: number | null) {
  const { classId, assignmentId } = task;
  const key = lessonNumber === null ? null : JSON.stringify([classId, assignmentId, lessonNumber]);
  const [result, setResult] = useState<{ key: string | null; lesson?: Lesson; error?: string }>({ key: null });
  useEffect(() => {
    if (lessonNumber === null) return;
    let stale = false;
    loadTaskLesson({ classId, assignmentId }, lessonNumber).then(
      (lesson) => { if (!stale) setResult({ key, lesson }); },
      (reason: unknown) => { if (!stale) setResult({ key, error: reason instanceof Error ? reason.message : `Lesson ${lessonNumber} could not be loaded.` }); },
    );
    return () => { stale = true; };
  }, [key, classId, assignmentId, lessonNumber]);
  const current = result.key === key ? result : null;
  return { lesson: current?.lesson ?? null, error: current?.error ?? "" };
}

export type LessonOption = { lessonNumber: number; title: string; questionCount: number };

const asOption = (lesson: Lesson): LessonOption => ({
  lessonNumber: lesson.lesson_number, title: lesson.lesson_title,
  questionCount: lesson.quiz_items.filter((item) => item.type === "multiple_choice").length,
});

/** The Step 1 picker: every lesson published so far, at the version this task would read. */
export async function listLessonOptions(task: Task): Promise<LessonOption[]> {
  const query = taskLessonQuery(task);
  if (query) {
    const response = await scopedTaskFetch(task, `/api/lessons?${query}`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? "The lessons could not be loaded.");
    return data?.lessons ?? [];
  }
  // No task to check against, and no quiz can be published from here, so this is only for looking.
  // A teacher signed in here sees every published lesson; otherwise the lessons that have always been open.
  const listed = await fetch("/api/lessons", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).catch(() => null);
  const numbers: number[] = listed?.lessons
    ? listed.lessons.filter((row: { currentVersion: number | null }) => row.currentVersion !== null).map((row: { lessonNumber: number }) => row.lessonNumber)
    : getAllLessons().map((lesson) => lesson.lesson_number);
  return (await Promise.all(numbers.map((lessonNumber) => loadTaskLesson(task, lessonNumber)))).map(asOption);
}
