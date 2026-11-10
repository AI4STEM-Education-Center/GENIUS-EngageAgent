/**
 * Stored task quizzes (#177).
 *
 * "Activity" (#176) doesn't exist yet, so the class task (classId + assignmentId)
 * stands in for it. `QuizActivity` and `quizPartition` (lib/task-quiz-published.ts)
 * are the only places that know this, so moving to activities later means changing them.
 *
 * Rows in each task's partition:
 * - QUIZ: the working copy.
 * - PUBLISHED: an exact copy made when publishing. Create-only, so a task publishes once.
 * - REV#n: makes each save conditional. Only one writer can create revision n, and
 *   the row and the quiz are written together, so a stale save fails instead of
 *   overwriting newer work. That includes a save that loses to a publish.
 */
import type { UserContext } from "./auth";
import { draftFromLesson } from "./lessons";
import { getLessonVersion, getTaskLessonPin, pinTaskToLesson, type LessonVersion } from "./lessons-store";
import { getQuizStatus, listStudentAnswers, upsertQuizStatus } from "./nosql";
import { getPublishedTaskQuiz, PUBLISHED_KEY, quizPartition, type QuizActivity } from "./task-quiz-published";
import {
  applyItemChange, applyMatchResults, assertReplaceAllowed, emptyTaskQuiz, itemsFromLesson, lessonFromTaskQuiz, MAX_ANCHORING_LENGTH,
  PICK_LESSON_MESSAGE, publishProblems, PUBLISHED_MESSAGE, publishedBarLines, quizItemsFromTaskQuiz, reviewedCount, ReplaceConfirmationError,
  studentQuizItems, TaskQuizRuleError, taskQuizView, type ItemChange, type MatchResult, type QuizActor, type QuizSource, type QuizSourceDetail,
  type TaskQuiz, type TaskQuizItem, type TaskQuizLesson,
} from "./task-quiz";
import type { Lesson, QuizItem } from "./types";
import { isWorkspaceClass, workspaceClassSize } from "./workspace";
import { isWorkspaceConflict, workspaceGet, workspacePut } from "./workspace-store";

export { getPublishedTaskQuiz, type QuizActivity };

const QUIZ_KEY = "QUIZ";
const revisionKey = (revision: number) => `REV#${String(revision).padStart(6, "0")}`;
const REVISION_ROW_SECONDS = 24 * 60 * 60;
/** DynamoDB holds 400 KB per row. A quiz this large is well past any real one. */
const MAX_QUIZ_BYTES = 350_000;
const CONFLICT = "Someone else just changed this quiz. Reload to see the latest.";

const actorOf = (user: UserContext): QuizActor => ({ id: user.geniusId, name: user.name });

function requireTeacher(user: UserContext) {
  if (user.role !== "teacher") throw new TaskQuizRuleError("Teacher access required.", 403);
}

/** DynamoDB refuses undefined values, and a quiz should never depend on them. */
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function readQuiz(activity: QuizActivity) {
  return workspaceGet<TaskQuiz>(quizPartition(activity), QUIZ_KEY);
}

/** The quiz, if it can still change. A quiz published the old way (through /api/quiz-status) counts as published too. */
async function readForChange(activity: QuizActivity): Promise<TaskQuiz> {
  const [quiz, legacy] = await Promise.all([readQuiz(activity), getQuizStatus(activity.classId, activity.assignmentId)]);
  if (quiz?.status === "published" || legacy?.status === "published" || legacy?.status === "closed") throw new TaskQuizRuleError(PUBLISHED_MESSAGE, 409);
  return quiz ?? emptyTaskQuiz(activity.classId, activity.assignmentId);
}

function saveRows(quiz: TaskQuiz) {
  const value = clean(quiz);
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_QUIZ_BYTES) throw new TaskQuizRuleError("This quiz is too large to save.", 413);
  const partition = quizPartition(quiz);
  return [
    { partition, key: revisionKey(quiz.revision), value: { revision: quiz.revision }, createOnly: true, expiresAt: Math.floor(Date.now() / 1000) + REVISION_ROW_SECONDS },
    { partition, key: QUIZ_KEY, value },
  ];
}

function stamped(quiz: TaskQuiz, revision: number, user: UserContext): TaskQuiz {
  return { ...quiz, revision, updatedAt: new Date().toISOString(), updatedBy: actorOf(user) };
}

