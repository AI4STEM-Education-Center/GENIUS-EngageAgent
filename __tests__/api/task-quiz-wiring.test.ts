import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docx } from "@/__tests__/fixtures/quiz-files";
import type { UserContext } from "@/lib/auth";
import { SSO_ISSUER } from "@/lib/auth";
import { MisconceptionId, MISCONCEPTION_TEXT } from "@/lib/misconceptions";
import { emptyTaskQuiz, importedItem, quizItemsFromTaskQuiz, studentQuizItems } from "@/lib/task-quiz";
import type { Lesson, QuizItem } from "@/lib/types";

// A task's published quiz through the whole app (#177, UC 4.4 and 4.5): the real routes,
// access checks and local storage. Only the signed-in user and the AI provider are faked.
const fake = vi.hoisted(() => ({ user: null as unknown, chat: vi.fn(), responses: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/session", async (original) => ({
  ...await original<typeof import("@/lib/session")>(),
  sessionUser: vi.fn(async () => fake.user),
}));
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: fake.chat } };
    responses = { create: fake.responses, retrieve: vi.fn(), cancel: vi.fn() };
  }
  return { default: OpenAI, toFile: vi.fn(async () => "image"), APIConnectionTimeoutError: class extends Error {} };
});
vi.mock("@/lib/cohort-analysis-queue", () => ({
  enqueueCohortJobStudents: fake.enqueue,
  isCohortAnalysisQueueConfigured: () => true,
  getCohortAnalysisQueueConfigIssues: () => [],
}));

const origin = "http://localhost:3177";
const secret = "task-quiz-wiring-test-secret-not-a-real-credential";
const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Ana", email: null, role: "teacher" };
const otherTeacher: UserContext = { ...teacher, geniusId: "teacher-2", userId: "teacher-2", name: "Bo" };
const student: UserContext = { ...teacher, geniusId: "student-1", userId: "student-1", name: "Sam", role: "student" };
const outsider: UserContext = { ...teacher, geniusId: "student-9", userId: "student-9", name: "Lee", role: "student" };
const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce, MC2 = MisconceptionId.HeavierAlwaysCausesMoreDamage, MC3 = MisconceptionId.ForceNeededForConstantSpeed;
const STEMS = ["UP-STEM-1", "UP-STEM-2", "UP-STEM-3"];

type Task = { classId: string; assignmentId: string };
let dir: string;
let task: Task;
let routes: Awaited<ReturnType<typeof loadRoutes>>;
let store: typeof import("@/lib/lessons-store");
let quizStore: typeof import("@/lib/task-quiz-store");
let scope: typeof import("@/lib/lesson-scope");
let context: typeof import("@/lib/lesson-context");
let rule: typeof import("@/lib/strategy-recommendation");

const loadRoutes = async () => ({
  student: await import("@/app/api/task-quiz/student/route"),
  state: await import("@/app/api/task-quiz/route"),
  pick: await import("@/app/api/task-quiz/lesson/route"),
  upload: await import("@/app/api/task-quiz/upload/route"),
  create: await import("@/app/api/task-quiz/create/route"),
  item: await import("@/app/api/task-quiz/item/route"),
  publish: await import("@/app/api/task-quiz/publish/route"),
  preview: await import("@/app/api/task-quiz/preview/route"),
  sourceFile: await import("@/app/api/task-quiz/source-file/route"),
  lesson: await import("@/app/api/lessons/[lessonNumber]/route"),
  lessons: await import("@/app/api/lessons/route"),
  versions: await import("@/app/api/lessons/[lessonNumber]/versions/route"),
  quizStatus: await import("@/app/api/quiz-status/route"),
  answers: await import("@/app/api/student-answers/route"),
  report: await import("@/app/api/quiz-report/route"),
  release: await import("@/app/api/quiz-report-release/route"),
  single: await import("@/app/api/strategy-single/route"),
  batch: await import("@/app/api/strategy-batch/route"),
  job: await import("@/app/api/strategy-job/route"),
  slides: await import("@/app/api/slides/route"),
  content: await import("@/app/api/engagement-content/route"),
});

