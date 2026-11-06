/**
 * Stored lessons (#175). Each lesson has one row in a shared list, its
 * published versions (read-only), and at most one draft. Publishing writes all
 * of it in one transaction.
 *
 * The 8 lessons from data/*.json are copied in as version 1 the first time
 * lessons are read, so they can be edited like any other.
 */
import { randomUUID } from "node:crypto";
import type { UserContext } from "./auth";
import { compareLessons, draftFromLesson, emptyLessonDraft, lessonFromDraft, lessonProblems, type LessonChanges, type LessonDraftContent, type LessonProblem } from "./lessons";
import { getQuizStatus } from "./nosql";
import { getAllLessons } from "./quiz-data";
import { lessonFromTaskQuiz } from "./task-quiz";
import { getPublishedTaskQuiz } from "./task-quiz-published";
import type { Lesson } from "./types";
import { WorkspaceError } from "./workspace";
import { isWorkspaceConflict, workspaceGet, workspacePut, workspaceQuery } from "./workspace-store";

export type LessonActor = { id: string; name: string };

export type LessonRow = {
  lessonId: string;
  lessonNumber: number;
  /** The current version's title, or the draft's if it was never published. */
  title: string;
  createdBy: LessonActor;
  createdAt: string;
  currentVersion: number | null;
  currentPublishedAt: string | null;
  draftVersion: number | null;
  draftUpdatedAt: string | null;
};

export type LessonVersion = {
  lessonId: string;
  lessonNumber: number;
  version: number;
  status: "published";
  lesson: Lesson;
  publishedBy: LessonActor;
  publishedAt: string;
  changeNote: string;
};

export type LessonDraft = {
  lessonId: string;
  lessonNumber: number;
  version: number;
  content: LessonDraftContent;
  /** Goes up on each save, so a stale save can't overwrite someone's newer one. */
  revision: number;
  updatedBy: LessonActor;
  updatedAt: string;
};

export type LessonTaskPin = {
  classId: string;
  assignmentId: string;
  lessonNumber: number;
  version: number;
  teacher: LessonActor;
  pinnedAt: string;
};

/** Thrown by publish when the draft isn't ready; the API returns the list. */
export class LessonProblemsError extends WorkspaceError {
  constructor(public problems: LessonProblem[]) { super("Fix these problems before publishing.", 422); }
}

const LIST = "WORKSPACE_LESSONS";
const number6 = (value: number) => String(value).padStart(6, "0");
const rowKey = (lessonNumber: number) => `LESSON#${number6(lessonNumber)}`;
const lessonPartition = (lessonId: string) => `WORKSPACE_LESSON#${lessonId}`;
const versionKey = (version: number) => `VERSION#${number6(version)}`;
const taskPinPartition = (classId: string, assignmentId: string) =>
  `WORKSPACE_LESSON_PIN#${encodeURIComponent(classId)}#${encodeURIComponent(assignmentId)}`;
const pinKey = (version: number, classId: string, assignmentId: string) =>
  `PIN#${number6(version)}#${encodeURIComponent(classId)}#${encodeURIComponent(assignmentId)}`;

const actorOf = (user: UserContext): LessonActor => ({ id: user.geniusId, name: user.name });
const SYSTEM: LessonActor = { id: "engageagent", name: "EngageAgent" };
const CONFLICT = "Someone else just changed this lesson. Reload to see the latest.";

function requireTeacher(user: UserContext) {
  if (user.role !== "teacher") throw new WorkspaceError("Teacher access required.", 403);
}

async function copyInBuiltInLesson(lesson: Lesson) {
  const lessonId = `ea-lesson-${lesson.lesson_number}`;
  const at = new Date().toISOString();
  const row: LessonRow = {
    lessonId, lessonNumber: lesson.lesson_number, title: lesson.lesson_title, createdBy: SYSTEM, createdAt: at,
    currentVersion: 1, currentPublishedAt: at, draftVersion: null, draftUpdatedAt: null,
  };
  const version: LessonVersion = {
    lessonId, lessonNumber: lesson.lesson_number, version: 1, status: "published", lesson,
    publishedBy: SYSTEM, publishedAt: at, changeNote: "First version",
  };
  try {
    await workspacePut([
      { partition: LIST, key: rowKey(lesson.lesson_number), value: row, createOnly: true },
      { partition: lessonPartition(lessonId), key: versionKey(1), value: version, createOnly: true },
    ]);
  } catch (error) {
    // Another server copied it first, which is fine.
    if (!isWorkspaceConflict(error)) throw error;
  }
}