/**
 * Applies a change to the latest copy. If another save gets in first, the change
 * runs again on what that save left, so quick edits to different items both stick.
 */
async function mutate(user: UserContext, activity: QuizActivity, change: (quiz: TaskQuiz) => TaskQuiz, expectedRevision?: number): Promise<TaskQuiz> {
  requireTeacher(user);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readForChange(activity);
    if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new TaskQuizRuleError(CONFLICT, 409);
    const next = change(current);
    if (next === current) return current;
    const saved = stamped(next, current.revision + 1, user);
    try {
      await workspacePut(saveRows(saved));
      return saved;
    } catch (error) {
      if (!isWorkspaceConflict(error)) throw error;
    }
  }
  throw new TaskQuizRuleError(CONFLICT, 409);
}

function lessonSnapshot(version: LessonVersion): TaskQuizLesson {
  const content = draftFromLesson(version.lesson);
  return {
    number: version.lessonNumber, version: version.version, title: content.title, objective: content.objective, topic: content.topic,
    targetConcept: content.targetConcept, coreIdeas: content.coreIdeas, misconceptions: content.misconceptions,
  };
}

/** The Step 1 card for a lesson the teacher is looking at. Nothing is pinned until they pick it. */
export async function getLessonCard(lessonNumber: number): Promise<TaskQuizLesson | null> {
  const version = await getLessonVersion(lessonNumber);
  return version ? lessonSnapshot(version) : null;
}

/** UC 4.1: picks the lesson, pins its current version, and copies its quiz in. Picking the same lesson again changes nothing. */
export async function pickQuizLesson(user: UserContext, activity: QuizActivity, lessonNumber: number, confirmReplace: boolean, expectedRevision?: number) {
  requireTeacher(user);
  const before = await readForChange(activity);
  if (expectedRevision !== undefined && expectedRevision !== before.revision) throw new TaskQuizRuleError(CONFLICT, 409);
  if (before.lesson?.number === lessonNumber) {
    const pinned = await getTaskLessonPin(activity.classId, activity.assignmentId);
    if (pinned?.lessonNumber === lessonNumber && pinned.version === before.lesson.version) return before;
    // The pin moved away (see publishTaskQuiz), so this goes on to pick the lesson properly again.
  }
  const reviewed = reviewedCount(before);
  if (reviewed > 0 && !confirmReplace) throw new ReplaceConfirmationError(reviewed);
  const pin = await pinTaskToLesson(user, activity.classId, activity.assignmentId, lessonNumber);
  const version = pin ? await getLessonVersion(lessonNumber, pin.version) : null;
  if (!version) throw new TaskQuizRuleError("Lesson not found.", 404);
  const lesson = lessonSnapshot(version);
  const items = itemsFromLesson(draftFromLesson(version.lesson));
  return mutate(user, activity, (quiz) => ({
    ...quiz, lesson, items, source: "provided", sourceDetail: null, addedMisconceptions: [],
  }), expectedRevision);
}

/** Switching back to "Provided": a fresh copy from the pinned version. Already on it, nothing changes. */
export async function switchToProvidedQuiz(user: UserContext, activity: QuizActivity, confirmReplace: boolean) {
  requireTeacher(user);
  const before = await readForChange(activity);
  if (!before.lesson) throw new TaskQuizRuleError(PICK_LESSON_MESSAGE, 409);
  const version = await getLessonVersion(before.lesson.number, before.lesson.version);
  if (!version) throw new TaskQuizRuleError("Lesson not found.", 404);
  const items = itemsFromLesson(draftFromLesson(version.lesson));
  return mutate(user, activity, (quiz) => {
    if (quiz.source === "provided") return quiz;
    assertReplaceAllowed(quiz, "provided", confirmReplace);
    return { ...quiz, items, source: "provided", sourceDetail: null };
  });
}

/** The checks before slow work like reading a file or calling AI, so a refusal is quick and costs nothing. */
export async function prepareQuizReplace(activity: QuizActivity, source: QuizSource, confirmReplace: boolean) {
  const quiz = await readForChange(activity);
  if (!quiz.lesson) throw new TaskQuizRuleError(PICK_LESSON_MESSAGE, 409);
  assertReplaceAllowed(quiz, source, confirmReplace);
  return quiz;
}

