import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { UserContext } from "@/lib/auth";
import { emptyDraftQuizItem, type LessonDraftContent } from "@/lib/lessons";
import { MisconceptionId } from "@/lib/misconceptions";

// Runs the lesson store against a small stand-in for DynamoDB, which behaves
// like the real one for the calls used: all-or-nothing writes and create-only conditions.
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/lib-dynamodb", async original => ({
  ...await original<object>(),
  DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) },
}));

type Item = { class_id: string; record_id: string; value: unknown };
let items: Map<string, Item>;
let reads: { consistent: boolean | undefined }[];
const id = (pk: unknown, sk: unknown) => `${pk}|${sk}`;

const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Ana", email: null, role: "teacher" };
const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce;
const content = (title: string): LessonDraftContent => ({
  title, objective: "o", topic: "t", targetConcept: "c", coreIdeas: ["i"], misconceptions: [MC1],
  quizItems: ["q1", "q2", "q3", "q4"].map((qid) => ({
    ...emptyDraftQuizItem(qid), stem: `${qid}?`, options: { A: `${qid}a`, B: `${qid}b`, C: `${qid}c`, D: `${qid}d` },
    correct: "A" as const, matchedMisconception: MC1, explanation: "e",
  })),
});

const reversed = (value: unknown): unknown => Array.isArray(value) ? value.map(reversed)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversed(item)])) : value;

it("reads options and misconceptions in one order, whatever order the database returns them in", async () => {
  const store = await import("@/lib/lessons-store");
  const { getAllLessons } = await import("@/lib/quiz-data");
  await store.ensureBuiltInLessons();
  for (const [key, item] of items) items.set(key, reversed(item) as Item);
  for (const file of getAllLessons()) {
    const lesson = (await store.getTaskLesson("c", "t", file.lesson_number))!.lesson;
    expect(Object.keys(lesson.misconceptions)).toEqual(Object.keys(file.misconceptions));
    expect(lesson.quiz_items.map((item) => [item.item_id, Object.keys(item.options)])).toEqual(file.quiz_items.map((item) => [item.item_id, Object.keys(item.options)]));
  }
});

