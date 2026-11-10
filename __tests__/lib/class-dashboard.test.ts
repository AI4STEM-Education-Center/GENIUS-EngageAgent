import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLesson } from "@/lib/quiz-data";
import { questionId } from "@/lib/class-questions";

const db = vi.hoisted(() => ({
  tasks: [] as { id: string; title: string; createdAt: string }[],
  quiz: new Map<string, { lesson_number: number; status: string }>(),
  answers: new Map<string, { student_id: string; student_name: string; lesson_number: number; answers: Record<string, string>; submitted_at: string }[]>(),
  reviews: new Map<string, { student_id: string; questions: string[]; submitted_at: string }[]>(),
  docs: new Map<string, unknown>(),
}));
vi.mock("@/lib/workspace", async original => ({
  ...await original<typeof import("@/lib/workspace")>(),
  workspaceClassDetail: vi.fn(async () => ({ classroom: { id: "ea-class-1", name: "Physics" }, assignments: db.tasks, members: [] })),
}));
vi.mock("@/lib/nosql", () => ({
  getQuizStatus: vi.fn(async (_c: string, a: string) => db.quiz.get(a) ?? null),
  listStudentAnswers: vi.fn(async (_c: string, a: string) => db.answers.get(a) ?? []),
  listReviewQuestions: vi.fn(async (_c: string, a: string) => db.reviews.get(a) ?? []),
  getTaskDoc: vi.fn(async (_c: string, a: string, kind: string) => db.docs.get(`${a}:${kind}`) ?? null),
  putTaskDoc: vi.fn(async (_c: string, a: string, kind: string, data: unknown) => { db.docs.set(`${a}:${kind}`, data); }),
}));
vi.mock("@/lib/lessons-store", () => ({
  getTaskLesson: vi.fn(async (_c: string, _a: string, n: number) => ({ lesson: getLesson(n) })),
}));

import { addQuestionToBoard, getClassDashboard } from "@/lib/class-dashboard";

const teacher = { geniusId: "t1", userId: "t1", name: "T", email: null, role: "teacher" as const };
const lesson = getLesson(3)!;
// An item with a wrong option linked to a misconception, so the counts have something to show.
const item = lesson.quiz_items.find(q => Object.keys(q.distractor_misconception_map ?? {}).length > 0)!;
const [wrong, code] = Object.entries(item.distractor_misconception_map!)[0] as [string, string];

beforeEach(() => {
  db.tasks = [{ id: "ea-task-1", title: "Deformation", createdAt: "2026-11-01" }, { id: "ea-task-2", title: "Forces", createdAt: "2026-11-02" }];
  db.quiz = new Map([["ea-task-1", { lesson_number: 3, status: "published" }]]);
  db.answers = new Map([["ea-task-1", [
    { student_id: "s1", student_name: "Jayden R.", lesson_number: 3, answers: { [item.item_id]: wrong }, submitted_at: "2026-11-03T10:00:00Z" },
    { student_id: "s2", student_name: "Ava J.", lesson_number: 3, answers: { [item.item_id]: item.correct_answer! }, submitted_at: "2026-11-04T10:00:00Z" },
  ]]]);
  db.reviews = new Map([["ea-task-1", [{ student_id: "s1", questions: ["Does the post bend?", " "], submitted_at: "2026-11-05T09:00:00Z" }]]]);
  db.docs = new Map();
});

describe("class dashboard (#207)", () => {
  it("counts each misconception against the quiz's wrong answers, with when it was taken", async () => {
    const { misconceptions, tasks } = await getClassDashboard(teacher, "ea-class-1");
    const row = misconceptions.find(m => m.code === code)!;
    expect(row).toMatchObject({ assignmentId: "ea-task-1", lessonNumber: 3, text: lesson.misconceptions[code], count: 1, takenAt: "2026-11-04T10:00:00Z" });
    expect(row.incorrect).toBeGreaterThanOrEqual(1);
    expect(misconceptions.every(m => m.count > 0)).toBe(true);
    expect(tasks).toEqual([
      { assignmentId: "ea-task-1", title: "Deformation", lessonNumber: 3, boardPublished: false },
      { assignmentId: "ea-task-2", title: "Forces", lessonNumber: null, boardPublished: false },
    ]);
  });

  it("leaves out draft quizzes and answers to an earlier lesson", async () => {
    db.quiz.set("ea-task-1", { lesson_number: 3, status: "draft" });
    expect((await getClassDashboard(teacher, "ea-class-1")).misconceptions).toEqual([]);
    db.quiz.set("ea-task-1", { lesson_number: 3, status: "published" });
    db.answers.get("ea-task-1")!.forEach(answer => { answer.lesson_number = 2; });
    expect((await getClassDashboard(teacher, "ea-class-1")).misconceptions).toEqual([]);
  });

  it("lists every question with its lesson, when it was asked, and which boards show it", async () => {
    const id = questionId("s1", "Does the post bend?");
    db.docs.set("ea-task-2:question_board", { publishedAt: "now", questions: [{ id, text: "Does the post bend?", theme: "" }] });
    const { questions } = await getClassDashboard(teacher, "ea-class-1");
    expect(questions).toEqual([{ id, text: "Does the post bend?", studentName: "Jayden R.", assignmentId: "ea-task-1", lessonNumber: 3,
      askedAt: "2026-11-05T09:00:00Z", tag: null, onBoards: ["ea-task-2"] }]);
  });

  it("adds a question to another lesson's published board, without the student's name", async () => {
    const id = questionId("s1", "Does the post bend?");
    const input = { questionId: id, fromAssignmentId: "ea-task-1", toAssignmentId: "ea-task-2" };
    await expect(addQuestionToBoard(teacher, "ea-class-1", input)).rejects.toMatchObject({ status: 409 });
    db.docs.set("ea-task-2:question_board", { publishedAt: "then", questions: [{ id: "f".repeat(16), text: "Why?", theme: "Forces" }] });
    const result = await addQuestionToBoard(teacher, "ea-class-1", input);
    expect(result.added).toBe(true);
    expect(result.board.questions).toEqual([{ id: "f".repeat(16), text: "Why?", theme: "Forces" }, { id, text: "Does the post bend?", theme: "" }]);
    expect(JSON.stringify(db.docs.get("ea-task-2:question_board"))).not.toContain("Jayden");
    expect((await addQuestionToBoard(teacher, "ea-class-1", input)).added).toBe(false);
  });

  it("refuses unknown tasks and questions", async () => {
    db.docs.set("ea-task-2:question_board", { publishedAt: "then", questions: [{ id: "f".repeat(16), text: "Why?", theme: "" }] });
    await expect(addQuestionToBoard(teacher, "ea-class-1", { questionId: "0".repeat(16), fromAssignmentId: "ea-task-1", toAssignmentId: "ea-task-2" })).rejects.toMatchObject({ status: 404 });
    await expect(addQuestionToBoard(teacher, "ea-class-1", { questionId: "0".repeat(16), fromAssignmentId: "ea-task-9", toAssignmentId: "ea-task-2" })).rejects.toMatchObject({ status: 404 });
  });
});