const post = (url: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => new Request(`${origin}${url}`, {
  method: "POST", headers: { origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
const get = (url: string, headers: Record<string, string> = {}) => new Request(`${origin}${url}`, { headers });
const query = (on: Task = task, extra: Record<string, string> = {}) => new URLSearchParams({ ...on, ...extra }).toString();
const ctx = (n: number) => ({ params: Promise.resolve({ lessonNumber: String(n) }) });
const as = async <T,>(user: unknown, work: () => Promise<T>) => { fake.user = user; try { return await work(); } finally { fake.user = teacher; } };
const reply = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }] });
const lastCall = (mock: { mock: { calls: unknown[][] } }) => JSON.stringify(mock.mock.calls.at(-1) ?? []);
const planReply = reply({ name: "x", strategy: "analogy", relevance: {}, overallRecommendation: "x", recommendationReason: "x", summary: "x", tldr: "x", rationale: "x", tactics: [], cadence: "x", checks: [] });

const pick = (lessonNumber = 1, on: Task = task, headers = {}) => routes.pick.POST(post("/api/task-quiz/lesson", { ...on, lessonNumber }, headers));
const change = (itemId: string, body: Record<string, unknown>) => routes.item.POST(post("/api/task-quiz/item", { ...task, itemId, ...body }));
const publish = (on: Task = task, headers = {}) => routes.publish.POST(post("/api/task-quiz/publish", { ...on }, headers));

/** Three uploaded questions: A is right. B has two misconceptions, C has "No misconception", D has one. */
async function publishUploaded() {
  expect((await pick()).status).toBe(200);
  fake.chat.mockResolvedValueOnce(reply({ items: STEMS.map((stem) => ({ stem, options: [`${stem} right`, `${stem} two`, `${stem} none`, `${stem} one`], answer_index: 0 })) }));
  const uploaded = await routes.upload.POST(new Request(`${origin}/api/task-quiz/upload?${query(task, { fileName: "Warm-up.docx" })}`, {
    method: "POST", headers: { origin, "Content-Type": "application/octet-stream" }, body: await docx(["1. Question?", "A) a", "B) b", "C) c", "D) d"]) as BodyInit,
  }));
  expect(uploaded.status).toBe(200);
  const { quiz } = await uploaded.json() as { quiz: { items: { id: string }[] } };
  for (const { id } of quiz.items) {
    await change(id, { action: "setMatch", letter: "B", ids: [MC1, MC2] });
    await change(id, { action: "setMatch", letter: "C", noMisconception: true });
    await change(id, { action: "setMatch", letter: "D", ids: [MC2] });
    expect((await change(id, { action: "confirm" })).status).toBe(200);
  }
  expect((await publish()).status).toBe(201);
  return quiz.items.map((item) => item.id);
}

const submit = (studentId: string, name: string, answers: Record<string, string>) => as({ ...student, geniusId: studentId, userId: studentId, name }, () => routes.answers.POST(
  post("/api/student-answers", { ...task, studentId, studentName: name, lessonNumber: 1, answers })));

/** What the server sees as this task's lesson, in the shape every route gets. */
const taskLesson = async () => (await store.getTaskLesson(task.classId, task.assignmentId, 1))!.lesson;
const inScope = async <T,>(work: () => T) => { scope.enterLessonScope(await scope.loadTaskLessons(task, 1)); return work(); };
const mcOf = (lesson: Lesson): QuizItem[] => lesson.quiz_items.filter((item) => item.type === "multiple_choice");

