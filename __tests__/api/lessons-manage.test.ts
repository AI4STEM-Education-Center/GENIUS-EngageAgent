import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { emptyDraftQuizItem, type LessonDraftContent } from "@/lib/lessons";
import { MisconceptionId } from "@/lib/misconceptions";

// End to end with the real routes, access checks and local storage; only the signed-in user is faked.
const signedIn = vi.hoisted(() => ({ user: null as UserContext | null }));
vi.mock("@/lib/session", async original => ({
  ...await original<typeof import("@/lib/session")>(),
  sessionUser: vi.fn(async () => signedIn.user),
}));

const origin = "https://engageagent.ai4genius.org";
const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Ana", email: null, role: "teacher" };
const student: UserContext = { ...teacher, geniusId: "student-1", userId: "student-1", name: "Sam", role: "student" };
const guest: UserContext = { ...teacher, geniusId: "guest-1", userId: "guest-1", name: "Guest", role: "guest" } as UserContext;
const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce;
const content = (title = "Forces"): LessonDraftContent => ({
  title, objective: "o", topic: "t", targetConcept: "c", coreIdeas: ["i"], misconceptions: [MC1],
  quizItems: ["q1", "q2", "q3", "q4"].map((id) => ({
    ...emptyDraftQuizItem(id), stem: `${id}?`, options: { A: `${id}a`, B: `${id}b`, C: `${id}c`, D: `${id}d` },
    correct: "A" as const, matchedMisconception: MC1, explanation: "e",
  })),
});

let dir: string;
type Routes = {
  list: typeof import("@/app/api/lessons/route");
  one: typeof import("@/app/api/lessons/[lessonNumber]/route");
  draft: typeof import("@/app/api/lessons/[lessonNumber]/draft/route");
  publish: typeof import("@/app/api/lessons/[lessonNumber]/publish/route");
  versions: typeof import("@/app/api/lessons/[lessonNumber]/versions/route");
  version: typeof import("@/app/api/lessons/[lessonNumber]/versions/[version]/route");
  tasks: typeof import("@/app/api/lessons/[lessonNumber]/versions/[version]/tasks/route");
};
let routes: Routes;
let workspace: typeof import("@/lib/workspace");