/** Saves imported or AI items in place of the quiz. Everything is checked again, since this can follow a long wait. */
export async function replaceQuizItems(user: UserContext, activity: QuizActivity, input: {
  source: QuizSource; items: TaskQuizItem[]; sourceDetail: QuizSourceDetail | null; confirmReplace: boolean; builtFrom?: TaskQuizLesson;
}) {
  return mutate(user, activity, (quiz) => {
    if (!quiz.lesson) throw new TaskQuizRuleError(PICK_LESSON_MESSAGE, 409);
    if (input.builtFrom && (input.builtFrom.number !== quiz.lesson.number || input.builtFrom.version !== quiz.lesson.version)) {
      throw new TaskQuizRuleError(CONFLICT, 409);
    }
    assertReplaceAllowed(quiz, input.source, input.confirmReplace);
    return { ...quiz, items: input.items, source: input.source, sourceDetail: input.sourceDetail };
  });
}

export async function saveAnchoringPhenomenon(user: UserContext, activity: QuizActivity, text: string, expectedRevision?: number) {
  if (text.length > MAX_ANCHORING_LENGTH) throw new TaskQuizRuleError(`Keep the anchoring phenomenon under ${MAX_ANCHORING_LENGTH} characters.`);
  return mutate(user, activity, (quiz) => ({ ...quiz, anchoringPhenomenon: text.trim() }), expectedRevision);
}

export async function changeQuizItem(user: UserContext, activity: QuizActivity, itemId: string, change: ItemChange, expectedRevision?: number) {
  return mutate(user, activity, (quiz) => applyItemChange(quiz, itemId, change), expectedRevision);
}

/** The quiz "Match all items" works from. */
export async function prepareQuizMatch(activity: QuizActivity) {
  const quiz = await readForChange(activity);
  if (!quiz.lesson) throw new TaskQuizRuleError(PICK_LESSON_MESSAGE, 409);
  return quiz;
}

export async function saveMatchResults(user: UserContext, activity: QuizActivity, results: MatchResult[]) {
  return mutate(user, activity, (quiz) => applyMatchResults(quiz, results));
}

/* ------------------------------------------------------------------ */
/*  Publishing                                                         */
/* ------------------------------------------------------------------ */

const openForStudents = async (activity: QuizActivity, quiz: TaskQuiz, actorId: string) =>
  upsertQuizStatus(activity.classId, activity.assignmentId, quiz.lesson!.number, "published", actorId);

/** The status write failed, so the lock comes off and the teacher can try again (UC 4.5 flow B). */
async function undoPublish(user: UserContext, activity: QuizActivity, before: TaskQuiz, published: TaskQuiz) {
  const restored = stamped(before, published.revision + 1, user);
  await workspacePut([...saveRows(restored), { partition: quizPartition(activity), key: PUBLISHED_KEY, remove: true }]);
}

/**
 * UC 4.5. Everything that locks the quiz goes in one write, which fails if the
 * quiz moved on or was already published, so a task can only publish once. The
 * loser of a race gets the winner's result. If the step that opens the quiz for
 * students fails, the lock is undone. If undoing fails too, publishing again
 * finishes the job.
 */
export async function publishTaskQuiz(user: UserContext, activity: QuizActivity, expectedRevision?: number) {
  requireTeacher(user);
  const existing = await readQuiz(activity);
  if (existing?.status === "published") {
    const status = await getQuizStatus(activity.classId, activity.assignmentId);
    if (status?.status !== "published" && status?.status !== "closed") await openForStudents(activity, existing, existing.publishedBy?.id ?? user.geniusId);
    return { quiz: existing, alreadyPublished: true };
  }
  const current = await readForChange(activity);
  if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new TaskQuizRuleError(CONFLICT, 409);
  const problems = publishProblems(current);
  if (problems.length) throw new TaskQuizRuleError(problems[0], 422, problems);
  const pin = await getTaskLessonPin(activity.classId, activity.assignmentId);
  if (pin?.lessonNumber !== current.lesson?.number || pin?.version !== current.lesson?.version) {
    throw new TaskQuizRuleError("This task's lesson changed. Pick the lesson again.", 409);
  }
  const at = new Date().toISOString();
  const published: TaskQuiz = { ...stamped(current, current.revision + 1, user), status: "published", publishedAt: at, publishedBy: actorOf(user) };
  try {
    await workspacePut([...saveRows(published), { partition: quizPartition(activity), key: PUBLISHED_KEY, value: clean(published), createOnly: true }]);
  } catch (error) {
    if (!isWorkspaceConflict(error)) throw error;
    const winner = await readQuiz(activity);
    if (winner?.status === "published") return { quiz: winner, alreadyPublished: true };
    throw new TaskQuizRuleError(CONFLICT, 409);
  }
  try {
    await openForStudents(activity, published, user.geniusId);
  } catch (error) {
    console.error("Task quiz publish failed", { type: error instanceof Error ? error.name : "Unknown" });
    try {
      await undoPublish(user, activity, current, published);
    } catch (undoError) {
      console.error("Task quiz publish undo failed", { type: undoError instanceof Error ? undoError.name : "Unknown" });
    }
    throw new TaskQuizRuleError("Couldn't publish — try again", 503);
  }
  return { quiz: published, alreadyPublished: false };
}

