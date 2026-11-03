import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  docs: new Map<string, unknown>(),
  quiz: { lesson_number: 3, status: "published" } as { lesson_number: number; status: string } | null,
  answers: [] as { student_id: string; student_name: string; lesson_number: number; answers: Record<string, string> }[],
  role: "teacher" as "teacher" | "student",
}));
vi.mock("@/lib/workspace-access", () => ({
  guardWorkspaceRequest: vi.fn(async () => null),
  workspaceRequestUser: vi.fn(async () => ({ role: db.role, geniusId: "s1", userId: "s1" })),
}));
vi.mock("@/lib/nosql", () => ({
  getTaskDoc: vi.fn(async (_c: string, _a: string, kind: string) => db.docs.get(kind) ?? null),
  putTaskDoc: vi.fn(async (_c: string, _a: string, kind: string, data: unknown) => { if (data === null) db.docs.delete(kind); else db.docs.set(kind, data); }),
  getQuizStatus: vi.fn(async () => db.quiz),
  listStudentAnswers: vi.fn(async () => db.answers),
  getStudentAnswer: vi.fn(async (_c: string, _a: string, id: string) => db.answers.find(a => a.student_id === id) ?? null),
}));

import { DELETE as unpublish, GET as readBoard, PUT as publish } from "@/app/api/question-board/route";
import { GET as readReport } from "@/app/api/quiz-report/route";
import { POST as release } from "@/app/api/quiz-report-release/route";
import { getLesson } from "@/lib/quiz-data";

const scope = { classId: "ea-class-1", assignmentId: "ea-task-1" };
const get = (path: string, extra: Record<string, string> = {}) => new Request(`http://localhost/api/${path}?${new URLSearchParams({ ...scope, ...extra })}`);
const send = (path: string, method: string, body: Record<string, unknown> = {}) =>
  new Request(`http://localhost/api/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope, ...body }) });
const id = "a".repeat(16);
const first = getLesson(3)!.quiz_items[0];

beforeEach(() => {
  db.docs.clear();
  db.quiz = { lesson_number: 3, status: "published" };
  db.role = "teacher";
  db.answers = [{ student_id: "s1", student_name: "Jayden R.", lesson_number: 3, answers: { [first.item_id]: first.correct_answer! } }];
});

describe("Class Question Board", () => {
  it("publishes, updates and unpublishes the board", async () => {
    expect(await (await readBoard(get("question-board"))).json()).toEqual({ board: null });
    const res = await publish(send("question-board", "PUT", { questions: [{ id, text: " Does the post bend? ", theme: "Forces" }] }));
    expect(res.status).toBe(200);
    const { board } = await (await readBoard(get("question-board"))).json();
    expect(board.questions).toEqual([{ id, text: "Does the post bend?", theme: "Forces" }]);
    expect((await unpublish(send("question-board", "DELETE"))).status).toBe(200);
    expect((await (await readBoard(get("question-board"))).json()).board).toBeNull();
  });

  it("rejects an invalid board without saving it", async () => {
    const res = await publish(send("question-board", "PUT", { questions: [{ id, text: "" }] }));
    expect(res.status).toBe(400);
    expect(db.docs.has("question_board")).toBe(false);
  });
});

describe("quiz reports", () => {
  it("lists who has a report for the teacher, and lets the teacher preview before release", async () => {
    expect(await (await readReport(get("quiz-report"))).json()).toEqual({ release: null, lessonNumber: 3, students: [{ id: "s1", name: "Jayden R." }] });
    const { report } = await (await readReport(get("quiz-report", { studentId: "s1" }))).json();
    expect(report).toMatchObject({ lessonNumber: 3, correct: 1 });
  });

  it("shows a student nothing until the teacher releases reports, then their own report", async () => {
    db.role = "student";
    expect(await (await readReport(get("quiz-report", { studentId: "s1" }))).json()).toEqual({ release: null, report: null });
    expect((await readReport(get("quiz-report"))).status).toBe(403);

    db.role = "teacher";
    const res = await release(send("quiz-report-release", "POST", { reason: "taught" }));
    expect(res.status).toBe(200);
    expect((await res.json()).release).toMatchObject({ reason: "taught", lessonNumber: 3 });

    db.role = "student";
    const body = await (await readReport(get("quiz-report", { studentId: "s1" }))).json();
    expect(body.release.reason).toBe("taught");
    expect(body.report.items[0]).toMatchObject({ isCorrect: true });
  });

  it("gives no report for answers to a different lesson", async () => {
    db.answers[0].lesson_number = 5;
    expect((await (await readReport(get("quiz-report", { studentId: "s1" }))).json()).report).toBeNull();
    expect((await (await readReport(get("quiz-report"))).json()).students).toEqual([]);
  });

  it("holds a new lesson's reports until that lesson is released, while keeping teacher previews available", async () => {
    expect((await release(send("quiz-report-release", "POST", { reason: "taught" }))).status).toBe(200);
    db.quiz = { lesson_number: 4, status: "published" };
    const nextQuestion = getLesson(4)!.quiz_items[0];
    db.answers = [{ student_id: "s1", student_name: "Jayden R.", lesson_number: 4,
      answers: { [nextQuestion.item_id]: nextQuestion.correct_answer! } }];

    expect(await (await readReport(get("quiz-report"))).json()).toEqual({
      release: null, lessonNumber: 4, students: [{ id: "s1", name: "Jayden R." }],
    });
    const preview = await (await readReport(get("quiz-report", { studentId: "s1" }))).json();
    expect(preview.release).toBeNull();
    expect(preview.report).toMatchObject({ lessonNumber: 4, correct: 1 });

    db.role = "student";
    expect(await (await readReport(get("quiz-report", { studentId: "s1" }))).json()).toEqual({ release: null, report: null });

    db.role = "teacher";
    const released = await release(send("quiz-report-release", "POST", { reason: "early" }));
    expect(released.status).toBe(200);
    expect((await released.json()).release).toMatchObject({ reason: "early", lessonNumber: 4 });
    expect((await (await readReport(get("quiz-report"))).json()).release).toMatchObject({ lessonNumber: 4 });
    db.role = "student";
    expect(await (await readReport(get("quiz-report", { studentId: "s1" }))).json()).toMatchObject({
      release: { reason: "early", lessonNumber: 4 }, report: { lessonNumber: 4, correct: 1 },
    });
  });

  it("does not expose a saved release while the quiz is a draft", async () => {
    await release(send("quiz-report-release", "POST", { reason: "taught" }));
    db.quiz!.status = "draft";
    expect((await (await readReport(get("quiz-report"))).json()).release).toBeNull();
    db.role = "student";
    expect(await (await readReport(get("quiz-report", { studentId: "s1" }))).json()).toEqual({ release: null, report: null });
  });

  it("releases only with a known reason and a published quiz", async () => {
    expect((await release(send("quiz-report-release", "POST", { reason: "whenever" }))).status).toBe(400);
    db.quiz = { lesson_number: 3, status: "draft" };
    expect((await release(send("quiz-report-release", "POST", { reason: "early" }))).status).toBe(409);
    db.quiz = null;
    expect((await release(send("quiz-report-release", "POST", { reason: "early" }))).status).toBe(409);
    expect(db.docs.has("report_release")).toBe(false);
  });
});