const req = (url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => new Request(`${origin}${url}`, {
  method, headers: { ...(method === "GET" ? {} : { origin }), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});
const lessonCtx = (n: number | string) => ({ params: Promise.resolve({ lessonNumber: String(n) }) });
const versionCtx = (n: number | string, v: number | string) => ({ params: Promise.resolve({ lessonNumber: String(n), version: String(v) }) });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-lessons-api-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir);
  vi.stubEnv("DYNAMODB_TABLE", "");
  vi.stubEnv("ENGAGE_APP_URL", origin);
  vi.resetModules();
  routes = {
    list: await import("@/app/api/lessons/route"),
    one: await import("@/app/api/lessons/[lessonNumber]/route"),
    draft: await import("@/app/api/lessons/[lessonNumber]/draft/route"),
    publish: await import("@/app/api/lessons/[lessonNumber]/publish/route"),
    versions: await import("@/app/api/lessons/[lessonNumber]/versions/route"),
    version: await import("@/app/api/lessons/[lessonNumber]/versions/[version]/route"),
    tasks: await import("@/app/api/lessons/[lessonNumber]/versions/[version]/tasks/route"),
  };
  workspace = await import("@/lib/workspace");
  signedIn.user = teacher;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it("takes a lesson all the way: add, save, fix problems, publish, edit, publish again, history", async () => {
  const listed = await (await routes.list.GET(req("/api/lessons"))).json();
  expect(listed.lessons).toHaveLength(8);
  expect(listed.lessons[0]).toMatchObject({ lessonNumber: 1, currentVersion: 1, tasksByVersion: {} });
  expect(listed.lessons[0]).not.toHaveProperty("quiz_items");

  const created = await routes.list.POST(req("/api/lessons", "POST", {}));
  expect(created.status).toBe(201);
  const { row, draft } = await created.json();
  expect(row.lessonNumber).toBe(9);

  // Publishing an empty draft lists what's wrong and publishes nothing.
  const refused = await routes.publish.POST(req("/api/lessons/9/publish", "POST", { changeNote: "First version" }), lessonCtx(9));
  expect(refused.status).toBe(422);
  expect((await refused.json()).problems.map((p: { message: string }) => p.message)).toContain("Lesson title is required");
  expect((await routes.one.GET(req("/api/lessons/9"), lessonCtx(9))).status).toBe(404);

  const saved = await routes.draft.PUT(req("/api/lessons/9/draft", "PUT", { content: content(), revision: draft.revision }), lessonCtx(9));
  expect(saved.status).toBe(200);
  const savedDraft = (await saved.json()).draft;
  expect(savedDraft.revision).toBe(2);
  expect((await (await routes.draft.GET(req("/api/lessons/9/draft"), lessonCtx(9))).json()).draft.content.title).toBe("Forces");

  const preview = await (await routes.publish.GET(req("/api/lessons/9/publish"), lessonCtx(9))).json();
  expect(preview).toMatchObject({ version: 1, problems: [], suggestedNote: "First version" });

  const published = await routes.publish.POST(req("/api/lessons/9/publish", "POST", { changeNote: "First version", revision: 2 }), lessonCtx(9));
  expect(published.status).toBe(201);
  expect((await published.json()).version).toMatchObject({ version: 1, title: "Forces", changeNote: "First version" });

  const lesson = await (await routes.one.GET(req("/api/lessons/9"), lessonCtx(9))).json();
  expect(lesson).toMatchObject({ lesson_number: 9, lesson_title: "Forces", lesson_version: 1 });
  expect(lesson.quiz_items).toHaveLength(8);

  const started = await (await routes.draft.POST(req("/api/lessons/9/draft", "POST", {}), lessonCtx(9))).json();
  expect(started.draft.version).toBe(2);
  await routes.draft.PUT(req("/api/lessons/9/draft", "PUT", { content: content("Energy") }), lessonCtx(9));
  expect((await (await routes.publish.GET(req("/api/lessons/9/publish"), lessonCtx(9))).json()).changes.basics).toHaveLength(1);
  await routes.publish.POST(req("/api/lessons/9/publish", "POST", { changeNote: "Renamed" }), lessonCtx(9));

  expect((await (await routes.one.GET(req("/api/lessons/9"), lessonCtx(9))).json())).toMatchObject({ lesson_title: "Energy", lesson_version: 2 });
  expect((await (await routes.one.GET(req("/api/lessons/9?version=1"), lessonCtx(9))).json())).toMatchObject({ lesson_title: "Forces", lesson_version: 1 });

  const history = await (await routes.versions.GET(req("/api/lessons/9/versions"), lessonCtx(9))).json();
  expect(history.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  const detail = await (await routes.version.GET(req("/api/lessons/9/versions/2"), versionCtx(9, 2))).json();
  expect(detail).toMatchObject({ version: 2, previousVersion: 1, title: "Energy" });
  expect(detail.changes.basics[0]).toMatchObject({ before: "Forces", after: "Energy" });

  const discarded = await routes.draft.POST(req("/api/lessons/9/draft", "POST", {}), lessonCtx(9));
  expect((await discarded.json()).draft.version).toBe(3);
  expect(await (await routes.draft.DELETE(req("/api/lessons/9/draft", "DELETE"), lessonCtx(9))).json()).toEqual({ lessonDeleted: false });
});

it("still serves the 8 existing lessons the way the app has always read them", async () => {
  for (let n = 1; n <= 8; n++) {
    const response = await routes.one.GET(req(`/api/lessons/${n}`), lessonCtx(n));
    expect(response.status).toBe(200);
    const lesson = await response.json();
    expect(lesson).toMatchObject({ lesson_number: n, lesson_version: 1 });
    expect(lesson.learning_objective).toBeTruthy();
    expect(lesson.core_ideas.length).toBeGreaterThan(0);
    expect(Object.keys(lesson.misconceptions).length).toBeGreaterThan(0);
    expect(lesson.quiz_items.length).toBeGreaterThan(0);
  }
});

it.each<[string, string]>([["zero", "0"], ["text", "abc"], ["a fraction", "1.5"], ["a negative", "-1"], ["a huge number", "9999999"], ["a leading zero", "01"]])(
  "refuses %s as a lesson number", async (_label, n) => {
    expect((await routes.one.GET(req(`/api/lessons/${n}`), lessonCtx(n))).status).toBe(400);
    expect((await routes.draft.GET(req(`/api/lessons/${n}/draft`), lessonCtx(n))).status).toBe(400);
    expect((await routes.publish.GET(req(`/api/lessons/${n}/publish`), lessonCtx(n))).status).toBe(400);
    expect((await routes.versions.GET(req(`/api/lessons/${n}/versions`), lessonCtx(n))).status).toBe(400);
    expect((await routes.version.GET(req(`/api/lessons/${n}/versions/1`), versionCtx(n, 1))).status).toBe(400);
  },
);

it("says not found for a lesson or version that doesn't exist", async () => {
  expect((await routes.one.GET(req("/api/lessons/99"), lessonCtx(99))).status).toBe(404);
  expect((await routes.one.GET(req("/api/lessons/1?version=2"), lessonCtx(1))).status).toBe(404);
  expect((await routes.one.GET(req("/api/lessons/1?version=abc"), lessonCtx(1))).status).toBe(400);
  expect((await routes.draft.GET(req("/api/lessons/1/draft"), lessonCtx(1))).status).toBe(404);
  expect((await routes.draft.GET(req("/api/lessons/99/draft"), lessonCtx(99))).status).toBe(404);
  expect((await routes.version.GET(req("/api/lessons/1/versions/2"), versionCtx(1, 2))).status).toBe(404);
});

it("never serves a draft through the read route", async () => {
  await routes.list.POST(req("/api/lessons", "POST", {}));
  await routes.draft.PUT(req("/api/lessons/9/draft", "PUT", { content: content("Secret") }), lessonCtx(9));
  signedIn.user = null;
  const response = await routes.one.GET(req("/api/lessons/9"), lessonCtx(9));
  expect(response.status).toBe(404);
  expect(JSON.stringify(await response.json())).not.toContain("Secret");
  expect((await routes.one.GET(req("/api/lessons/9?version=1"), lessonCtx(9))).status).toBe(404);
});

describe("who can manage lessons", () => {
  const managing = (): [string, () => Promise<Response>][] => [
    ["list", () => routes.list.GET(req("/api/lessons"))],
    ["add", () => routes.list.POST(req("/api/lessons", "POST", {}))],
    ["read a draft", () => routes.draft.GET(req("/api/lessons/1/draft"), lessonCtx(1))],
    ["start editing", () => routes.draft.POST(req("/api/lessons/1/draft", "POST", {}), lessonCtx(1))],
    ["save", () => routes.draft.PUT(req("/api/lessons/1/draft", "PUT", { content: content() }), lessonCtx(1))],
    ["discard", () => routes.draft.DELETE(req("/api/lessons/1/draft", "DELETE"), lessonCtx(1))],
    ["preview", () => routes.publish.GET(req("/api/lessons/1/publish"), lessonCtx(1))],
    ["publish", () => routes.publish.POST(req("/api/lessons/1/publish", "POST", { changeNote: "x" }), lessonCtx(1))],
    ["history", () => routes.versions.GET(req("/api/lessons/1/versions"), lessonCtx(1))],
    ["a version", () => routes.version.GET(req("/api/lessons/1/versions/1"), versionCtx(1, 1))],
    ["its tasks", () => routes.tasks.GET(req("/api/lessons/1/versions/1/tasks"), versionCtx(1, 1))],
  ];

  const refused: [string, () => UserContext | null, number][] = [["a student", () => student, 403], ["a guest", () => guest, 403], ["someone signed out", () => null, 401]];
  it.each(refused)("refuses %s everywhere", async (_label, who, status) => {
    signedIn.user = who();
    for (const [, call] of managing()) expect((await call()).status).toBe(status);
  });

  it("refuses GENIUS launch tokens, even with a teacher signed in", async () => {
    const token = { authorization: "Bearer anything" };
    expect((await routes.list.GET(req("/api/lessons", "GET", undefined, token))).status).toBe(401);
    expect((await routes.list.POST(req("/api/lessons", "POST", {}, token))).status).toBe(401);
    expect((await routes.publish.POST(req("/api/lessons/1/publish", "POST", { changeNote: "x" }, token), lessonCtx(1))).status).toBe(401);
  });

  it("refuses changes from other websites", async () => {
    const evil = { origin: "https://evil.example" };
    expect((await routes.list.POST(req("/api/lessons", "POST", {}, evil))).status).toBe(403);
    expect((await routes.draft.POST(req("/api/lessons/1/draft", "POST", {}, evil), lessonCtx(1))).status).toBe(403);
    expect((await routes.draft.PUT(req("/api/lessons/1/draft", "PUT", { content: content() }, evil), lessonCtx(1))).status).toBe(403);
    expect((await routes.draft.DELETE(req("/api/lessons/1/draft", "DELETE", undefined, evil), lessonCtx(1))).status).toBe(403);
    expect((await routes.publish.POST(req("/api/lessons/1/publish", "POST", { changeNote: "x" }, evil), lessonCtx(1))).status).toBe(403);
    expect((await (await routes.list.GET(req("/api/lessons"))).json()).lessons).toHaveLength(8);
  });

  it("refuses repeated query parameters", async () => {
    expect((await routes.list.GET(req("/api/lessons?a=1&a=2"))).status).toBe(400);
  });
});

it("refuses bad bodies clearly", async () => {
  await routes.list.POST(req("/api/lessons", "POST", {}));
  const put = (body: unknown, headers?: Record<string, string>) => routes.draft.PUT(req("/api/lessons/9/draft", "PUT", body, headers), lessonCtx(9));
  expect((await put("not json")).status).toBe(400);
  expect((await put("[]")).status).toBe(400);
  expect((await put({})).status).toBe(400);
  expect((await put({ content: { title: 7 } })).status).toBe(400);
  expect((await put({ content: content() }, { "content-length": "3000000" })).status).toBe(413);
  expect((await routes.publish.POST(req("/api/lessons/9/publish", "POST", "not json"), lessonCtx(9))).status).toBe(400);
});

it("won't let a stale save through", async () => {
  await routes.list.POST(req("/api/lessons", "POST", {}));
  await routes.draft.PUT(req("/api/lessons/9/draft", "PUT", { content: content("First"), revision: 1 }), lessonCtx(9));
  const stale = await routes.draft.PUT(req("/api/lessons/9/draft", "PUT", { content: content("Stale"), revision: 1 }), lessonCtx(9));
  expect(stale.status).toBe(409);
});

describe("lessons a task can choose from", () => {
  let classId: string, taskId: string;
  beforeEach(async () => {
    const classroom = await workspace.createWorkspaceClass(teacher, "Physics");
    classId = classroom.id;
    taskId = (await workspace.createWorkspaceAssignment(teacher, classId, "Collisions")).id;
    await workspace.joinWorkspaceClass(student, classroom.joinCode);
  });
  const forTask = (): Promise<Response> => routes.list.GET(req(`/api/lessons?classId=${classId}&assignmentId=${taskId}`));

  it("only lists published lessons, for the class's teacher", async () => {
    await routes.list.POST(req("/api/lessons", "POST", {}));
    const { lessons } = await (await forTask()).json();
    expect(lessons.map((row: { lessonNumber: number }) => row.lessonNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("is closed to students, other teachers and signed-out visitors", async () => {
    signedIn.user = student;
    expect((await forTask()).status).toBe(403);
    signedIn.user = { ...teacher, geniusId: "teacher-2", userId: "teacher-2" };
    expect((await forTask()).status).toBe(403);
    signedIn.user = null;
    expect((await forTask()).status).toBe(401);
  });

  it("records the lesson version when a teacher saves the task's quiz, and shows it under Show tasks", async () => {
    const quizStatus = await import("@/app/api/quiz-status/route");
    const body = { classId, assignmentId: taskId, lessonNumber: 3, status: "published", publishedBy: "teacher-1" };
    expect((await quizStatus.POST(req("/api/quiz-status", "POST", body))).status).toBe(200);
    expect((await (await routes.list.GET(req("/api/lessons"))).json()).lessons[2].tasksByVersion).toEqual({ 1: 1 });
    const { tasks } = await (await routes.tasks.GET(req("/api/lessons/3/versions/1/tasks"), versionCtx(3, 1))).json();
    expect(tasks).toEqual([{ classId, assignmentId: taskId, teacher: { id: "teacher-1", name: "Ana" }, className: "Physics", taskTitle: "Collisions", quizPublished: true }]);
  });

  it("saves the quiz without recording a version for a lesson that doesn't exist", async () => {
    const store = await import("@/lib/workspace-store");
    const quizStatus = await import("@/app/api/quiz-status/route");
    const body = { classId, assignmentId: taskId, lessonNumber: 99999, status: "draft" };
    expect((await quizStatus.POST(req("/api/quiz-status", "POST", body))).status).toBe(200);
    expect(await store.workspaceGet(`WORKSPACE_LESSON_PIN#${encodeURIComponent(classId)}#${encodeURIComponent(taskId)}`, "META")).toBeNull();
  });
});

it("gives a plain error, with no details, when storage fails", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const { lessonFailure } = await import("@/lib/lessons-api");
  const response = lessonFailure(new Error("secret table details"));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("secret");
  expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
  logged.mockRestore();
});