const expectNoKeys = (text: string) => {
  for (const secretWord of ["correct_answer", "distractor_misconception_map", "matched_misconception", "explanation", "misconceptions"]) expect(text).not.toContain(secretWord);
  expect(text).not.toMatch(/MC\d\d/u);
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-task-quiz-wiring-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir);
  vi.stubEnv("DYNAMODB_TABLE", "");
  vi.stubEnv("ENGAGE_S3_BUCKET", "");
  vi.stubEnv("ENGAGE_LOCAL_MATERIAL_STORAGE", "1");
  vi.stubEnv("ENGAGE_APP_URL", origin);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("SSO_SECRET", secret);
  vi.stubEnv("SSO_FALLBACK_SECRET", "");
  vi.resetModules();
  routes = await loadRoutes();
  store = await import("@/lib/lessons-store");
  quizStore = await import("@/lib/task-quiz-store");
  scope = await import("@/lib/lesson-scope");
  context = await import("@/lib/lesson-context");
  rule = await import("@/lib/strategy-recommendation");
  const workspace = await import("@/lib/workspace");
  fake.user = teacher;
  fake.chat.mockReset();
  fake.responses.mockReset().mockResolvedValue({ id: "provider-response" });
  fake.enqueue.mockReset().mockResolvedValue(undefined);
  const classroom = await workspace.createWorkspaceClass(teacher, "Physics");
  await as(student, () => workspace.joinWorkspaceClass(student, classroom.joinCode));
  const { id } = await workspace.createWorkspaceAssignment(teacher, classroom.id, "Task");
  task = { classId: classroom.id, assignmentId: id };
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

