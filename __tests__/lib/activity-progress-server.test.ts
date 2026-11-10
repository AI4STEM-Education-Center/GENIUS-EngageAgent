import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  quiz: null as { lesson_number: number; status: string } | null,
  surveys: [] as { status: string }[],
  published: [] as unknown[],
  docs: new Map<string, unknown>(),
}));
vi.mock("@/lib/nosql", () => ({
  getQuizStatus: vi.fn(async () => db.quiz),
  listSurveys: vi.fn(async () => db.surveys),
  listPublishedContent: vi.fn(async () => db.published),
  getTaskDoc: vi.fn(async (_c: string, _a: string, kind: string) => db.docs.get(kind) ?? null),
}));

import { computeActivityProgress } from "@/lib/activity-progress-server";

beforeEach(() => { db.quiz = null; db.surveys = []; db.published = []; db.docs.clear(); });
const progress = () => computeActivityProgress("ea-class-1", "ea-task-1");

it("reads each step from the task's saved data (#176)", async () => {
  expect(await progress()).toEqual({ assessment: "not-started", strategy: "not-started", materials: "not-started", discussion: "not-started" });
  db.quiz = { lesson_number: 3, status: "draft" };
  expect((await progress()).assessment).toBe("in-progress");
  db.quiz.status = "closed";
  expect(await progress()).toMatchObject({ assessment: "done", strategy: "in-progress" });
  db.published = [{ content_item_id: "m1" }];
  expect(await progress()).toMatchObject({ strategy: "done", materials: "done", discussion: "in-progress" });
  db.docs.set("question_board", { questions: [] });
  expect((await progress()).discussion).toBe("in-progress");
});

it("counts a published survey and released reports", async () => {
  db.surveys = [{ status: "draft" }];
  expect((await progress()).assessment).toBe("not-started");
  db.surveys = [{ status: "published" }];
  expect((await progress()).assessment).toBe("done");
  db.quiz = { lesson_number: 3, status: "published" };
  db.docs.set("report_release", { reason: "early", lessonNumber: 3 });
  expect((await progress()).discussion).toBe("done");
});

it("keeps discussion in progress when a release belongs to a different lesson", async () => {
  db.quiz = { lesson_number: 4, status: "published" };
  db.published = [{ content_item_id: "m1" }];
  db.docs.set("report_release", { reason: "taught", lessonNumber: 3 });
  expect((await progress()).discussion).toBe("in-progress");
  db.docs.set("report_release", { reason: "taught", lessonNumber: 4 });
  expect((await progress()).discussion).toBe("done");
});

it("does not mark discussion done from a saved release while the quiz is a draft", async () => {
  db.quiz = { lesson_number: 3, status: "draft" };
  db.docs.set("question_board", { questions: [] });
  db.docs.set("report_release", { reason: "early", lessonNumber: 3 });
  expect((await progress()).discussion).toBe("in-progress");
  db.quiz.status = "published";
  expect((await progress()).discussion).toBe("done");
  db.quiz.status = "closed";
  expect((await progress()).discussion).toBe("done");
});