async function classFacts(activity: QuizActivity) {
  if (!isWorkspaceClass(activity.classId)) return { className: null, classSize: null };
  const [classroom, classSize] = await Promise.all([
    workspaceGet<{ name: string }>(`WORKSPACE#${activity.classId}`, "META"),
    workspaceClassSize(activity.classId),
  ]);
  return { className: classroom?.name ?? null, classSize };
}

/** Number of students who answered this quiz's lesson. */
async function submittedCount(activity: QuizActivity, lessonNumber: number) {
  const answers = await listStudentAnswers(activity.classId, activity.assignmentId);
  return new Set(answers.filter((answer) => answer.lesson_number === lessonNumber).map((answer) => answer.student_id)).size;
}

export async function publishedBar(activity: QuizActivity, quiz: TaskQuiz) {
  const { className, classSize } = await classFacts(activity);
  return { ...publishedBarLines({ className, classSize, submitted: await submittedCount(activity, quiz.lesson!.number) }), classSize };
}

/** Everything the Step 1 screen needs. `legacyStatus` flags a task published the old way, which can't be edited here. */
export async function getTaskQuizState(activity: QuizActivity) {
  const [stored, legacy] = await Promise.all([readQuiz(activity), getQuizStatus(activity.classId, activity.assignmentId)]);
  const quiz = stored ?? emptyTaskQuiz(activity.classId, activity.assignmentId);
  return {
    quiz: taskQuizView(quiz),
    legacyStatus: legacy?.status ?? null,
    ...(quiz.status === "published" && quiz.lesson ? { publishedBar: await publishedBar(activity, quiz) } : {}),
  };
}

/** The quiz for "Preview as student". */
export async function getTaskQuizForPreview(activity: QuizActivity) {
  const quiz = await readQuiz(activity);
  if (!quiz?.lesson || !quiz.items.length) throw new TaskQuizRuleError("Pick a lesson and add a quiz item to preview it.", 404);
  return quiz;
}

export async function getTaskQuizSourceFile(activity: QuizActivity) {
  const detail = (await readQuiz(activity))?.sourceDetail;
  return detail?.kind === "file" ? detail : null;
}

/* ------------------------------------------------------------------ */
/*  For the rest of the app (students, strategy, reports)              */
/* ------------------------------------------------------------------ */

/** The published quiz with answer keys and confirmed misconception matches, each item followed by its confidence question. Teachers and server code only. */
export async function getTaskQuizItems(classId: string, assignmentId: string): Promise<QuizItem[] | null> {
  const quiz = await getPublishedTaskQuiz(classId, assignmentId);
  return quiz ? quizItemsFromTaskQuiz(quiz) : null;
}

/** The published quiz with no answer keys, misconceptions or explanations. Safe to send to students. */
export async function getStudentTaskQuizItems(classId: string, assignmentId: string): Promise<QuizItem[] | null> {
  const quiz = await getPublishedTaskQuiz(classId, assignmentId);
  return quiz ? studentQuizItems(quiz) : null;
}

/** The published quiz as a whole `Lesson`, for strategy and reports. */
export async function getTaskQuizLesson(classId: string, assignmentId: string): Promise<Lesson | null> {
  const quiz = await getPublishedTaskQuiz(classId, assignmentId);
  return quiz ? lessonFromTaskQuiz(quiz) : null;
}