describe("a task published with an uploaded quiz", () => {
  it("gives students those questions, each with its confidence question, and no keys", async () => {
    await publishUploaded();
    const response = await as(student, () => routes.student.GET(get(`/api/task-quiz/student?${query()}`)));
    expect(response.status).toBe(200);
    const text = await response.text();
    expectNoKeys(text);
    const { items } = JSON.parse(text) as { items: QuizItem[] };
    expect(items.filter((item) => item.type === "multiple_choice").map((item) => item.stem)).toEqual(STEMS);
    for (const item of items.filter((entry) => entry.type === "multiple_choice")) {
      expect(items.find((entry) => entry.item_id === `${item.item_id}_confidence`)?.stem).toBe("How confident are you about your answer?");
    }
  });

  it("scores answers against that quiz, in the student's report", async () => {
    const ids = await publishUploaded();
    await submit(student.geniusId, student.name, { [ids[0]]: "A", [ids[1]]: "B", [ids[2]]: "C", [`${ids[0]}_confidence`]: "A" });
    const before = await as(student, () => routes.report.GET(get(`/api/quiz-report?${query(task, { studentId: student.geniusId })}`)));
    expect(await before.json()).toEqual({ release: null, report: null });
    await routes.release.POST(post("/api/quiz-report-release", { ...task, reason: "early" }));
    const { report } = await (await as(student, () => routes.report.GET(get(`/api/quiz-report?${query(task, { studentId: student.geniusId })}`)))).json();
    expect(report).toMatchObject({ correct: 1, total: 3 });
    expect(report.items.map((item: { stem: string }) => item.stem)).toEqual(STEMS);
    expect(report.items[1]).toMatchObject({ isCorrect: false, answer: { key: "B" }, correctAnswer: { key: "A", text: "UP-STEM-2 right" } });
  });

  it("counts a wrong option with two misconceptions toward both, and \"No misconception\" toward none", async () => {
    const ids = await publishUploaded();
    const lesson = await taskLesson();
    const submissions = [
      { [ids[0]]: "B", [ids[1]]: "C", [ids[2]]: "A" }, // One answer tied to two ideas, one tied to none, one right.
      { [ids[0]]: "A", [ids[1]]: "D", [ids[2]]: "A" },
    ];
    const counts = rule.countClassResponses(lesson, submissions);
    expect(counts).toMatchObject({ students: 2, responses: 6, correct: 3, incorrect: 3, unlinked: 1 });
    const countOf = (id: string) => counts.misconceptions.find((entry) => entry.id === id)?.count;
    expect(countOf(MC1)).toBe(1);
    expect(countOf(MC2)).toBe(2);
  });

  it("gives strategy the matches: both ideas for one option, and nothing made up for \"No misconception\"", async () => {
    const ids = await publishUploaded();
    const evidence = await inScope(() => context.resolveQuizEvidence(1, { [ids[0]]: "B", [ids[1]]: "C", [ids[2]]: "A" }));
    expect(evidence.map((entry) => entry.stem)).toEqual(STEMS);
    expect(evidence[0]).toMatchObject({ isCorrect: false, misconceptionCode: `${MC1}, ${MC2}`, misconceptionText: `${MISCONCEPTION_TEXT[MC1]}; ${MISCONCEPTION_TEXT[MC2]}` });
    expect(evidence[1]).toMatchObject({ isCorrect: false, correctOption: "A", misconceptionCode: null, misconceptionText: null });
    expect(evidence[2]).toMatchObject({ isCorrect: true, misconceptionCode: null });
    const recommendation = await inScope(() => rule.recommendStrategy(1, [{ [ids[0]]: "D", [ids[1]]: "D", [ids[2]]: "D" }]));
    expect(recommendation).toMatchObject({ strategy: "cognitive conflict", target: { id: MC2, count: 3 } });
  });

  it.each([
    ["strategy-single", () => routes.single.POST(post("/api/strategy-single", { ...task, lessonNumber: 1, student: { id: "one", name: "Sam", answers: { x: "A" } } })), () => fake.chat],
    ["strategy-batch", () => routes.batch.POST(post("/api/strategy-batch", { ...task, lessonNumber: 1, students: [{ id: "many", name: "Sam", answers: { x: "A" } }] })), () => fake.chat],
    ["strategy-job", () => routes.job.POST(post("/api/strategy-job", { ...task, lessonNumber: 1, students: [{ id: "s", name: "Sam", answers: {} }] })), () => fake.enqueue],
  ] as const)("reaches %s", async (_, call, mock) => {
    await publishUploaded();
    fake.chat.mockResolvedValue(planReply);
    expect((await call()).status).toBeLessThan(300);
    expect(lastCall(mock())).toContain("UP-STEM-1");
  });

  it("reaches materials and slides, with a misconception added for this task, but no answer keys", async () => {
    fake.chat.mockReset();
    expect((await pick()).status).toBe(200);
    fake.chat.mockResolvedValueOnce(reply({ items: STEMS.map((stem) => ({
      stem, explanation: "Because",
      options: [
        { text: `${stem} right`, is_correct: true, misconception_ids: [], no_misconception: true, confidence: "High", reason: "Right" },
        { text: "b", is_correct: false, misconception_ids: [MC1], no_misconception: false, confidence: "High", reason: "Fits" },
        { text: "c", is_correct: false, misconception_ids: [], no_misconception: true, confidence: "Low", reason: "Distractor" },
        { text: "d", is_correct: false, misconception_ids: [MC3], no_misconception: false, confidence: "Medium", reason: "New" },
      ],
    })) }));
    const created = await routes.create.POST(post("/api/task-quiz/create", { ...task, count: 3, focus: "all", readingLevel: "Grade 7" }));
    const { quiz } = await created.json() as { quiz: { items: { id: string }[] } };
    for (const { id } of quiz.items) {
      await change(id, { action: "addPossibleNew", letter: "D", id: MC3 });
      expect((await change(id, { action: "confirm" })).status).toBe(200);
    }
    expect((await publish()).status).toBe(201);

    const lesson = await taskLesson();
    expect(Object.keys(lesson.misconceptions)).toContain(MC3);
    const original = (await store.getLessonVersion(1, 1))!.lesson;
    expect(JSON.stringify(original)).not.toContain(MISCONCEPTION_TEXT[MC3]);

    await routes.slides.POST(post("/api/slides", { ...task, lessonNumber: 1, strategy: "cognitive conflict" }));
    expect(lastCall(fake.responses)).toContain(MISCONCEPTION_TEXT[MC3]);
  });

  it("changes nothing for the task's teacher: the full quiz, with keys, for steps 2 to 4", async () => {
    const ids = await publishUploaded();
    const response = await routes.lesson.GET(get(`/api/lessons/1?${query()}`), ctx(1));
    expect(response.status).toBe(200);
    const lesson = await response.json() as Lesson;
    expect(mcOf(lesson).map((item) => item.item_id)).toEqual(ids);
    expect(mcOf(lesson)[0]).toMatchObject({ correct_answer: "A", distractor_misconception_map: { B: `${MC1}, ${MC2}`, D: MC2 } });
    expect(mcOf(lesson)[0].distractor_misconception_map?.C).toBeUndefined();
  });
});

