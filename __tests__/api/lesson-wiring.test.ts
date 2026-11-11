import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { SSO_ISSUER } from "@/lib/auth";
import { emptyDraftQuizItem, type LessonDraftContent } from "@/lib/lessons";
import { MisconceptionId } from "@/lib/misconceptions";
import { getAllLessons } from "@/lib/quiz-data";
import { conflictActivity } from "../fixtures/material-activities";
import { slideFixture, tinyImage } from "../fixtures/slides";

// Stored lessons through the whole app (#175): the real routes, access checks
// and local storage. Only the signed-in user and the AI provider are faked.
const fake = vi.hoisted(() => ({ user: null as unknown, chat: vi.fn(), image: vi.fn(), responses: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/session", async original => ({
  ...await original<typeof import("@/lib/session")>(),
  sessionUser: vi.fn(async () => fake.user),
}));
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: fake.chat } };
    images = { generate: fake.image, edit: fake.image };
    responses = { create: fake.responses, retrieve: vi.fn(), cancel: vi.fn() };
  }
  return { default: OpenAI, toFile: vi.fn(async () => "image"), APIConnectionTimeoutError: class extends Error {} };
});
vi.mock("@/lib/cohort-analysis-queue", () => ({
  enqueueCohortJobStudents: fake.enqueue,
  isCohortAnalysisQueueConfigured: () => true,
  getCohortAnalysisQueueConfigIssues: () => [],
}));

const origin = "http://localhost:3199";
const secret = "lesson-wiring-test-secret-not-a-real-credential";
const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Ana", email: null, role: "teacher" };
const student: UserContext = { ...teacher, geniusId: "student-1", userId: "student-1", name: "Sam", role: "student" };
const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce, MC2 = MisconceptionId.HeavierAlwaysCausesMoreDamage;

const nine = (changes: Partial<LessonDraftContent> = {}): LessonDraftContent => ({
  title: "Waves", objective: "OBJ-NINE", topic: "TOPIC-NINE", targetConcept: "TARGET-NINE",
  coreIdeas: ["IDEA-NINE-A", "IDEA-NINE-B"], misconceptions: [MC1, MC2],
  quizItems: ["n1", "n2", "n3", "n4"].map((id) => ({
    ...emptyDraftQuizItem(id), stem: `STEM-NINE-${id}`, options: { A: `${id} right`, B: `${id} two ideas`, C: `${id} one idea`, D: `${id} none` },
    correct: "A" as const, matchedMisconception: MC1, explanation: `why ${id}`,
    wrongOptionMisconceptions: { B: [MC1, MC2], C: [MC2] },
  })),
  ...changes,
});

type Task = { classId: string; assignmentId: string };
type Read = { status: number; text: string };

let dir: string;
let routes: Awaited<ReturnType<typeof loadRoutes>>;
let store: typeof import("@/lib/lessons-store");
let workspace: typeof import("@/lib/workspace");
let workspaceStore: typeof import("@/lib/workspace-store");
let joinCode: string;
let classId: string;

