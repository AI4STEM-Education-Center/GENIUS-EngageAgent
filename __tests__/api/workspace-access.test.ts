import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { sessionUser } from "@/lib/session";
import { workspaceContext, WorkspaceError } from "@/lib/workspace";
import { getQuizStatus } from "@/lib/nosql";
vi.mock("@/lib/session", () => ({ sessionUser: vi.fn(), sameOriginRequest: (req: Request) => req.headers.get("origin") === "https://engageagent.ai4genius.org" }));
vi.mock("@/lib/workspace", async original => ({ ...await original<typeof import("@/lib/workspace")>(), workspaceContext: vi.fn() }));
vi.mock("@/lib/nosql", () => ({ getQuizStatus: vi.fn() }));
const teacher = { geniusId: "t1", userId: "t1", role: "teacher" as const, name: "Teacher", email: null };
const student = { ...teacher, geniusId: "s1", userId: "s1", role: "student" as const, name: "Student" };
function request(path = "quiz-status", method = "GET", extra = {}) {
  const fields = { classId: "ea-class-1", assignmentId: "ea-task-1", ...extra };
  return new Request(`https://engageagent.ai4genius.org/api/${path}${method === "GET" ? `?${new URLSearchParams(fields)}` : ""}`, {
    method, headers: { origin: "https://engageagent.ai4genius.org", "Content-Type": "application/json" }, ...(method !== "GET" ? { body: JSON.stringify(fields) } : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(sessionUser).mockResolvedValue(teacher);
  vi.mocked(workspaceContext).mockResolvedValue(teacher);
  vi.mocked(getQuizStatus).mockResolvedValue({ class_id: "ea-class-1", assignment_id: "ea-task-1", lesson_number: 1, status: "published", updated_at: "" });
});
describe("native class authorization", () => {
  it("preserves the legacy class API contract", async () => {
    expect(await guardWorkspaceRequest(request("quiz-status", "GET", { classId: "legacy" }))).toBeNull();
    expect(sessionUser).not.toHaveBeenCalled();
  });
  it("requires authentication, including whitespace-normalized class IDs", async () => {
    vi.mocked(sessionUser).mockResolvedValue(null);
    expect((await guardWorkspaceRequest(request()))?.status).toBe(401);
    expect((await guardWorkspaceRequest(request("strategy-cache", "GET", { classId: " ea-class-1 " })))?.status).toBe(401);
  });
  it("denies wrong-class membership and task context", async () => {
    vi.mocked(workspaceContext).mockRejectedValue(new WorkspaceError("No access", 403));
    expect((await guardWorkspaceRequest(request()))?.status).toBe(403);
  });
  it("allows teachers to publish, not impersonate another GENIUS ID", async () => {
    expect(await guardWorkspaceRequest(request("quiz-status", "POST", { publishedBy: "t1" }))).toBeNull();
    expect((await guardWorkspaceRequest(request("quiz-status", "POST", { publishedBy: "t2" })))?.status).toBe(403);
  });
  it("prevents students reading another response or generating/publishing teacher content", async () => {
    vi.mocked(sessionUser).mockResolvedValue(student);
    expect((await guardWorkspaceRequest(request("student-answers")))?.status).toBe(403);
    expect((await guardWorkspaceRequest(request("student-answers", "GET", { studentId: "s2" })))?.status).toBe(403);
    expect(await guardWorkspaceRequest(request("student-answers", "GET", { studentId: "s1" }))).toBeNull();
    for (const route of ["quiz-status", "content-publish", "engagement-image", "strategy-job", "media"]) expect((await guardWorkspaceRequest(request(route, "POST")))?.status).toBe(403);
  });
  it("accepts only the logged-in student submitting to the currently published lesson", async () => {
    vi.mocked(sessionUser).mockResolvedValue(student);
    const fields = { studentId: "s1", studentName: "Student", lessonNumber: 1 };
    expect(await guardWorkspaceRequest(request("student-answers", "POST", fields))).toBeNull();
    expect((await guardWorkspaceRequest(request("student-answers", "POST", { ...fields, lessonNumber: 2 })))?.status).toBe(409);
    vi.mocked(getQuizStatus).mockResolvedValue(null);
    expect((await guardWorkspaceRequest(request("student-answers", "POST", fields)))?.status).toBe(409);
  });
  it("does not consume the request body needed by the original handler", async () => {
    const req = request("quiz-status", "POST");
    await guardWorkspaceRequest(req);
    expect((await req.json()).classId).toBe("ea-class-1");
  });
  it("does not allow test-student data in real native classes", async () => {
    expect((await guardWorkspaceRequest(request("auto-answer-test-students", "POST")))?.status).toBe(403);
  });
});
