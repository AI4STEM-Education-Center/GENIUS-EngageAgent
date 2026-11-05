import { beforeEach, expect, it, vi } from "vitest";

// Saving a task's quiz also notes which lesson version it uses (#175). The quiz matters more.
const mocks = vi.hoisted(() => ({ pin: vi.fn(), upsert: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/lessons-store", () => ({ pinTaskToLesson: mocks.pin }));
vi.mock("@/lib/nosql", () => ({ getQuizStatus: vi.fn(), upsertQuizStatus: mocks.upsert }));
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null), workspaceRequestUser: mocks.user }));

import { POST } from "@/app/api/quiz-status/route";

const teacher = { geniusId: "t1", role: "teacher", name: "Ana" };
const save = (lessonNumber: unknown = 3) => POST(new Request("http://localhost/api/quiz-status", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ classId: "c1", assignmentId: "a1", lessonNumber, status: "published" }),
}));

beforeEach(() => {
  mocks.pin.mockReset().mockResolvedValue({ version: 1 });
  mocks.upsert.mockReset().mockResolvedValue({ class_id: "c1", status: "published" });
  mocks.user.mockReset().mockResolvedValue(teacher);
});

it("notes the version for the signed-in teacher", async () => {
  expect((await save()).status).toBe(200);
  expect(mocks.pin).toHaveBeenCalledWith(teacher, "c1", "a1", 3);
});

it("still saves the quiz when noting the version fails, and logs no details", async () => {
  mocks.pin.mockRejectedValue(new Error("secret table details"));
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await save();
  expect(response.status).toBe(200);
  expect((await response.json()).quizStatus).toMatchObject({ status: "published" });
  expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
  logged.mockRestore();
});

it("skips it when there's no user or the lesson number isn't whole", async () => {
  mocks.user.mockResolvedValueOnce(null);
  expect((await save()).status).toBe(200);
  expect((await save("3")).status).toBe(200);
  expect(mocks.pin).not.toHaveBeenCalled();
});