const loadRoutes = async () => ({
  lessons: await import("@/app/api/lessons/route"),
  lesson: await import("@/app/api/lessons/[lessonNumber]/route"),
  quizStatus: await import("@/app/api/quiz-status/route"),
  answers: await import("@/app/api/student-answers/route"),
  report: await import("@/app/api/quiz-report/route"),
  release: await import("@/app/api/quiz-report-release/route"),
  questions: await import("@/app/api/question-analysis/route"),
  slides: await import("@/app/api/slides/route"),
  slidesCheck: await import("@/app/api/slides/check/route"),
  slidesImage: await import("@/app/api/slides/image/route"),
  publication: await import("@/app/api/slides/publication/route"),
  gallery: await import("@/app/api/material-gallery/route"),
  content: await import("@/app/api/engagement-content/route"),
  image: await import("@/app/api/engagement-image/route"),
  single: await import("@/app/api/strategy-single/route"),
  batch: await import("@/app/api/strategy-batch/route"),
  job: await import("@/app/api/strategy-job/route"),
  annotation: await import("@/app/api/teacher-annotation/route"),
});

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`${origin}${url}`, {
  method: "POST", headers: { origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
const get = (url: string, headers: Record<string, string> = {}) => new Request(`${origin}${url}`, { headers });
const query = (task: Task, extra: Record<string, string> = {}) => new URLSearchParams({ ...task, ...extra }).toString();
const ctx = (n: number) => ({ params: Promise.resolve({ lessonNumber: String(n) }) });
const readText = async (response: Response): Promise<Read> => ({ status: response.status, text: await response.text() });
const as = <T,>(user: UserContext, work: () => Promise<T>) => { fake.user = user; return work().finally(() => { fake.user = teacher; }); };

const planReply = { choices: [{ message: { content: JSON.stringify({ name: "x", strategy: "analogy", relevance: {}, overallRecommendation: "x", recommendationReason: "x", summary: "x", tldr: "x", rationale: "x", tactics: [], cadence: "x", checks: [] }) } }] };

async function newTask(title = "Task"): Promise<Task> {
  const { id } = await workspace.createWorkspaceAssignment(teacher, classId, title);
  return { classId, assignmentId: id };
}

/** Saving the quiz is what ties a task to a version. */
const saveQuiz = (task: Task, lessonNumber: number, status = "published", headers: Record<string, string> = {}) =>
  routes.quizStatus.POST(post("/api/quiz-status", { ...task, lessonNumber, status }, headers));

async function publishNine(content = nine(), note = "First version") {
  const { row } = await store.createLesson(teacher);
  await store.saveLessonDraft(teacher, row.lessonNumber, content);
  await store.publishLessonDraft(teacher, row.lessonNumber, note);
  return row.lessonNumber;
}

/** Version 2 of lesson 1: its objective, first question and core ideas all change. */
async function publishLessonOneV2() {
  const draft = await store.startLessonEdit(teacher, 1);
  await store.saveLessonDraft(teacher, 1, {
    ...draft.content, objective: "OBJ-ONE-V2", topic: "TOPIC-ONE-V2", targetConcept: "TARGET-ONE-V2",
    coreIdeas: ["IDEA-ONE-V2-A", "IDEA-ONE-V2-B", "IDEA-ONE-V2-C", "IDEA-ONE-V2-D", "IDEA-ONE-V2-E", "IDEA-ONE-V2-F"],
    quizItems: draft.content.quizItems.map((item, index) => ({ ...item, stem: index === 0 ? "STEM-ONE-V2" : item.stem, explanation: item.explanation || "why" })),
  });
  await store.publishLessonDraft(teacher, 1, "Second version");
}

const V2_MARKS = ["OBJ-ONE-V2", "STEM-ONE-V2", "IDEA-ONE-V2-A"];
const LESSON_ONE = getAllLessons()[0];
const V1_MARKS = [LESSON_ONE.learning_objective, LESSON_ONE.quiz_items[0].stem, LESSON_ONE.core_ideas[0]];
const NINE_MARKS = ["OBJ-NINE", "STEM-NINE-n1", "IDEA-NINE-A", "TOPIC-NINE"];
const mentions = (text: string, marks: string[]) => marks.some((mark) => text.includes(JSON.stringify(mark).slice(1, -1)) || text.includes(mark));

const lastCall = (mock: { mock: { calls: unknown[][] } }) => JSON.stringify(mock.mock.calls.at(-1) ?? []);

/** Each way the app reads a lesson on the server, and what that read produced or sent to the AI. */
const READS: Record<string, (task: Task, lessonNumber: number) => Promise<Read>> = {
  "GET /api/lessons/[n]": async (task, n) => readText(await routes.lesson.GET(get(`/api/lessons/${n}?${query(task)}`), ctx(n))),
  "GET /api/lessons (picker)": async (task, n) => {
    const response = await routes.lessons.GET(get(`/api/lessons?${query(task)}`));
    const { lessons } = await response.json();
    return { status: response.status, text: JSON.stringify(lessons.find((row: { lessonNumber: number }) => row.lessonNumber === n) ?? null) };
  },
  "GET /api/quiz-report": async (task, n) => {
    const answers = { [(await store.getTaskLesson(task.classId, task.assignmentId, n))!.lesson.quiz_items[0].item_id]: "A" };
    await as(student, () => routes.answers.POST(post("/api/student-answers", { ...task, studentId: student.geniusId, studentName: student.name, lessonNumber: n, answers })));
    return readText(await routes.report.GET(get(`/api/quiz-report?${query(task, { studentId: student.geniusId })}`)));
  },
  "GET /api/question-analysis": async (task) => {
    const { upsertReviewQuestions } = await import("@/lib/nosql");
    await upsertReviewQuestions({ class_id: task.classId, assignment_id: task.assignmentId, student_id: student.geniusId, questions: ["Why does it bend?"], submitted_at: new Date().toISOString() });
    fake.chat.mockResolvedValueOnce({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ themes: ["Seeing"], questions: [{ index: 0, theme: 0, tag: "Investigable", suggested: true }] }) } }] });
    const response = await routes.questions.GET(get(`/api/question-analysis?${query(task)}`));
    return { status: response.status, text: lastCall(fake.chat) };
  },
  "POST /api/slides": async (task, n) => {
    const response = await routes.slides.POST(post("/api/slides", { ...task, lessonNumber: n, strategy: "cognitive conflict" }));
    return { status: response.status === 202 ? 200 : response.status, text: lastCall(fake.responses) };
  },
  "POST /api/slides/check": async (task, n) => {
    const response = await routes.slidesCheck.POST(post("/api/slides/check", { ...task, lessonNumber: n, strategy: "cognitive conflict", draft: slideFixture("cognitive conflict") }));
    return { status: response.status === 202 ? 200 : response.status, text: lastCall(fake.responses) };
  },
  "POST /api/engagement-content": async (task, n) => {
    fake.chat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ items: [{ title: "Watch", activity: conflictActivity }] }) } }] });
    const response = await routes.content.POST(post("/api/engagement-content", { ...task, lessonNumber: n, selectedStrategies: ["cognitive conflict"] }));
    return { status: response.status, text: JSON.stringify(fake.chat.mock.calls[0] ?? []) };
  },
  "POST /api/engagement-image": async (task, n) => {
    const response = await routes.image.POST(post("/api/engagement-image", { ...task, lessonNumber: n, item: { type: "x", strategy: "analogy", title: "t", body: "b" } }));
    return { status: response.status, text: lastCall(fake.image) };
  },
  "POST /api/strategy-single": async (task, n) => {
    fake.chat.mockResolvedValue(planReply);
    const response = await routes.single.POST(post("/api/strategy-single", { ...task, lessonNumber: n, student: { id: `one-${task.assignmentId}`, name: "Sam", answers: {} } }));
    return { status: response.status, text: lastCall(fake.chat) };
  },
  "POST /api/strategy-batch": async (task, n) => {
    fake.chat.mockResolvedValue(planReply);
    const response = await routes.batch.POST(post("/api/strategy-batch", { ...task, lessonNumber: n, students: [{ id: `many-${task.assignmentId}`, name: "Sam", answers: {} }] }));
    return { status: response.status, text: lastCall(fake.chat) };
  },
  "POST /api/strategy-job": async (task, n) => {
    const response = await routes.job.POST(post("/api/strategy-job", { ...task, lessonNumber: n, students: [{ id: "s", name: "Sam", answers: {} }] }));
    return { status: response.status === 201 ? 200 : response.status, text: lastCall(fake.enqueue) };
  },
  "POST /api/teacher-annotation": async (task, n) => {
    const response = await routes.annotation.POST(post("/api/teacher-annotation", {
      ...task, overallRecommendation: "x", decision: "agree", lessonNumber: n, selectedStrategies: ["analogy"], focus: { coreIdeas: [0] },
    }));
    return readText(response);
  },
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-lesson-wiring-"));
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
  workspace = await import("@/lib/workspace");
  workspaceStore = await import("@/lib/workspace-store");
  fake.user = teacher;
  fake.chat.mockReset();
  fake.image.mockReset().mockResolvedValue({ data: [{ b64_json: "dGVzdA==" }] });
  fake.responses.mockReset().mockResolvedValue({ id: "provider-response" });
  fake.enqueue.mockReset().mockResolvedValue(undefined);
  const classroom = await workspace.createWorkspaceClass(teacher, "Physics");
  classId = classroom.id;
  joinCode = classroom.joinCode;
  await as(student, () => workspace.joinWorkspaceClass(student, joinCode));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