let builtInsReady: Promise<void> | null = null;

/** Safe to call from every read and from several servers at once. */
export function ensureBuiltInLessons() {
  builtInsReady ??= (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const have = new Set((await workspaceQuery<LessonRow>(LIST, "LESSON#")).map((row) => row.lessonNumber));
      const missing = getAllLessons().filter((lesson) => !have.has(lesson.lesson_number));
      if (!missing.length) return;
      await Promise.all(missing.map(copyInBuiltInLesson));
    }
    const have = new Set((await workspaceQuery<LessonRow>(LIST, "LESSON#")).map((row) => row.lessonNumber));
    if (getAllLessons().some((lesson) => !have.has(lesson.lesson_number))) throw new Error("Could not set up the built-in lessons.");
  })().catch((error) => {
    builtInsReady = null; // Try again on the next read.
    throw error;
  });
  return builtInsReady;
}

async function requireRow(lessonNumber: number) {
  await ensureBuiltInLessons();
  const row = await workspaceGet<LessonRow>(LIST, rowKey(lessonNumber));
  if (!row) throw new WorkspaceError("Lesson not found.", 404);
  return row;
}

async function pinsOf(row: LessonRow) {
  return workspaceQuery<LessonTaskPin>(lessonPartition(row.lessonId), "PIN#");
}

const countByVersion = (pins: LessonTaskPin[]) => {
  const counts: Record<number, number> = {};
  for (const pin of pins) counts[pin.version] = (counts[pin.version] ?? 0) + 1;
  return counts;
};

export type LessonListRow = LessonRow & { tasksByVersion: Record<number, number> };

/** Every lesson, for the Lessons list. Drafts are only flagged here, never shown. */
export async function listLessons(): Promise<LessonListRow[]> {
  await ensureBuiltInLessons();
  const rows = await workspaceQuery<LessonRow>(LIST, "LESSON#");
  const withCounts = await Promise.all(rows.map(async (row) => ({ ...row, tasksByVersion: countByVersion(await pinsOf(row)) })));
  return withCounts.sort((a, b) => a.lessonNumber - b.lessonNumber);
}

const sortedEntries = <T,>(value: Record<string, T>) =>
  Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));

/**
 * DynamoDB doesn't keep the order of an object's keys, but students see options
 * in key order, and ties between misconceptions go to the first listed. Sorting
 * gives every read one order, which is the order all 8 lesson files already use.
 */
const inStableOrder = (lesson: Lesson): Lesson => ({
  ...lesson,
  misconceptions: sortedEntries(lesson.misconceptions),
  quiz_items: lesson.quiz_items.map((item) => ({ ...item, options: sortedEntries(item.options) })),
});

/** One published version, or the current one. Never a draft. */
export async function getLessonVersion(lessonNumber: number, version?: number): Promise<LessonVersion | null> {
  await ensureBuiltInLessons();
  const row = await workspaceGet<LessonRow>(LIST, rowKey(lessonNumber));
  const wanted = version ?? row?.currentVersion;
  if (!row || !wanted) return null;
  const found = await workspaceGet<LessonVersion>(lessonPartition(row.lessonId), versionKey(wanted));
  return found && { ...found, lesson: inStableOrder(found.lesson) };
}

/**
 * The one place that decides which lesson a task reads: the version it's pinned
 * to if it's pinned to this lesson, otherwise the current version. A pin to a
 * version that can't be found gives null rather than a different version.
 */
export async function getTaskLesson(classId: string, assignmentId: string, lessonNumber: number): Promise<LessonVersion | null> {
  const [pin, quiz] = await Promise.all([getTaskLessonPin(classId, assignmentId), getPublishedTaskQuiz(classId, assignmentId)]);
  const version = await getLessonVersion(lessonNumber, pin?.lessonNumber === lessonNumber ? pin.version : undefined);
  // A quiz published for this task (#177) replaces the lesson's own, with its answer keys and matches.
  const published = quiz?.lesson?.number === lessonNumber ? lessonFromTaskQuiz(quiz) : null;
  return version && published ? { ...version, lesson: published } : version;
}