beforeEach(() => {
  vi.stubEnv("DYNAMODB_TABLE", "lessons-test");
  vi.resetModules();
  items = new Map();
  reads = [];
  mocks.send.mockReset().mockImplementation(async (command: unknown) => {
    if (command instanceof GetCommand) {
      reads.push({ consistent: command.input.ConsistentRead });
      return { Item: items.get(id(command.input.Key!.class_id, command.input.Key!.record_id)) };
    }
    if (command instanceof QueryCommand) {
      reads.push({ consistent: command.input.ConsistentRead });
      const values = command.input.ExpressionAttributeValues!;
      return { Items: [...items.values()].filter(item => item.class_id === values[":pk"] && item.record_id.startsWith(String(values[":prefix"]))) };
    }
    if (command instanceof TransactWriteCommand) {
      const writes = command.input.TransactItems!;
      for (const write of writes) {
        const put = write.Put;
        if (put?.ConditionExpression && items.has(id(put.Item!.class_id, put.Item!.record_id))) {
          throw Object.assign(new Error("Transaction cancelled"), {
            name: "TransactionCanceledException",
            CancellationReasons: writes.map(w => ({ Code: w === write ? "ConditionalCheckFailed" : "None" })),
          });
        }
      }
      for (const write of writes) {
        if (write.Put) items.set(id(write.Put.Item!.class_id, write.Put.Item!.record_id), write.Put.Item as Item);
        if (write.Delete) items.delete(id(write.Delete.Key!.class_id, write.Delete.Key!.record_id));
      }
      return {};
    }
    throw new Error("Unexpected database operation");
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("adds, saves, publishes and edits a lesson through the database, always reading the latest", async () => {
  const store = await import("@/lib/lessons-store");
  expect((await store.listLessons())).toHaveLength(8);
  const { row } = await store.createLesson(teacher);
  expect(row.lessonNumber).toBe(9);
  await store.saveLessonDraft(teacher, 9, content("Forces"));
  const version = await store.publishLessonDraft(teacher, 9, "First version");
  expect(version.version).toBe(1);
  expect([...items.keys()].some(key => key.endsWith("|DRAFT"))).toBe(false);
  expect((await store.getCurrentLesson(9))?.lesson_title).toBe("Forces");

  await store.startLessonEdit(teacher, 9);
  expect([...items.keys()].filter(key => key.endsWith("|DRAFT"))).toHaveLength(1);
  await store.discardLessonDraft(teacher, 9);
  expect([...items.keys()].some(key => key.endsWith("|DRAFT"))).toBe(false);
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(read => read.consistent === true)).toBe(true);
});

it("copies the 8 lessons in once, even from several servers at the same time", async () => {
  const servers = [];
  for (let i = 0; i < 3; i++) { vi.resetModules(); servers.push(await import("@/lib/lessons-store")); }
  await Promise.all(servers.map(server => server.ensureBuiltInLessons()));
  expect([...items.keys()].filter(key => key.startsWith("WORKSPACE_LESSONS|"))).toHaveLength(8);
  expect([...items.keys()].filter(key => key.includes("|VERSION#"))).toHaveLength(8);
  expect(await servers[0].listLessons()).toHaveLength(8);
});

it("doesn't overwrite an edited lesson if a server looks at an out-of-date list while copying", async () => {
  const store = await import("@/lib/lessons-store");
  const edited = { lessonId: "ea-lesson-1", lessonNumber: 1, title: "Edited by a teacher", currentVersion: 2 };
  items.set("WORKSPACE_LESSONS|LESSON#000001", { class_id: "WORKSPACE_LESSONS", record_id: "LESSON#000001", value: edited });
  const send = mocks.send.getMockImplementation()!;
  let firstList = true;
  mocks.send.mockImplementation(async (command: unknown) => {
    if (firstList && command instanceof QueryCommand) { firstList = false; return { Items: [] }; }
    return send(command);
  });
  await store.ensureBuiltInLessons();
  expect(items.get("WORKSPACE_LESSONS|LESSON#000001")!.value).toEqual(edited);
  expect([...items.keys()].filter(key => key.startsWith("WORKSPACE_LESSONS|"))).toHaveLength(8);
});

it("gives two teachers adding at once different numbers", async () => {
  const servers = [];
  for (let i = 0; i < 3; i++) { vi.resetModules(); servers.push(await import("@/lib/lessons-store")); }
  const added = await Promise.all(servers.map(server => server.createLesson(teacher)));
  expect(new Set(added.map(({ row }) => row.lessonNumber)).size).toBe(3);
});

it("publishes once when two servers publish the same draft at the same time", async () => {
  const servers = [];
  for (let i = 0; i < 2; i++) { vi.resetModules(); servers.push(await import("@/lib/lessons-store")); }
  await servers[0].createLesson(teacher);
  await servers[0].saveLessonDraft(teacher, 9, content("Forces"));
  const results = await Promise.allSettled(servers.map(server => server.publishLessonDraft(teacher, 9, "note")));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  // The slower one either loses the write or finds the draft already gone.
  expect([404, 409]).toContain((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.status);
  expect([...items.keys()].filter(key => key.includes("|VERSION#000001") && !/ea-lesson-[1-8]\|/.test(key))).toHaveLength(1);
});

it("treats losing a create-only write as a conflict, and doesn't write half of it", async () => {
  const store = await import("@/lib/lessons-store");
  await store.createLesson(teacher);
  await store.saveLessonDraft(teacher, 9, content("Forces"));
  const rowKey = `WORKSPACE_LESSONS|LESSON#000009`;
  const row = items.get(rowKey)!.value as { lessonId: string };
  // Another teacher published version 1 a moment before this one.
  items.set(`WORKSPACE_LESSON#${row.lessonId}|VERSION#000001`, { class_id: `WORKSPACE_LESSON#${row.lessonId}`, record_id: "VERSION#000001", value: {} });
  await expect(store.publishLessonDraft(teacher, 9, "note")).rejects.toMatchObject({ status: 409 });
  expect(items.has(`WORKSPACE_LESSON#${row.lessonId}|DRAFT`)).toBe(true);
  expect(items.get(rowKey)!.value).toMatchObject({ currentVersion: null, draftVersion: 1 });
});

it("doesn't call other database errors a conflict", async () => {
  const { isWorkspaceConflict } = await import("@/lib/workspace-store");
  expect(isWorkspaceConflict(Object.assign(new Error("x"), { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ThrottlingError" }] }))).toBe(false);
  expect(isWorkspaceConflict(Object.assign(new Error("x"), { name: "TransactionCanceledException", CancellationReasons: [{ Code: "TransactionConflict" }] }))).toBe(true);
  expect(isWorkspaceConflict(new Error("x"))).toBe(false);
  expect(isWorkspaceConflict("x")).toBe(false);
});

it("surfaces a real database failure instead of pretending the lessons are empty", async () => {
  const store = await import("@/lib/lessons-store");
  mocks.send.mockRejectedValueOnce(new Error("Database down"));
  await expect(store.listLessons()).rejects.toThrow("Database down");
  // The next read tries the set-up again.
  expect(await store.listLessons()).toHaveLength(8);
});