describe("a brand-new lesson 9 works through the whole flow", () => {
  it.each(Object.keys(READS))("%s", async (name) => {
    const n = await publishNine();
    expect(n).toBe(9);
    const task = await newTask();
    expect((await saveQuiz(task, 9)).status).toBe(200);
    const { status, text } = await READS[name](task, 9);
    expect(status).toBe(200);
    expect(mentions(text, NINE_MARKS)).toBe(true);
    expect(text).not.toContain("undefined");
  });

  it("lets a student take the quiz and see their report, counted against the lesson", async () => {
    await publishNine();
    const task = await newTask();
    await saveQuiz(task, 9);
    const answers = { n1: "A", n1_confidence: "B", n2: "B", n3: "C", n4: "D" };
    await as(student, async () => {
      const quiz = await (await routes.lesson.GET(get(`/api/lessons/9?${query(task)}`), ctx(9))).json();
      expect(quiz.quiz_items).toHaveLength(8);
      expect((await routes.answers.POST(post("/api/student-answers", { ...task, studentId: student.geniusId, studentName: student.name, lessonNumber: 9, answers }))).status).toBeLessThan(300);
      expect(await (await routes.report.GET(get(`/api/quiz-report?${query(task, { studentId: student.geniusId })}`))).json()).toEqual({ release: null, report: null });
    });
    await routes.release.POST(post("/api/quiz-report-release", { ...task, reason: "early" }));
    const { report } = await as(student, async () => (await routes.report.GET(get(`/api/quiz-report?${query(task, { studentId: student.geniusId })}`))).json());
    expect(report).toMatchObject({ lessonNumber: 9, lessonTitle: "Waves", correct: 1, total: 4 });
    expect(report.items[0]).toMatchObject({ stem: "STEM-NINE-n1", confidence: "Somewhat confident", explanation: "why n1" });
  });

  it("generates slide images and publishes slides under the lesson's own topic", async () => {
    await publishNine();
    const task = await newTask();
    await saveQuiz(task, 9);
    const draft = slideFixture("cognitive conflict");
    const image = await routes.slidesImage.POST(post("/api/slides/image", { ...task, lessonNumber: 9, strategy: "cognitive conflict", draft, visualId: "evidence" }));
    expect(image.status).toBe(202);
    const started = await routes.publication.POST(post("/api/slides/publication", { ...task, operation: "start", deckId: "deck-9", lessonNumber: 9, strategy: "cognitive conflict", draft, assets: { evidence: { width: 1, height: 1 } } }));
    expect(started.status).toBe(200);
    const { publicationId } = await started.json();
    const stored = await workspaceStore.workspaceGet<{ manifest: { lessonNumber: number; pages: unknown[] } }>(`WORKSPACE#${task.classId}`, `SLIDE_PUBLICATION#${publicationId}`);
    expect(stored?.manifest.lessonNumber).toBe(9);
    expect(JSON.stringify(stored?.manifest)).toContain("Today we investigate: TOPIC-NINE");
    const asset = await routes.publication.POST(post("/api/slides/publication", { ...task, operation: "asset", publicationId, visualId: "evidence", asset: { data: tinyImage, width: 1, height: 1 } }));
    expect(asset.status).toBe(200);
    const committed = await routes.publication.POST(post("/api/slides/publication", { ...task, operation: "commit", publicationId }));
    expect(committed.status).toBe(200);
    expect(await committed.json()).toMatchObject({ slides: { lessonNumber: 9, publicationId } });
    const read = await as(student, () => routes.publication.GET(get(`/api/slides/publication?${query(task, { publicationId })}`)));
    expect(read.status).toBe(200);
  });

  it("shares, filters and validates Gallery materials for the lesson", async () => {
    await publishNine();
    const task = await newTask();
    const draft = slideFixture("cognitive conflict");
    const metadata = { title: "Waves on a string", description: "d", gradeBand: "6-8", experienceContext: "c", sharingConfirmed: true, focus: { misconceptions: [MC1], coreIdeas: [] } };
    const body = { ...task, action: "start-share", lessonNumber: 9, strategy: "cognitive conflict", draft, assets: { evidence: { width: 1, height: 1, digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }, metadata };
    const shared = await routes.gallery.POST(post("/api/material-gallery", body));
    expect(shared.status).toBe(200);
    const unknownFocus = await routes.gallery.POST(post("/api/material-gallery", { ...body, metadata: { ...metadata, focus: { misconceptions: ["MC30"], coreIdeas: [] } } }));
    expect(unknownFocus.status).toBe(422);
    expect((await routes.gallery.GET(get(`/api/material-gallery?${query(task, { lessonNumber: "9" })}`))).status).toBe(200);
    // The cross-task Gallery may contain lessons absent from this task. An
    // unmatched lesson is an empty filter, not an invalid generation request.
    const empty = await routes.gallery.GET(get(`/api/material-gallery?${query(task, { lessonNumber: "10" })}`));
    expect(empty.status).toBe(200); expect((await empty.json()).items).toEqual([]);
    const video = await routes.gallery.POST(post("/api/material-gallery", { ...task, action: "share-video", lessonNumber: 10, item: { id: "v", title: "t", body: "b", strategy: "analogy" }, metadata }));
    expect(video.status).toBe(422);
    expect((await video.json()).error).toBe("Choose a valid lesson.");
  });
});

describe("a lesson with only a draft", () => {
  beforeEach(async () => {
    const { row } = await store.createLesson(teacher);
    await store.saveLessonDraft(teacher, row.lessonNumber, nine());
  });

  it("isn't in the picker and can't be read", async () => {
    const task = await newTask();
    const { lessons } = await (await routes.lessons.GET(get(`/api/lessons?${query(task)}`))).json();
    expect(lessons.map((row: { lessonNumber: number }) => row.lessonNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await routes.lesson.GET(get(`/api/lessons/9?${query(task)}`), ctx(9))).status).toBe(404);
    expect((await routes.lesson.GET(get("/api/lessons/9"), ctx(9))).status).toBe(404);
  });

  it("can't be published as a task's quiz, and generation refuses it", async () => {
    const task = await newTask();
    const refused = await saveQuiz(task, 9);
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toContain("no published version");
    expect((await routes.content.POST(post("/api/engagement-content", { ...task, lessonNumber: 9, selectedStrategies: ["cognitive conflict"] }))).status).toBe(400);
    expect((await routes.slides.POST(post("/api/slides", { ...task, lessonNumber: 9, strategy: "cognitive conflict" }))).status).toBe(404);
    expect(fake.chat).not.toHaveBeenCalled();
    expect(fake.responses).not.toHaveBeenCalled();
  });

  it("appears in the picker with its title and question count once published", async () => {
    await store.publishLessonDraft(teacher, 9, "First version");
    const { lessons } = await (await routes.lessons.GET(get(`/api/lessons?${query(await newTask())}`))).json();
    expect(lessons.at(-1)).toMatchObject({ lessonNumber: 9, title: "Waves", version: 1, questionCount: 4, learningObjective: "OBJ-NINE" });
  });
});

describe("a task keeps the version it was pinned to", () => {
  let oldTask: Task, newerTask: Task;
  beforeEach(async () => {
    oldTask = await newTask("Old");
    expect((await saveQuiz(oldTask, 1)).status).toBe(200);
    await publishLessonOneV2();
    newerTask = await newTask("New");
    expect((await saveQuiz(newerTask, 1)).status).toBe(200);
  });

  it.each(Object.keys(READS))("%s", async (name) => {
    const old = await READS[name](oldTask, 1);
    expect(old.status).toBe(200);
    expect(mentions(old.text, V1_MARKS)).toBe(true);
    expect(mentions(old.text, V2_MARKS)).toBe(false);
    fake.chat.mockClear();
    const newer = await READS[name](newerTask, 1);
    expect(newer.status).toBe(200);
    expect(mentions(newer.text, V2_MARKS)).toBe(true);
    expect(mentions(newer.text, V1_MARKS)).toBe(false);
  });

  it("checks a Gallery focus against the task's own version", async () => {
    // Core idea 5 only exists in version 2.
    const metadata = { title: "t", description: "d", gradeBand: "6-8", experienceContext: "c", sharingConfirmed: true, focus: { misconceptions: [], coreIdeas: [5] } };
    const share = (task: Task) => routes.gallery.POST(post("/api/material-gallery", {
      ...task, action: "start-share", lessonNumber: 1, strategy: "analogy", draft: slideFixture("analogy"),
      assets: Object.fromEntries(slideFixture("analogy").visuals.map((visual) => [visual.id, { width: 1, height: 1, digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }])), metadata,
    }));
    expect((await share(oldTask)).status).toBe(422);
    expect((await share(newerTask)).status).toBe(200);
  });

  it("shows the pinned version's title and count in the picker, and doesn't change the current version", async () => {
    const row = async (task: Task) => (await (await routes.lessons.GET(get(`/api/lessons?${query(task)}`))).json()).lessons[0];
    expect(await row(oldTask)).toMatchObject({ lessonNumber: 1, version: 1, currentVersion: 2, learningObjective: LESSON_ONE.learning_objective });
    expect(await row(newerTask)).toMatchObject({ lessonNumber: 1, version: 2, currentVersion: 2, learningObjective: "OBJ-ONE-V2" });
    expect((await store.getCurrentLesson(1))?.learning_objective).toBe("OBJ-ONE-V2");
  });

  it("only applies the pin to the lesson it's pinned to", async () => {
    const other = await (await routes.lesson.GET(get(`/api/lessons/2?${query(oldTask)}`), ctx(2))).json();
    expect(other).toMatchObject({ lesson_number: 2, lesson_version: 1 });
    const explicit = await (await routes.lesson.GET(get(`/api/lessons/1?${query(oldTask, { version: "2" })}`), ctx(1))).json();
    expect(explicit.lesson_version).toBe(2);
    const noTask = await (await routes.lesson.GET(get("/api/lessons/1"), ctx(1))).json();
    expect(noTask.lesson_version).toBe(2);
  });

  it("reads the current version of a lesson the task isn't pinned to", async () => {
    const draft = await store.startLessonEdit(teacher, 2);
    await store.saveLessonDraft(teacher, 2, { ...draft.content, topic: "t", targetConcept: "c", quizItems: draft.content.quizItems.map((item) => ({ ...item, explanation: item.explanation || "why" })) });
    await store.publishLessonDraft(teacher, 2, "Second version");
    const other = await (await routes.lesson.GET(get(`/api/lessons/2?${query(oldTask)}`), ctx(2))).json();
    expect(other.lesson_version).toBe(2);
  });

  it("keeps the response the same shape it has always had", async () => {
    const lesson = await (await routes.lesson.GET(get(`/api/lessons/1?${query(oldTask)}`), ctx(1))).json();
    expect(lesson).toEqual({ ...JSON.parse(JSON.stringify(LESSON_ONE)), lesson_version: 1 });
  });

  it("refuses half a task in the address", async () => {
    expect((await routes.lesson.GET(get(`/api/lessons/1?classId=${oldTask.classId}`), ctx(1))).status).toBe(400);
    expect((await routes.lesson.GET(get(`/api/lessons/1?assignmentId=${oldTask.assignmentId}`), ctx(1))).status).toBe(400);
    expect((await routes.lesson.GET(get(`/api/lessons/1?classId=${"c".repeat(161)}&assignmentId=a`), ctx(1))).status).toBe(400);
  });
});

describe("two requests at once", () => {
  it("don't see each other's pinned version, however they interleave", async () => {
    const oldTask = await newTask("Old");
    await saveQuiz(oldTask, 1);
    await publishLessonOneV2();
    const newerTask = await newTask("New");
    await saveQuiz(newerTask, 1);
    // A slow provider, so every prompt is built while the other requests are mid-flight.
    fake.chat.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { choices: [{ message: { content: JSON.stringify({ items: [{ title: "Watch", activity: conflictActivity }] }) } }] };
    });
    const requests = Array.from({ length: 12 }, (_, index) => {
      const [task, label] = index % 2 ? [oldTask, `OLD${index}`] : [newerTask, `NEW${index}`];
      return Promise.all([
        routes.content.POST(post("/api/engagement-content", { ...task, lessonNumber: 1, selectedStrategies: ["cognitive conflict"], classroomContext: label })),
        routes.slides.POST(post("/api/slides", { ...task, lessonNumber: 1, strategy: "cognitive conflict", classroomContext: label })),
      ]);
    });
    for (const [content, slides] of await Promise.all(requests)) {
      expect(content.status).toBe(200);
      expect(slides.status).toBe(202);
    }
    const prompts = [...fake.chat.mock.calls, ...fake.responses.mock.calls].map((call) => JSON.stringify(call[0]));
    expect(prompts.filter((prompt) => prompt.includes("NEW")).length).toBeGreaterThanOrEqual(12);
    expect(prompts.filter((prompt) => prompt.includes("OLD")).length).toBeGreaterThanOrEqual(12);
    for (const prompt of prompts) {
      if (/OLD\d/.test(prompt)) {
        expect(prompt).toContain(LESSON_ONE.learning_objective);
        expect(prompt).not.toContain("OBJ-ONE-V2");
      } else if (/NEW\d/.test(prompt)) {
        expect(prompt).toContain("OBJ-ONE-V2");
        expect(prompt).not.toContain(LESSON_ONE.learning_objective);
      }
    }
  });
});

