import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { emptyDraftQuizItem, type LessonDraftContent } from "@/lib/lessons";
import { MisconceptionId } from "@/lib/misconceptions";
import { getAllLessons } from "@/lib/quiz-data";

const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Ana Teacher", email: null, role: "teacher" };
const other: UserContext = { ...teacher, geniusId: "teacher-2", userId: "teacher-2", name: "Ben Teacher" };
const student: UserContext = { ...teacher, geniusId: "student-1", userId: "student-1", name: "Sam", role: "student" };
const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce, MC2 = MisconceptionId.HeavierAlwaysCausesMoreDamage;

const content = (title = "Forces"): LessonDraftContent => ({
  title, objective: "Explain forces.", topic: "Collisions", targetConcept: "Force pairs", coreIdeas: ["Idea one"], misconceptions: [MC1, MC2],
  quizItems: ["q1", "q2", "q3", "q4"].map((id) => ({
    ...emptyDraftQuizItem(id), stem: `Question ${id}?`, options: { A: `${id} a`, B: `${id} b`, C: `${id} c`, D: `${id} d` },
    correct: "A" as const, matchedMisconception: MC1, wrongOptionMisconceptions: { B: [MC1, MC2] }, explanation: "Because.",
  })),
});

let dir: string;
let store: typeof import("@/lib/lessons-store");
const load = async () => { vi.resetModules(); return import("@/lib/lessons-store"); };

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-lessons-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir);
  vi.stubEnv("DYNAMODB_TABLE", "");
  store = await load();
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

const publishNew = async (title = "Forces") => {
  const { row } = await store.createLesson(teacher);
  await store.saveLessonDraft(teacher, row.lessonNumber, content(title));
  await store.publishLessonDraft(teacher, row.lessonNumber, "First version");
  return row.lessonNumber;
};

