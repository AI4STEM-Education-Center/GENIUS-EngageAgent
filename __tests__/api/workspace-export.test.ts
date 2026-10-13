import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { GET as exported } from "@/app/api/data-export/route";
import { GET as gallery } from "@/app/api/gallery/route";
const mocks = vi.hoisted(() => ({ session: vi.fn(), classes: vi.fn(), context: vi.fn(), annotations: vi.fn(), answers: vi.fn(), plans: vi.fn(), published: vi.fn(), ratings: vi.fn(), media: vi.fn() }));
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: () => true }));
vi.mock("@/lib/workspace", async original => ({ ...await original<typeof import("@/lib/workspace")>(), listWorkspaceClasses: mocks.classes, workspaceContext: mocks.context }));
vi.mock("@/lib/nosql", () => ({ listAllTeacherAnnotations: mocks.annotations, listAllStudentAnswers: mocks.answers, listAllCachedPlans: mocks.plans,
  listAllPublishedContent: mocks.published, listAllContentRatings: mocks.ratings, listAllMedia: mocks.media }));
const origin = "https://engageagent.ai4genius.org";
const teacher = { geniusId: "teacher", userId: "teacher", name: "Teacher", role: "teacher", email: null };
const rows = ["legacy", "ea-class-owned", "CLASS#ea-class-other", "host-class", "CLASS#host-class", "host-foreign"].map((class_id, i) => ({
  class_id, assignment_id: i === 4 ? "other-task" : "task", student_name: `Student ${i}`, student_id: `student-${i}`,
  submitted_at: "2026-09-11T00:00:00.000Z", updated_at: "2026-09-11T00:00:00.000Z", published_at: "2026-09-11T00:00:00.000Z", rated_at: "2026-09-11T00:00:00.000Z",
}));
const req = (path: string, query = {}, bearer?: string) => new NextRequest(`${origin}/api/${path}?${new URLSearchParams(query)}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
const scans = () => [mocks.annotations, mocks.answers, mocks.plans, mocks.published, mocks.ratings, mocks.media];
const sign = (changes = {}, secret = "collection-test-secret") => new SignJWT({ sub: "teacher", role: "teacher", name: "Teacher", classId: "host-class", assignmentId: "task", aud: "engageagent-embed", ...changes })
  .setProtectedHeader({ alg: "HS256" }).setIssuer("genius-learning-platform").setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(secret));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SSO_SECRET", "collection-test-secret"); mocks.session.mockResolvedValue(null);
  mocks.classes.mockResolvedValue([{ id: "ea-class-owned" }]); mocks.context.mockResolvedValue({});
  mocks.annotations.mockResolvedValue([{ workspace_class_id: "ea-class-owned", created_at: "2026-09-11T00:00:00.000Z" }, { created_at: "2026-09-11T00:00:00.000Z" }]);
  for (const mock of [mocks.answers, mocks.plans, mocks.published, mocks.ratings]) mock.mockResolvedValue(rows);
  mocks.media.mockResolvedValue({ items: rows.map(row => ({ ...row, url: `https://private.example/${row.student_id}` })), nextCursor: null });
});
afterEach(() => vi.unstubAllEnvs());

it.each([["data-export", exported], ["gallery", gallery]] as const)("rejects anonymous and student %s access before any collection scan", async (path, handler) => {
  expect((await handler(req(path))).status).toBe(401);
  mocks.session.mockResolvedValue({ ...teacher, role: "student" });
  expect((await handler(req(path))).status).toBe(403);
  for (const mock of scans()) expect(mock).not.toHaveBeenCalled();
});

it("limits native teacher summaries and JSON exports to owned classes, never legacy GENIUS records", async () => {
  mocks.session.mockResolvedValue(teacher);
  const summary = await exported(req("data-export"));
  expect(summary.headers.get("Cache-Control")).toBe("no-store");
  expect((await summary.json()).months[0]).toMatchObject({ annotations: 1, studentAnswers: 1, strategyPlans: 1, publishedContent: 1, contentRatings: 1 });
  const data = await (await exported(req("data-export", { month: "2026-09" }))).json();
  expect(data.studentAnswers.map((row: { class_id: string }) => row.class_id)).toEqual(["ea-class-owned"]);
});

it.each([["data-export", exported], ["gallery", gallery]] as const)("binds embedded teacher %s to the signed class and assignment without cookie fallback", async (path, handler) => {
  const token = await sign();
  const response = await handler(req(path, { classId: "host-class", assignmentId: "task", month: "2026-09" }, token));
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  const data = await response.json();
  const records = path === "gallery" ? data.items : data.studentAnswers;
  expect(records.map((row: { student_id: string }) => row.student_id)).toEqual(["student-3"]);
  if (path === "data-export") expect(data.annotations).toEqual([]);
  for (const mock of scans()) mock.mockClear();
  mocks.session.mockResolvedValue(teacher);
  for (const [query, bearer] of [
    [{ classId: "host-class", assignmentId: "other-task" }, token],
    [{ classId: "host-foreign", assignmentId: "task" }, token],
    [{ classId: "host-class", assignmentId: "task" }, await sign({ role: "student" })],
    [{ classId: "host-class", assignmentId: "task" }, await sign({}, "wrong-secret")],
    [{}, token],
  ] as const) expect((await handler(req(path, query, bearer))).status).toBeGreaterThanOrEqual(400);
  for (const mock of scans()) expect(mock).not.toHaveBeenCalled();
});

it("passes only server-derived ownership scope to gallery pagination and filters foreign adapter rows", async () => {
  mocks.session.mockResolvedValue(teacher);
  const response = await gallery(req("gallery", { limit: "12", cursor: "12" }));
  expect(mocks.media).toHaveBeenCalledWith(expect.objectContaining({ scope: { classIds: ["ea-class-owned"] }, cursor: "12", limit: 12 }));
  expect((await response.json()).items.map((row: { class_id: string }) => row.class_id)).toEqual(["ea-class-owned"]);
});

it("scopes an embedded Excel export to the same assignment as the JSON export", async () => {
  const response = await exported(req("data-export", { classId: "host-class", assignmentId: "task", month: "2026-09", format: "xlsx" }, await sign()));
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
  expect(XLSX.utils.sheet_to_json(workbook.Sheets["Student Answers"])).toEqual([expect.objectContaining({ "Class ID": "host-class", "Assignment ID": "task", "Student ID": "student-3" })]);
});