describe("a task from before pins existed", () => {
  it("reads the current version, then gets pinned the next time its quiz is saved", async () => {
    const task = await newTask();
    const { upsertQuizStatus } = await import("@/lib/nosql");
    await upsertQuizStatus(task.classId, task.assignmentId, 1, "published");
    expect(await store.getTaskLessonPin(task.classId, task.assignmentId)).toBeNull();
    const version = async () => (await (await routes.lesson.GET(get(`/api/lessons/1?${query(task)}`), ctx(1))).json()).lesson_version;
    expect(await version()).toBe(1);
    await publishLessonOneV2();
    expect(await version()).toBe(2);
    expect((await saveQuiz(task, 1)).status).toBe(200);
    expect(await store.getTaskLessonPin(task.classId, task.assignmentId)).toMatchObject({ lessonNumber: 1, version: 2 });
    const draft = await store.startLessonEdit(teacher, 1);
    await store.saveLessonDraft(teacher, 1, { ...draft.content, objective: "OBJ-ONE-V3" });
    await store.publishLessonDraft(teacher, 1, "Third version");
    expect(await version()).toBe(2);
  });
});

describe("when a stored lesson can't be loaded", () => {
  it("fails clearly and never asks the AI with the lesson file instead", async () => {
    const task = await newTask();
    await saveQuiz(task, 1);
    await publishLessonOneV2();
    await writeFile(path.join(dir, "workspace.json"), "not json");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await routes.lesson.GET(get(`/api/lessons/1?${query(task)}`), ctx(1))).status).toBe(503);
    expect((await routes.slides.POST(post("/api/slides", { ...task, lessonNumber: 1, strategy: "cognitive conflict" }))).status).toBeGreaterThanOrEqual(400);
    expect((await routes.single.POST(post("/api/strategy-single", { ...task, lessonNumber: 1, student: { id: "s", name: "Sam", answers: {} } }))).status).toBeGreaterThanOrEqual(400);
    expect(fake.responses).not.toHaveBeenCalled();
    expect(fake.chat).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("gives not found for a pinned version that's gone, rather than another version", async () => {
    const task = await newTask();
    await saveQuiz(task, 1);
    await publishLessonOneV2();
    await workspaceStore.workspacePut([{ partition: "WORKSPACE_LESSON#ea-lesson-1", key: "VERSION#000001", remove: true }]);
    expect((await routes.lesson.GET(get(`/api/lessons/1?${query(task)}`), ctx(1))).status).toBe(404);
    expect((await routes.content.POST(post("/api/engagement-content", { ...task, lessonNumber: 1, selectedStrategies: ["cognitive conflict"] }))).status).toBe(400);
    expect(fake.chat).not.toHaveBeenCalled();
    const list = await routes.lessons.GET(get(`/api/lessons?${query(task)}`));
    expect(list.status).toBe(503);
  });
});

