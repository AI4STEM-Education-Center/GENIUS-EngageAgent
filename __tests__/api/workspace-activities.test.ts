import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";

// Class tasks are activities (#176): each gets an activity record, which only
// the teacher sees.
const state = vi.hoisted(() => ({ user: null as unknown as UserContext }));
vi.mock("@/lib/session", async original => ({
  ...await original<typeof import("@/lib/session")>(),
  sessionUser: vi.fn(async () => state.user),
}));
vi.mock("@/lib/nosql", () => ({ upsertClassProfile: vi.fn() }));

const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Teacher", email: null, role: "teacher" };
const student: UserContext = { geniusId: "student-1", userId: "student-1", name: "Student", email: null, role: "student" };
const origin = "https://engageagent.ai4genius.org";
let dir: string;

const route = () => import("@/app/api/workspace/route");
const post = async (body: Record<string, unknown>) => (await route()).POST(new Request(`${origin}/api/workspace`,
  { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) }));
const get = async (query: Record<string, string>) => (await route()).GET(new Request(`${origin}/api/workspace?${new URLSearchParams(query)}`));

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-workspace-activities-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir);
  vi.stubEnv("DYNAMODB_TABLE", "");
  vi.stubEnv("ENGAGE_APP_URL", origin);
  vi.resetModules();
  state.user = teacher;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it("creates each task with an activity, which the teacher gets when opening it", async () => {
  const { classroom } = await (await post({ action: "createClass", name: "Physics" })).json();
  const created = await post({ action: "createTask", classId: classroom.id, title: "Forces" });
  expect(created.status).toBe(201);
  const { assignment } = await created.json();
  expect(assignment.activityId).toMatch(/^ea-agent-task-/u);

  const opened = await (await get({ classId: classroom.id, assignmentId: assignment.id })).json();
  expect(opened).toMatchObject({ activityId: assignment.activityId, user: { taskTitle: "Forces" } });
});

it("gives students no activity IDs", async () => {
  const { classroom } = await (await post({ action: "createClass", name: "Physics" })).json();
  const { assignment } = await (await post({ action: "createTask", classId: classroom.id, title: "Forces" })).json();
  state.user = student;
  await post({ action: "joinClass", code: classroom.joinCode });
  const page = await (await get({ classId: classroom.id })).json();
  expect(page.assignments).toEqual([{ id: assignment.id, title: "Forces", createdAt: assignment.createdAt }]);
  const opened = await (await get({ classId: classroom.id, assignmentId: assignment.id })).json();
  expect(opened).not.toHaveProperty("activityId");
  expect(opened).not.toHaveProperty("classSize");
});