export type TaskLessonOption = LessonRow & { version: number; learningObjective: string; questionCount: number };

/** What a task can choose from: every published lesson, at the version this task would read. */
export async function listTaskLessons(classId: string, assignmentId: string): Promise<TaskLessonOption[]> {
  await ensureBuiltInLessons();
  const [rows, pin] = await Promise.all([workspaceQuery<LessonRow>(LIST, "LESSON#"), getTaskLessonPin(classId, assignmentId)]);
  const options = await Promise.all(rows.filter((row) => row.currentVersion !== null).map(async (row) => {
    const version = pin?.lessonNumber === row.lessonNumber ? pin.version : row.currentVersion!;
    const found = await workspaceGet<LessonVersion>(lessonPartition(row.lessonId), versionKey(version));
    if (!found) throw new Error(`Lesson ${row.lessonNumber} version ${version} could not be loaded.`);
    return {
      ...row, title: found.lesson.lesson_title, version, learningObjective: found.lesson.learning_objective,
      questionCount: found.lesson.quiz_items.filter((item) => item.type === "multiple_choice").length,
    };
  }));
  return options.sort((a, b) => a.lessonNumber - b.lessonNumber);
}

/** The lesson new tasks get: its objective, core ideas, misconceptions and quiz. */
export async function getCurrentLesson(lessonNumber: number): Promise<Lesson | null> {
  return (await getLessonVersion(lessonNumber))?.lesson ?? null;
}

export async function createLesson(user: UserContext) {
  requireTeacher(user);
  await ensureBuiltInLessons();
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await workspaceQuery<LessonRow>(LIST, "LESSON#");
    const lessonNumber = Math.max(0, ...rows.map((row) => row.lessonNumber)) + 1;
    const lessonId = `ea-lesson-${randomUUID()}`;
    const at = new Date().toISOString();
    const row: LessonRow = {
      lessonId, lessonNumber, title: "", createdBy: actorOf(user), createdAt: at,
      currentVersion: null, currentPublishedAt: null, draftVersion: 1, draftUpdatedAt: at,
    };
    const draft: LessonDraft = {
      lessonId, lessonNumber, version: 1, content: emptyLessonDraft(), revision: 1, updatedBy: actorOf(user), updatedAt: at,
    };
    try {
      await workspacePut([
        { partition: LIST, key: rowKey(lessonNumber), value: row, createOnly: true },
        { partition: lessonPartition(lessonId), key: "DRAFT", value: draft, createOnly: true },
      ]);
      return { row, draft };
    } catch (error) {
      // Someone else took this number; take the next one.
      if (!isWorkspaceConflict(error)) throw error;
    }
  }
  throw new WorkspaceError("Couldn't add the lesson. Please try again.", 503);
}

export async function getLessonDraft(lessonNumber: number) {
  const row = await requireRow(lessonNumber);
  return workspaceGet<LessonDraft>(lessonPartition(row.lessonId), "DRAFT");
}

async function requireDraft(row: LessonRow) {
  const draft = await workspaceGet<LessonDraft>(lessonPartition(row.lessonId), "DRAFT");
  if (!draft) throw new WorkspaceError("This lesson has no draft. Select Edit to start one.", 404);
  return draft;
}

function checkRevision(draft: LessonDraft, expected: number | undefined) {
  if (expected !== undefined && expected !== draft.revision) throw new WorkspaceError(CONFLICT, 409);
}