describe("inside GENIUS", () => {
  const scope = { classId: "genius-class", assignmentId: "genius-task" };
  const token = (claims: Record<string, unknown> = {}) => new SignJWT({
    sub: "genius-teacher", role: "teacher", name: "GENIUS Teacher", aud: "engageagent-embed", ...scope, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims,
  }).setProtectedHeader({ alg: "HS256" }).setIssuer(SSO_ISSUER).sign(new TextEncoder().encode(secret));
  const bearer = async (claims?: Record<string, unknown>) => ({ authorization: `Bearer ${await token(claims)}` });

  it("lists lessons for the teacher's own task only", async () => {
    await publishNine();
    fake.user = null;
    const listed = await routes.lessons.GET(get(`/api/lessons?${query(scope)}`, await bearer()));
    expect(listed.status).toBe(200);
    expect((await listed.json()).lessons.at(-1)).toMatchObject({ lessonNumber: 9, questionCount: 4 });
    expect((await routes.lessons.GET(get(`/api/lessons?${query(scope)}`, await bearer({ sub: "s", role: "student" })))).status).toBe(403);
    expect((await routes.lessons.GET(get(`/api/lessons?${query({ ...scope, assignmentId: "another-task" })}`, await bearer()))).status).toBe(403);
    expect((await routes.lessons.GET(get(`/api/lessons?${query(scope)}`))).status).toBe(401);
  });

  it("gives a student the task's pinned quiz with no sign-in header, as the quiz page does today", async () => {
    const headers = await bearer();
    fake.user = null;
    await saveQuiz(scope, 1, "published", headers);
    fake.user = teacher;
    await publishLessonOneV2();
    fake.user = null;
    const quiz = await (await routes.lesson.GET(get(`/api/lessons/1?${query(scope)}`), ctx(1))).json();
    expect(quiz.lesson_version).toBe(1);
    expect(quiz.quiz_items[0].stem).toBe(LESSON_ONE.quiz_items[0].stem);
  });
});