describe("students can't reach the keys of a published quiz", () => {
  const readByStudent: [string, () => Promise<Response>][] = [
    ["GET /api/lessons/1 for the task", () => routes.lesson.GET(get(`/api/lessons/1?${query()}`), ctx(1))],
    ["GET /api/task-quiz", () => routes.state.GET(get(`/api/task-quiz?${query()}`))],
    ["GET /api/task-quiz/lesson", () => routes.pick.GET(get(`/api/task-quiz/lesson?${query()}`))],
    ["GET /api/task-quiz/preview", () => routes.preview.GET(get(`/api/task-quiz/preview?${query()}`))],
    ["GET /api/task-quiz/source-file", () => routes.sourceFile.GET(get(`/api/task-quiz/source-file?${query()}`))],
    ["GET /api/lessons for the task", () => routes.lessons.GET(get(`/api/lessons?${query()}`))],
    ["GET /api/lessons/1/versions", () => routes.versions.GET(get("/api/lessons/1/versions"), ctx(1))],
    ["POST /api/strategy-single", () => routes.single.POST(post("/api/strategy-single", { ...task, lessonNumber: 1, student: { id: "s", name: "Sam", answers: {} } }))],
    ["POST /api/slides", () => routes.slides.POST(post("/api/slides", { ...task, lessonNumber: 1, strategy: "cognitive conflict" }))],
    ["POST /api/engagement-content", () => routes.content.POST(post("/api/engagement-content", { ...task, lessonNumber: 1, selectedStrategies: ["analogy"] }))],
    ["GET someone else's report", () => routes.report.GET(get(`/api/quiz-report?${query(task, { studentId: "someone-else" })}`))],
    ["GET the class's reports", () => routes.report.GET(get(`/api/quiz-report?${query()}`))],
    ["GET the class's answers", () => routes.answers.GET(get(`/api/student-answers?${query()}`))],
  ];

  it.each(readByStudent)("%s is refused for a student", async (_, call) => {
    await publishUploaded();
    const response = await as(student, call);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("UP-STEM-1");
  });

  it.each([["signed out", null], ["a student outside the class", outsider], ["another teacher", otherTeacher]])("%s can't read it either way", async (_, user) => {
    await publishUploaded();
    for (const call of [() => routes.lesson.GET(get(`/api/lessons/1?${query()}`), ctx(1)), () => routes.student.GET(get(`/api/task-quiz/student?${query()}`))]) {
      const response = await as(user, call);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain("UP-STEM-1");
    }
  });

  it("the student route is the only one the guard's list opened: writes to it are refused", async () => {
    await publishUploaded();
    const denied = await (await import("@/lib/workspace-access")).guardWorkspaceRequest(post("/api/task-quiz/student", { ...task }));
    expect(denied).toBeNull(); // This one is the teacher's.
    const forStudent = await as(student, async () => (await import("@/lib/workspace-access")).guardWorkspaceRequest(post("/api/task-quiz/student", { ...task })));
    expect(forStudent?.status).toBe(403);
  });

  it("a lesson's other reads never carry the published quiz: a version asked for by number is the lesson's own", async () => {
    await publishUploaded();
    const response = await as(null, () => routes.lesson.GET(get(`/api/lessons/1?${query(task, { version: "1" })}`), ctx(1)));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("UP-STEM-1");
    const open = await as(null, () => routes.lesson.GET(get("/api/lessons/1"), ctx(1)));
    expect(await open.text()).not.toContain("UP-STEM-1");
  });

  it("a quiz not published yet is nowhere but the teacher's screen", async () => {
    await pick();
    fake.chat.mockResolvedValueOnce(reply({ items: [{ stem: "UP-STEM-1", options: ["a", "b", "c", "d"], answer_index: 0 }] }));
    await routes.upload.POST(new Request(`${origin}/api/task-quiz/upload?${query(task, { fileName: "Warm-up.docx" })}`, {
      method: "POST", headers: { origin, "Content-Type": "application/octet-stream" }, body: await docx(["1. Question?", "A) a", "B) b", "C) c", "D) d"]) as BodyInit,
    }));
    expect(await (await as(student, () => routes.student.GET(get(`/api/task-quiz/student?${query()}`)))).json()).toEqual({ items: null });
    expect(await (await as(null, () => routes.lesson.GET(get(`/api/lessons/1?${query()}`), ctx(1)))).text()).not.toContain("UP-STEM-1");
    expect(JSON.stringify(await taskLesson())).not.toContain("UP-STEM-1");
  });

  it("publishing refuses an unconfirmed quiz, so the rest of the app keeps reading the lesson", async () => {
    await pick();
    fake.chat.mockResolvedValueOnce(reply({ items: [{ stem: "UP-STEM-1", options: ["a", "b", "c", "d"], answer_index: 0 }] }));
    await routes.upload.POST(new Request(`${origin}/api/task-quiz/upload?${query(task, { fileName: "Warm-up.docx" })}`, {
      method: "POST", headers: { origin, "Content-Type": "application/octet-stream" }, body: await docx(["1. Question?", "A) a", "B) b", "C) c", "D) d"]) as BodyInit,
    }));
    expect((await publish()).status).toBe(422);
    expect(await quizStore.getPublishedTaskQuiz(task.classId, task.assignmentId)).toBeNull();
    expect(JSON.stringify(await taskLesson())).not.toContain("UP-STEM-1");
  });
});