/** Starts draft N+1 as a copy of the current version, or opens the draft that already exists. */
export async function startLessonEdit(user: UserContext, lessonNumber: number) {
  requireTeacher(user);
  const row = await requireRow(lessonNumber);
  const existing = await workspaceGet<LessonDraft>(lessonPartition(row.lessonId), "DRAFT");
  if (existing) return existing;
  if (!row.currentVersion) throw new WorkspaceError("Lesson not found.", 404);
  const current = await workspaceGet<LessonVersion>(lessonPartition(row.lessonId), versionKey(row.currentVersion));
  if (!current) throw new WorkspaceError("Lesson not found.", 404);
  const at = new Date().toISOString();
  const draft: LessonDraft = {
    lessonId: row.lessonId, lessonNumber, version: row.currentVersion + 1, content: draftFromLesson(current.lesson),
    revision: 1, updatedBy: actorOf(user), updatedAt: at,
  };
  try {
    await workspacePut([
      { partition: lessonPartition(row.lessonId), key: "DRAFT", value: draft, createOnly: true },
      { partition: LIST, key: rowKey(lessonNumber), value: { ...row, draftVersion: draft.version, draftUpdatedAt: at } },
    ]);
    return draft;
  } catch (error) {
    if (!isWorkspaceConflict(error)) throw error;
    // Someone else started the draft a moment ago; open theirs.
    const theirs = await workspaceGet<LessonDraft>(lessonPartition(row.lessonId), "DRAFT");
    if (!theirs) throw new WorkspaceError(CONFLICT, 409);
    return theirs;
  }
}

export async function saveLessonDraft(user: UserContext, lessonNumber: number, content: LessonDraftContent, expectedRevision?: number) {
  requireTeacher(user);
  const row = await requireRow(lessonNumber);
  const current = await requireDraft(row);
  checkRevision(current, expectedRevision);
  const at = new Date().toISOString();
  const draft: LessonDraft = { ...current, content, revision: current.revision + 1, updatedBy: actorOf(user), updatedAt: at };
  await workspacePut([
    { partition: lessonPartition(row.lessonId), key: "DRAFT", value: draft },
    { partition: LIST, key: rowKey(lessonNumber), value: {
      ...row, draftUpdatedAt: at, ...(row.currentVersion === null ? { title: content.title.trim() } : {}),
    } },
  ]);
  return draft;
}

/** Deletes the draft. A lesson that was never published goes with it. */
export async function discardLessonDraft(user: UserContext, lessonNumber: number) {
  requireTeacher(user);
  const row = await requireRow(lessonNumber);
  await requireDraft(row);
  const removeDraft = { partition: lessonPartition(row.lessonId), key: "DRAFT", remove: true as const };
  if (row.currentVersion === null) {
    await workspacePut([removeDraft, { partition: LIST, key: rowKey(lessonNumber), remove: true }]);
    return { lessonDeleted: true };
  }
  await workspacePut([removeDraft, { partition: LIST, key: rowKey(lessonNumber), value: { ...row, draftVersion: null, draftUpdatedAt: null } }]);
  return { lessonDeleted: false };
}

/** What publishing would do: anything stopping it, and what changed since the current version. */
export async function previewLessonPublish(lessonNumber: number) {
  const row = await requireRow(lessonNumber);
  const draft = await requireDraft(row);
  const current = row.currentVersion ? await workspaceGet<LessonVersion>(lessonPartition(row.lessonId), versionKey(row.currentVersion)) : null;
  return {
    version: draft.version,
    problems: lessonProblems(draft.content),
    changes: current ? compareLessons(draftFromLesson(current.lesson), draft.content) : null as LessonChanges | null,
    suggestedNote: draft.version === 1 ? "First version" : "",
  };
}

export async function publishLessonDraft(user: UserContext, lessonNumber: number, changeNote: unknown, expectedRevision?: number) {
  requireTeacher(user);
  const row = await requireRow(lessonNumber);
  const draft = await requireDraft(row);
  checkRevision(draft, expectedRevision);
  const problems = lessonProblems(draft.content);
  if (problems.length) throw new LessonProblemsError(problems);
  const note = typeof changeNote === "string" ? changeNote.trim() : "";
  if (!note || note.length > 500) throw new WorkspaceError("Add a change note of up to 500 characters.");
  const at = new Date().toISOString();
  const lesson = lessonFromDraft(draft.content, lessonNumber);
  const version: LessonVersion = {
    lessonId: row.lessonId, lessonNumber, version: draft.version, status: "published", lesson,
    publishedBy: actorOf(user), publishedAt: at, changeNote: note,
  };
  try {
    await workspacePut([
      // Create-only, so two teachers publishing at once can't both win.
      { partition: lessonPartition(row.lessonId), key: versionKey(draft.version), value: version, createOnly: true },
      { partition: lessonPartition(row.lessonId), key: "DRAFT", remove: true },
      { partition: LIST, key: rowKey(lessonNumber), value: {
        ...row, title: lesson.lesson_title, currentVersion: draft.version, currentPublishedAt: at, draftVersion: null, draftUpdatedAt: null,
      } },
    ]);
  } catch (error) {
    if (isWorkspaceConflict(error)) throw new WorkspaceError(CONFLICT, 409);
    throw error;
  }
  return version;
}

