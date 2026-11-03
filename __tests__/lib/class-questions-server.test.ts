import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  reviews: [] as { student_id: string; questions: string[]; submitted_at: string }[],
  docs: new Map<string, unknown>(),
  lesson: 3 as number | null,
}));
vi.mock("@/lib/nosql", () => ({
  listReviewQuestions: vi.fn(async () => db.reviews),
  listStudentAnswers: vi.fn(async () => [{ student_id: "s1", student_name: "Aaliyah K." }]),
  getQuizStatus: vi.fn(async () => (db.lesson ? { lesson_number: db.lesson, status: "published" } : null)),
  getTaskDoc: vi.fn(async (_c: string, _a: string, kind: string) => db.docs.get(kind) ?? null),
  putTaskDoc: vi.fn(async (_c: string, _a: string, kind: string, data: unknown) => { db.docs.set(kind, data); }),
}));

import { getTaskQuestions } from "@/lib/class-questions-server";
import type { ChatClient } from "@/lib/daily-experience-llm";

const create = vi.fn();
const client = { chat: { completions: { create } } } as unknown as ChatClient;
const answer = (count: number, themes = ["Seeing forces"]) => ({
  choices: [{ message: { content: JSON.stringify({ themes, questions: Array.from({ length: count }, (_, index) => ({ index, theme: 0, tag: "Investigable", suggested: index === 0 })) }) } }],
});

beforeEach(() => {
  create.mockReset();
  db.docs.clear();
  db.lesson = 3;
  db.reviews = [{ student_id: "s1", questions: ["Does the post bend?", "Why can't we see it?"], submitted_at: "2026-11-01T10:00:00Z" }];
});

it("sorts the questions once and reuses the saved analysis while they don't change", async () => {
  create.mockResolvedValue(answer(2));
  const first = await getTaskQuestions("ea-class-1", "ea-task-1", client);
  expect(first).toMatchObject({ lessonNumber: 3, total: 2, students: 1, analysisError: null });
  expect(first.groups).toHaveLength(1);
  expect(first.groups[0]).toMatchObject({ title: "Seeing forces" });
  expect(first.groups[0].questions[0]).toMatchObject({ studentName: "Aaliyah K.", tag: "Investigable", suggested: true });

  await getTaskQuestions("ea-class-1", "ea-task-1", client);
  expect(create).toHaveBeenCalledTimes(1);

  db.reviews.push({ student_id: "s2", questions: ["Is bouncing a collision?"], submitted_at: "2026-11-01T11:00:00Z" });
  create.mockResolvedValue(answer(3));
  expect((await getTaskQuestions("ea-class-1", "ea-task-1", client)).total).toBe(3);
  expect(create).toHaveBeenCalledTimes(2);
});

it("keeps sorting with the older analysis when a new one fails", async () => {
  create.mockResolvedValueOnce(answer(2));
  await getTaskQuestions("ea-class-1", "ea-task-1", client);
  db.reviews.push({ student_id: "s2", questions: ["Is bouncing a collision?"], submitted_at: "2026-11-01T11:00:00Z" });
  create.mockRejectedValueOnce(new Error("provider down"));
  const result = await getTaskQuestions("ea-class-1", "ea-task-1", client);
  expect(result.analysisError).toBe("The questions couldn't be sorted right now.");
  expect(result.groups.map(g => [g.title, g.questions.length])).toEqual([["Seeing forces", 2], ["Other questions", 1]]);
});

it("lists the questions unsorted without an AI client or a lesson", async () => {
  const noClient = await getTaskQuestions("ea-class-1", "ea-task-1", null);
  expect(noClient.analysisError).toBe("AI sorting is not set up on this server.");
  expect(noClient.groups).toEqual([expect.objectContaining({ title: "All questions" })]);
  db.lesson = null;
  expect((await getTaskQuestions("ea-class-1", "ea-task-1", client)).analysisError).toContain("Choose the task's lesson");
  expect(create).not.toHaveBeenCalled();
});

it("returns no groups and calls no model without questions", async () => {
  db.reviews = [];
  expect(await getTaskQuestions("ea-class-1", "ea-task-1", client)).toEqual({ lessonNumber: 3, total: 0, students: 0, groups: [], analysisError: null });
  expect(create).not.toHaveBeenCalled();
});