describe("only confirmed matches go any further", () => {
  const item = (id: string, confirmed: boolean) => {
    const made = importedItem(id, "Stem?", ["a", "b", "c", "d"], "A");
    return { ...made, confirmed, explanation: "Why", options: made.options.map((option, index) => (index === 1 ? { ...option, match: { state: "matched" as const, ids: [MC1], setBy: "ai" as const, confidence: "High" as const, reason: "Fits" } } : option)) };
  };
  const quiz = { ...emptyTaskQuiz("c", "t"), items: [item("yes", true), item("no", false)] };

  it("leaves an unconfirmed item's AI suggestion out of the matches", () => {
    const [confirmed, , unconfirmed] = quizItemsFromTaskQuiz(quiz);
    expect(confirmed.distractor_misconception_map).toEqual({ B: MC1 });
    expect(unconfirmed.distractor_misconception_map).toEqual({});
    expect(unconfirmed.matched_misconception).toBeUndefined();
  });

  it("builds a student's items with no answer, match, or explanation, confirmed or not", () => {
    expectNoKeys(JSON.stringify(studentQuizItems(quiz)));
  });
});

describe("a Provided quiz", () => {
  it("publishes the lesson's questions, with no keys for students and the teacher's changes in strategy", async () => {
    await pick();
    const original = mcOf((await store.getLessonVersion(1, 1))!.lesson);
    const first = original[0];
    const wrong = ["A", "B", "C", "D"].filter((letter) => letter !== first.correct_answer);
    await change(first.item_id, { action: "setMatch", letter: wrong[0], noMisconception: true });
    expect((await publish()).status).toBe(201);

    const text = await (await as(student, () => routes.student.GET(get(`/api/task-quiz/student?${query()}`)))).text();
    expectNoKeys(text);
    expect(text).toContain(JSON.stringify(first.stem).slice(1, -1));
    expect((await as(student, () => routes.lesson.GET(get(`/api/lessons/1?${query()}`), ctx(1)))).status).toBe(403);

    const lesson = await taskLesson();
    expect(mcOf(lesson).map((entry) => entry.item_id)).toEqual(original.map((entry) => entry.item_id));
    expect(mcOf(lesson).map((entry) => entry.correct_answer)).toEqual(original.map((entry) => entry.correct_answer));
    expect(mcOf(lesson)[0].distractor_misconception_map?.[wrong[0]]).toBeUndefined();
    const evidence = await inScope(() => context.resolveQuizEvidence(1, { [first.item_id]: wrong[0] }));
    expect(evidence[0]).toMatchObject({ isCorrect: false, misconceptionCode: null });
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("lesson %i counts in the strategy rule, every match being on the lesson's list", async (n) => {
    expect((await pick(n)).status).toBe(200);
    expect((await publish()).status).toBe(201);
    const lesson = (await store.getTaskLesson(task.classId, task.assignmentId, n))!.lesson;
    const wrongEverywhere = Object.fromEntries(mcOf(lesson).map((item) => [item.item_id, Object.keys(item.options).find((letter) => letter !== item.correct_answer)!]));
    const counts = rule.countClassResponses(lesson, [wrongEverywhere]);
    expect(counts.correct).toBe(0);
    expect(lesson.core_ideas.length).toBeGreaterThan(0);
  });
});

describe("a task published the old way", () => {
  it("reads its lesson as before", async () => {
    expect((await routes.quizStatus.POST(post("/api/quiz-status", { ...task, lessonNumber: 1, status: "published" }))).status).toBe(200);
    expect(await (await as(student, () => routes.student.GET(get(`/api/task-quiz/student?${query()}`)))).json()).toEqual({ items: null });
    const version = (await store.getLessonVersion(1, 1))!;
    expect(await taskLesson()).toEqual(version.lesson);
    const open = await as(null, () => routes.lesson.GET(get(`/api/lessons/1?${query()}`), ctx(1)));
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ ...JSON.parse(JSON.stringify(version.lesson)), lesson_version: 1 });
    const { legacyStatus, quiz } = await (await routes.state.GET(get(`/api/task-quiz?${query()}`))).json();
    expect(legacyStatus).toBe("published");
    expect(quiz.status).toBe("draft");
  });
});