/** Published versions, newest first. */
export async function listLessonVersions(lessonNumber: number) {
  const row = await requireRow(lessonNumber);
  const [versions, pins] = await Promise.all([
    workspaceQuery<LessonVersion>(lessonPartition(row.lessonId), "VERSION#"),
    pinsOf(row),
  ]);
  const counts = countByVersion(pins);
  return versions
    .sort((a, b) => b.version - a.version)
    .map(({ lesson, ...version }) => ({ ...version, title: lesson.lesson_title, taskCount: counts[version.version] ?? 0 }));
}

/** One version read-only, plus what changed since the version before it. */
export async function getLessonVersionDetail(lessonNumber: number, versionNumber: number) {
  const row = await requireRow(lessonNumber);
  const version = await workspaceGet<LessonVersion>(lessonPartition(row.lessonId), versionKey(versionNumber));
  if (!version) throw new WorkspaceError("Version not found.", 404);
  // Versions are numbered in order, but go by what's stored so a gap can't break compare.
  const earlier = (await workspaceQuery<LessonVersion>(lessonPartition(row.lessonId), "VERSION#"))
    .filter((other) => other.version < versionNumber).sort((a, b) => b.version - a.version)[0];
  const { lesson, ...meta } = version;
  const content = draftFromLesson(lesson);
  return {
    ...meta, title: lesson.lesson_title, content, previousVersion: earlier?.version ?? null,
    changes: earlier ? compareLessons(draftFromLesson(earlier.lesson), content) : null,
  };
}

/** The tasks using one version, for "Show tasks". */
export async function listLessonVersionTasks(lessonNumber: number, versionNumber: number) {
  const row = await requireRow(lessonNumber);
  const pins = (await pinsOf(row)).filter((pin) => pin.version === versionNumber);
  return Promise.all(pins.map(async (pin) => {
    const [classroom, assignment, quiz] = await Promise.all([
      workspaceGet<{ name: string }>(`WORKSPACE#${pin.classId}`, "META"),
      workspaceGet<{ title: string }>(`WORKSPACE#${pin.classId}`, `ASSIGN#${pin.assignmentId}`),
      getQuizStatus(pin.classId, pin.assignmentId).catch(() => null),
    ]);
    return {
      classId: pin.classId, assignmentId: pin.assignmentId, teacher: pin.teacher,
      className: classroom?.name ?? null, taskTitle: assignment?.title ?? null,
      quizPublished: quiz?.status === "published",
    };
  }));
}

export async function getTaskLessonPin(classId: string, assignmentId: string) {
  return workspaceGet<LessonTaskPin>(taskPinPartition(classId, assignmentId), "META");
}

/**
 * Records which version of a lesson a task uses. The task keeps that version
 * when a newer one is published; choosing a different lesson moves the pin.
 */
export async function pinTaskToLesson(user: UserContext, classId: string, assignmentId: string, lessonNumber: number) {
  await ensureBuiltInLessons();
  const existing = await getTaskLessonPin(classId, assignmentId);
  if (existing?.lessonNumber === lessonNumber) return existing;
  const row = await workspaceGet<LessonRow>(LIST, rowKey(lessonNumber));
  if (!row?.currentVersion) return null;
  const pin: LessonTaskPin = {
    classId, assignmentId, lessonNumber, version: row.currentVersion, teacher: actorOf(user), pinnedAt: new Date().toISOString(),
  };
  const oldRow = existing ? await workspaceGet<LessonRow>(LIST, rowKey(existing.lessonNumber)) : null;
  await workspacePut([
    ...(existing && oldRow ? [{ partition: lessonPartition(oldRow.lessonId), key: pinKey(existing.version, classId, assignmentId), remove: true as const }] : []),
    { partition: lessonPartition(row.lessonId), key: pinKey(pin.version, classId, assignmentId), value: pin },
    { partition: taskPinPartition(classId, assignmentId), key: "META", value: pin },
  ]);
  return pin;
}