describe("the 8 existing lessons", () => {
  it("are copied in as version 1, word for word", async () => {
    const rows = await store.listLessons();
    expect(rows.map((row) => row.lessonNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows[0]).toMatchObject({ currentVersion: 1, draftVersion: null, createdBy: { name: "EngageAgent" }, title: "Lesson 1", tasksByVersion: {} });
    for (const lesson of getAllLessons()) expect(await store.getCurrentLesson(lesson.lesson_number)).toEqual(lesson);
    expect((await store.listLessonVersions(1))[0]).toMatchObject({ version: 1, status: "published", changeNote: "First version", taskCount: 0 });
  });

  it("are only copied once, even when several requests arrive together or the server restarts", async () => {
    await Promise.all([store.ensureBuiltInLessons(), store.listLessons(), store.getCurrentLesson(1), store.getCurrentLesson(2)]);
    const first = await store.getLessonVersion(1);
    expect(await store.listLessons()).toHaveLength(8);
    expect(await store.listLessonVersions(1)).toHaveLength(1);
    const restarted = await load();
    await restarted.ensureBuiltInLessons();
    expect((await restarted.getLessonVersion(1))?.publishedAt).toBe(first?.publishedAt);
  });

  it("don't bring back an old copy after a lesson has been edited", async () => {
    await store.startLessonEdit(teacher, 1);
    const draft = await store.getLessonDraft(1);
    await store.saveLessonDraft(teacher, 1, {
      ...draft!.content, title: "Lesson 1 updated", topic: "t", targetConcept: "c",
      quizItems: draft!.content.quizItems.map((q) => ({ ...q, explanation: "Because." })),
    });
    await store.publishLessonDraft(teacher, 1, "Clearer title");
    await (await load()).ensureBuiltInLessons();
    expect((await store.getCurrentLesson(1))?.lesson_title).toBe("Lesson 1 updated");
  });

  it("can be read at their old version after a new one is published", async () => {
    await store.startLessonEdit(teacher, 1);
    const draft = await store.getLessonDraft(1);
    await store.saveLessonDraft(teacher, 1, {
      ...draft!.content, title: "Lesson 1 v2", topic: "t", targetConcept: "c",
      quizItems: draft!.content.quizItems.map((q) => ({ ...q, explanation: "Because." })),
    });
    await store.publishLessonDraft(teacher, 1, "v2");
    expect((await store.getLessonVersion(1, 1))?.lesson).toEqual(getAllLessons()[0]);
    expect((await store.getLessonVersion(1, 2))?.lesson.lesson_title).toBe("Lesson 1 v2");
    expect((await store.getLessonVersion(1))?.version).toBe(2);
  });
});

describe("adding a lesson (UC 2.1)", () => {
  it("gets a new ID, the next number and an empty draft version 1", async () => {
    const { row, draft } = await store.createLesson(teacher);
    expect(row).toMatchObject({ lessonNumber: 9, currentVersion: null, draftVersion: 1, createdBy: { id: "teacher-1", name: "Ana Teacher" } });
    expect(row.lessonId).toMatch(/^ea-lesson-/);
    expect(draft).toMatchObject({ version: 1, revision: 1, lessonNumber: 9 });
    expect(draft.content.title).toBe("");
    expect((await store.createLesson(other)).row.lessonNumber).toBe(10);
  });

  it("two teachers adding at once get different numbers", async () => {
    const [a, b, c] = await Promise.all([store.createLesson(teacher), store.createLesson(other), store.createLesson(teacher)]);
    expect(new Set([a.row.lessonNumber, b.row.lessonNumber, c.row.lessonNumber]).size).toBe(3);
  });

  it("isn't offered to tasks and can't be read until it's published", async () => {
    const { row } = await store.createLesson(teacher);
    await store.saveLessonDraft(teacher, row.lessonNumber, content());
    expect((await store.listTaskLessons("c1", "t1")).map((r) => r.lessonNumber)).not.toContain(row.lessonNumber);
    expect((await store.listLessons()).map((r) => r.lessonNumber)).toContain(row.lessonNumber);
    expect(await store.getCurrentLesson(row.lessonNumber)).toBeNull();
    expect(await store.getLessonVersion(row.lessonNumber, 1)).toBeNull();
  });

  it("keeps edits between visits, and the list shows the draft's title", async () => {
    const { row } = await store.createLesson(teacher);
    const saved = await store.saveLessonDraft(other, row.lessonNumber, content("My draft"));
    expect(saved).toMatchObject({ revision: 2, updatedBy: { id: "teacher-2" } });
    const reread = await (await load()).getLessonDraft(row.lessonNumber);
    expect(reread?.content).toEqual(content("My draft"));
    expect((await store.listLessons()).find((r) => r.lessonNumber === row.lessonNumber)?.title).toBe("My draft");
  });

  it("won't let an old copy overwrite a newer save", async () => {
    const { row } = await store.createLesson(teacher);
    await store.saveLessonDraft(teacher, row.lessonNumber, content("First"), 1);
    await expect(store.saveLessonDraft(other, row.lessonNumber, content("Stale"), 1)).rejects.toMatchObject({ status: 409 });
    expect((await store.getLessonDraft(row.lessonNumber))?.content.title).toBe("First");
    await expect(store.publishLessonDraft(teacher, row.lessonNumber, "note", 1)).rejects.toMatchObject({ status: 409 });
  });

  it("publishes as read-only version 1, and then appears for tasks", async () => {
    const { row } = await store.createLesson(teacher);
    await store.saveLessonDraft(teacher, row.lessonNumber, content());
    const version = await store.publishLessonDraft(other, row.lessonNumber, "  First version  ");
    expect(version).toMatchObject({ version: 1, status: "published", changeNote: "First version", publishedBy: { id: "teacher-2", name: "Ben Teacher" } });
    expect(version.publishedAt).toBeTruthy();
    expect(await store.getLessonDraft(row.lessonNumber)).toBeNull();
    const listed = (await store.listTaskLessons("c1", "t1")).find((r) => r.lessonNumber === row.lessonNumber);
    expect(listed).toMatchObject({ currentVersion: 1, draftVersion: null, title: "Forces" });
    expect(await store.getCurrentLesson(row.lessonNumber)).toMatchObject({ lesson_number: 9, lesson_title: "Forces" });
    await expect(store.saveLessonDraft(teacher, row.lessonNumber, content("Changed"))).rejects.toMatchObject({ status: 404 });
    expect((await store.getCurrentLesson(row.lessonNumber))?.lesson_title).toBe("Forces");
  });

  it("suggests the first version's note", async () => {
    const { row } = await store.createLesson(teacher);
    expect(await store.previewLessonPublish(row.lessonNumber)).toMatchObject({ version: 1, suggestedNote: "First version", changes: null });
  });

  it("publishes nothing when the draft has problems, and lists them", async () => {
    const { row } = await store.createLesson(teacher);
    const error = await store.publishLessonDraft(teacher, row.lessonNumber, "note").catch((e) => e);
    expect(error).toBeInstanceOf(store.LessonProblemsError);
    expect(error.status).toBe(422);
    expect(error.problems.map((p: { message: string }) => p.message)).toContain("Lesson title is required");
    expect((await store.getLessonDraft(row.lessonNumber))).not.toBeNull();
    expect(await store.getCurrentLesson(row.lessonNumber)).toBeNull();
  });

  it.each([[""], ["   "], [undefined], [7], ["x".repeat(501)]])("needs a real change note, not %j", async (note) => {
    const { row } = await store.createLesson(teacher);
    await store.saveLessonDraft(teacher, row.lessonNumber, content());
    await expect(store.publishLessonDraft(teacher, row.lessonNumber, note)).rejects.toMatchObject({ status: 400 });
    expect(await store.getCurrentLesson(row.lessonNumber)).toBeNull();
  });

  it("two teachers publishing at once publish it once", async () => {
    const { row } = await store.createLesson(teacher);
    await store.saveLessonDraft(teacher, row.lessonNumber, content());
    const results = await Promise.allSettled([
      store.publishLessonDraft(teacher, row.lessonNumber, "from Ana"),
      store.publishLessonDraft(other, row.lessonNumber, "from Ben"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason.status).toBe(409);
    expect(await store.listLessonVersions(row.lessonNumber)).toHaveLength(1);
    expect(await store.getLessonDraft(row.lessonNumber)).toBeNull();
  });
});

describe("discarding a draft (alternate flow C)", () => {
  it("deletes a lesson that was never published", async () => {
    const { row } = await store.createLesson(teacher);
    expect(await store.discardLessonDraft(teacher, row.lessonNumber)).toEqual({ lessonDeleted: true });
    expect((await store.listLessons()).map((r) => r.lessonNumber)).not.toContain(row.lessonNumber);
    await expect(store.getLessonDraft(row.lessonNumber)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps a published lesson and its versions", async () => {
    const n = await publishNew();
    await store.startLessonEdit(teacher, n);
    expect(await store.discardLessonDraft(teacher, n)).toEqual({ lessonDeleted: false });
    expect(await store.getLessonDraft(n)).toBeNull();
    expect((await store.listLessons()).find((r) => r.lessonNumber === n)).toMatchObject({ draftVersion: null, currentVersion: 1 });
    expect((await store.getCurrentLesson(n))?.lesson_title).toBe("Forces");
  });

  it("says so when there's no draft", async () => {
    await expect(store.discardLessonDraft(teacher, 1)).rejects.toMatchObject({ status: 404 });
  });
});

describe("editing and new versions (UC 2.2)", () => {
  it("starts draft N+1 as a copy, and opens the same draft the next time", async () => {
    const n = await publishNew();
    const draft = await store.startLessonEdit(other, n);
    expect(draft).toMatchObject({ version: 2, revision: 1 });
    expect(draft.content).toEqual(content());
    expect((await store.listLessons()).find((r) => r.lessonNumber === n)).toMatchObject({ draftVersion: 2, currentVersion: 1 });
    await store.saveLessonDraft(other, n, content("Edited"));
    expect((await store.startLessonEdit(teacher, n)).content.title).toBe("Edited");
  });

  it("two teachers selecting Edit at once share one draft", async () => {
    const n = await publishNew();
    const [a, b] = await Promise.all([store.startLessonEdit(teacher, n), store.startLessonEdit(other, n)]);
    expect(a.version).toBe(2);
    expect(b.version).toBe(2);
    expect((await store.listLessons()).find((r) => r.lessonNumber === n)?.draftVersion).toBe(2);
  });

  it("doesn't change what anyone sees until it's published", async () => {
    const n = await publishNew("Forces");
    await store.startLessonEdit(teacher, n);
    await store.saveLessonDraft(teacher, n, content("Secret edit"));
    expect((await store.getCurrentLesson(n))?.lesson_title).toBe("Forces");
    expect((await store.listLessons()).find((r) => r.lessonNumber === n)?.title).toBe("Forces");
  });

  it("shows what changed, publishes N+1, and keeps the old version untouched", async () => {
    const n = await publishNew("Forces");
    const before = await store.getLessonVersion(n, 1);
    await store.startLessonEdit(teacher, n);
    await store.saveLessonDraft(teacher, n, { ...content("Energy"), misconceptions: [MC1] , quizItems: content().quizItems.map((q) => ({ ...q, wrongOptionMisconceptions: {} })) });
    const preview = await store.previewLessonPublish(n);
    expect(preview).toMatchObject({ version: 2, problems: [], suggestedNote: "" });
    expect(preview.changes?.basics[0]).toMatchObject({ field: "Lesson title", before: "Forces", after: "Energy" });
    expect(preview.changes?.misconceptions.removed).toEqual([MC2]);

    expect((await store.publishLessonDraft(other, n, "Renamed")).version).toBe(2);
    expect((await store.getLessonVersion(n))?.version).toBe(2);
    expect(await store.getLessonVersion(n, 1)).toEqual(before);
    expect((await store.listLessons()).find((r) => r.lessonNumber === n)).toMatchObject({ title: "Energy", currentVersion: 2, draftVersion: null });
    expect((await store.startLessonEdit(teacher, n)).version).toBe(3);
  });
});

describe("history and compare (UC 2.3)", () => {
  it("lists versions newest first, and opens any of them with what changed", async () => {
    const n = await publishNew("Forces");
    await store.startLessonEdit(teacher, n);
    await store.saveLessonDraft(teacher, n, content("Energy"));
    await store.publishLessonDraft(other, n, "Renamed");
    const versions = await store.listLessonVersions(n);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ status: "published", publishedBy: { name: "Ben Teacher" }, changeNote: "Renamed", taskCount: 0, title: "Energy" });
    expect(versions[0]).not.toHaveProperty("lesson");

    const second = await store.getLessonVersionDetail(n, 2);
    expect(second).toMatchObject({ version: 2, previousVersion: 1, title: "Energy" });
    expect(second.content.title).toBe("Energy");
    expect(second.changes?.basics).toEqual([{ field: "Lesson title", before: "Forces", after: "Energy" }]);
    expect(await store.getLessonVersionDetail(n, 1)).toMatchObject({ previousVersion: null, changes: null });
    await expect(store.getLessonVersionDetail(n, 3)).rejects.toMatchObject({ status: 404 });
  });
});

describe("comparing with the version before", () => {
  it("compares version 3 with version 2, not version 1", async () => {
    const n = await publishNew("One");
    await store.startLessonEdit(teacher, n);
    await store.saveLessonDraft(teacher, n, content("Two"));
    await store.publishLessonDraft(teacher, n, "second");
    await store.startLessonEdit(teacher, n);
    await store.saveLessonDraft(teacher, n, content("Three"));
    await store.publishLessonDraft(teacher, n, "third");
    const detail = await store.getLessonVersionDetail(n, 3);
    expect(detail.previousVersion).toBe(2);
    expect(detail.changes?.basics).toEqual([{ field: "Lesson title", before: "Two", after: "Three" }]);
  });
});

describe("tasks using a version", () => {
  it("pins a task to the current version and keeps it there when a new one comes out", async () => {
    const pin = await store.pinTaskToLesson(teacher, "ea-class-1", "ea-task-1", 1);
    expect(pin).toMatchObject({ version: 1, lessonNumber: 1, teacher: { name: "Ana Teacher" } });
    const draft = await store.startLessonEdit(teacher, 1);
    await store.saveLessonDraft(teacher, 1, { ...draft.content, topic: "t", targetConcept: "c", quizItems: draft.content.quizItems.map((q) => ({ ...q, explanation: "Because." })) });
    await store.publishLessonDraft(teacher, 1, "v2");

    expect((await store.pinTaskToLesson(teacher, "ea-class-1", "ea-task-1", 1))?.version).toBe(1);
    expect((await store.pinTaskToLesson(teacher, "ea-class-1", "ea-task-2", 1))?.version).toBe(2);
    expect((await store.getTaskLessonPin("ea-class-1", "ea-task-1"))?.version).toBe(1);
    const row = (await store.listLessons()).find((r) => r.lessonNumber === 1);
    expect(row?.tasksByVersion).toEqual({ 1: 1, 2: 1 });
    expect((await store.listLessonVersions(1)).map((v) => v.taskCount)).toEqual([1, 1]);
  });

  it("moves the pin when the task chooses a different lesson", async () => {
    await store.pinTaskToLesson(teacher, "ea-class-1", "ea-task-1", 1);
    expect((await store.pinTaskToLesson(teacher, "ea-class-1", "ea-task-1", 2))?.lessonNumber).toBe(2);
    const rows = await store.listLessons();
    expect(rows[0].tasksByVersion).toEqual({});
    expect(rows[1].tasksByVersion).toEqual({ 1: 1 });
  });

  it("doesn't pin to a lesson that isn't published or doesn't exist", async () => {
    const { row } = await store.createLesson(teacher);
    expect(await store.pinTaskToLesson(teacher, "ea-class-1", "ea-task-1", row.lessonNumber)).toBeNull();
    expect(await store.pinTaskToLesson(teacher, "ea-class-1", "ea-task-1", 999)).toBeNull();
    expect(await store.getTaskLessonPin("ea-class-1", "ea-task-1")).toBeNull();
  });

  it("lists the class, task, teacher and whether the quiz is published", async () => {
    const workspace = await import("@/lib/workspace");
    const nosql = await import("@/lib/nosql");
    const classroom = await workspace.createWorkspaceClass(teacher, "Physics");
    const task = await workspace.createWorkspaceAssignment(teacher, classroom.id, "Collisions");
    await store.pinTaskToLesson(teacher, classroom.id, task.id, 1);
    await store.pinTaskToLesson(other, "genius-class", "genius-task", 1);
    await nosql.upsertQuizStatus(classroom.id, task.id, 1, "published", "teacher-1");
    const tasks = await store.listLessonVersionTasks(1, 1);
    expect(tasks).toEqual(expect.arrayContaining([
      { classId: classroom.id, assignmentId: task.id, teacher: { id: "teacher-1", name: "Ana Teacher" }, className: "Physics", taskTitle: "Collisions", quizPublished: true },
      { classId: "genius-class", assignmentId: "genius-task", teacher: { id: "teacher-2", name: "Ben Teacher" }, className: null, taskTitle: null, quizPublished: false },
    ]));
    expect(await store.listLessonVersionTasks(1, 2)).toEqual([]);
  });

  it("handles IDs with odd characters", async () => {
    await store.pinTaskToLesson(teacher, "class#1/a b", "task#1", 1);
    expect((await store.getTaskLessonPin("class#1/a b", "task#1"))?.classId).toBe("class#1/a b");
    expect((await store.listLessonVersionTasks(1, 1))[0]).toMatchObject({ classId: "class#1/a b", assignmentId: "task#1" });
  });
});

describe("only teachers change lessons", () => {
  it("refuses students everywhere", async () => {
    await expect(store.createLesson(student)).rejects.toMatchObject({ status: 403 });
    const n = await publishNew();
    await expect(store.startLessonEdit(student, n)).rejects.toMatchObject({ status: 403 });
    await store.startLessonEdit(teacher, n);
    await expect(store.saveLessonDraft(student, n, content("Hacked"))).rejects.toMatchObject({ status: 403 });
    await expect(store.publishLessonDraft(student, n, "note")).rejects.toMatchObject({ status: 403 });
    await expect(store.discardLessonDraft(student, n)).rejects.toMatchObject({ status: 403 });
    expect((await store.getLessonDraft(n))?.content.title).toBe("Forces");
  });
});