describe("students don't gain anything", () => {
  it("still can't reach the teacher routes that now read stored lessons", async () => {
    const task = await newTask();
    await saveQuiz(task, 1);
    fake.user = student;
    expect((await routes.lessons.GET(get(`/api/lessons?${query(task)}`))).status).toBe(403);
    expect((await routes.content.POST(post("/api/engagement-content", { ...task, lessonNumber: 1, selectedStrategies: ["analogy"] }))).status).toBe(403);
    expect((await routes.slides.POST(post("/api/slides", { ...task, lessonNumber: 1, strategy: "analogy" }))).status).toBe(403);
    expect((await routes.slides.GET(get(`/api/slides?${query(task)}`))).status).toBe(403);
    expect((await routes.annotation.POST(post("/api/teacher-annotation", { ...task, overallRecommendation: "x", decision: "agree" }))).status).toBe(403);
    expect((await routes.quizStatus.POST(post("/api/quiz-status", { ...task, lessonNumber: 1, status: "published" }))).status).toBe(403);
    expect(fake.chat).not.toHaveBeenCalled();
    fake.user = null;
    expect((await routes.lessons.GET(get(`/api/lessons?${query(task)}`))).status).toBe(401);
  });

  it("gives the slide catalog the task's lessons, without any answers", async () => {
    await publishNine();
    const task = await newTask();
    const response = await routes.slides.GET(get(`/api/slides?${query(task)}`));
    expect(response.status).toBe(200);
    const { lessons } = await response.json();
    expect(lessons.at(-1)).toEqual({ lessonNumber: 9, lessonTitle: "Waves", learningObjective: "OBJ-NINE" });
    expect(JSON.stringify(lessons)).not.toMatch(/correct_answer|quiz_items|misconceptions/u);
  });
});