describe("a lesson other than the published one", () => {
  it("reads as the lesson", async () => {
    await publishUploaded();
    const other = (await store.getTaskLesson(task.classId, task.assignmentId, 2))!;
    expect(other.lesson).toEqual((await store.getLessonVersion(2))!.lesson);
    expect((await as(null, () => routes.lesson.GET(get(`/api/lessons/2?${query()}`), ctx(2)))).status).toBe(200);
  });
});

describe("inside GENIUS", () => {
  const genius = { classId: "genius-class", assignmentId: "genius-task" };
  const token = (claims: Record<string, unknown> = {}) => new SignJWT({
    sub: "genius-teacher", role: "teacher", name: "GENIUS Teacher", aud: "engageagent-embed", ...genius, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...claims,
  }).setProtectedHeader({ alg: "HS256" }).setIssuer(SSO_ISSUER).sign(new TextEncoder().encode(secret));
  const bearer = async (claims?: Record<string, unknown>) => ({ authorization: `Bearer ${await token(claims)}` });

  it("serves the quiz to the task's student and the keys only to its teacher", async () => {
    fake.user = null;
    const teacherAuth = await bearer();
    expect((await pick(1, genius, teacherAuth)).status).toBe(200);
    expect((await publish(genius, teacherAuth)).status).toBe(201);
    const studentAuth = await bearer({ sub: "genius-student", role: "student", name: "Sam" });

    const own = await routes.student.GET(get(`/api/task-quiz/student?${query(genius)}`, studentAuth));
    expect(own.status).toBe(200);
    const text = await own.text();
    expectNoKeys(text);

    expect((await routes.lesson.GET(get(`/api/lessons/1?${query(genius)}`, studentAuth), ctx(1))).status).toBe(403);
    expect((await routes.lesson.GET(get(`/api/lessons/1?${query(genius)}`), ctx(1))).status).toBe(401);
    const full = await routes.lesson.GET(get(`/api/lessons/1?${query(genius)}`, teacherAuth), ctx(1));
    expect(full.status).toBe(200);
    expect((await full.text())).toContain("correct_answer");

    const elsewhere = await bearer({ assignmentId: "another-task" });
    expect((await routes.lesson.GET(get(`/api/lessons/1?${query(genius)}`, elsewhere), ctx(1))).status).toBe(403);
    expect((await routes.student.GET(get(`/api/task-quiz/student?${query(genius)}`, elsewhere))).status).toBe(403);
  });
});
