import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { emptyDraftQuizItem } from "@/lib/lessons";
import { MisconceptionId } from "@/lib/misconceptions";
import { getAllLessons } from "@/lib/quiz-data";

// The access check turns this route away for every live request today, so it's
// skipped here to prove the route itself reads the stored lesson when it does run.
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null), workspaceRequestUser: vi.fn(async () => null) }));

const teacher: UserContext = { geniusId: "t1", userId: "t1", name: "Ana", email: null, role: "teacher" };
const task = { classId: "c1", assignmentId: "a1" };
let dir: string;
const run = async () => {
  const { POST } = await import("@/app/api/auto-answer-test-students/route");
  return POST(new Request("http://localhost/api/auto-answer-test-students", {
    method: "POST", headers: { "Content-Type": "application/json", "x-engage-mock-user": "teacher" }, body: JSON.stringify(task),
  }));
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-auto-answer-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir);
  vi.stubEnv("DYNAMODB_TABLE", "");
  vi.resetModules();
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

it("answers a brand-new lesson", async () => {
  const store = await import("@/lib/lessons-store");
  const nosql = await import("@/lib/nosql");
  const { row } = await store.createLesson(teacher);
  const mc = MisconceptionId.NoVisibleDamageMeansWeakForce;
  await store.saveLessonDraft(teacher, row.lessonNumber, {
    title: "Waves", objective: "o", topic: "t", targetConcept: "c", coreIdeas: ["i"], misconceptions: [mc],
    quizItems: ["n1", "n2", "n3", "n4"].map((id) => ({ ...emptyDraftQuizItem(id), stem: id, options: { A: id + "a", B: id + "b", C: id + "c", D: id + "d" }, correct: "A" as const, matchedMisconception: mc, explanation: "e" })),
  });
  await store.publishLessonDraft(teacher, row.lessonNumber, "First version");
  await nosql.upsertQuizStatus(task.classId, task.assignmentId, 9, "published");
  const response = await run();
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.lessonNumber).toBe(9);
  expect(Object.keys(body.students[0].answers)).toContain("n1_confidence");
});

it("answers the version the task is pinned to, after a newer one is published", async () => {
  const store = await import("@/lib/lessons-store");
  const nosql = await import("@/lib/nosql");
  await store.pinTaskToLesson(teacher, task.classId, task.assignmentId, 1);
  await nosql.upsertQuizStatus(task.classId, task.assignmentId, 1, "published");
  const draft = await store.startLessonEdit(teacher, 1);
  await store.saveLessonDraft(teacher, 1, { ...draft.content, topic: "t", targetConcept: "c", quizItems: [
    ...draft.content.quizItems.map((item) => ({ ...item, explanation: item.explanation || "why" })),
    { ...draft.content.quizItems[0], id: "ONLY_V2", explanation: "why", options: { A: "1", B: "2", C: "3", D: "4" } },
  ] });
  await store.publishLessonDraft(teacher, 1, "Second version");
  const { students } = await (await run()).json();
  expect(Object.keys(students[0].answers)).toEqual(getAllLessons()[0].quiz_items.map((item) => item.item_id));
});
