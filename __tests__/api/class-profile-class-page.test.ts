import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";

// End to end with the real route, access checks and local storage; only the
// signed-in user is faked. The class page has no task, so only the class's own
// teacher may read or save its profile there (#173).
const signedIn = vi.hoisted(() => ({ user: null as UserContext | null }));
vi.mock("@/lib/session", async original => ({
  ...await original<typeof import("@/lib/session")>(),
  sessionUser: vi.fn(async () => signedIn.user),
}));

const origin = "https://engageagent.ai4genius.org";
const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Teacher", email: null, role: "teacher" };
const otherTeacher: UserContext = { ...teacher, geniusId: "teacher-2", userId: "teacher-2" };
const student: UserContext = { ...teacher, geniusId: "student-1", userId: "student-1", name: "Student", role: "student" };
const answers = { locale: "rural", groups: ["white"], groupAlternative: null, classType: "honors", englishLearners: true, iepOr504: false };

let dir: string;
let route: typeof import("@/app/api/class-profile/route");
let classId: string;
let taskId: string;

const get = (query: string, headers: Record<string, string> = {}) =>
  route.GET(new Request(`${origin}/api/class-profile?${query}`, { headers }));
const post = (body: Record<string, unknown>, headers: Record<string, string> = { origin }) =>
  route.POST(new Request(`${origin}/api/class-profile`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-class-profile-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir);
  vi.stubEnv("DYNAMODB_TABLE", "");
  vi.stubEnv("ENGAGE_APP_URL", origin);
  vi.resetModules();
  const workspace = await import("@/lib/workspace");
  route = await import("@/app/api/class-profile/route");
  const classroom = await workspace.createWorkspaceClass(teacher, "Physics");
  classId = classroom.id;
  taskId = (await workspace.createWorkspaceAssignment(teacher, classId, "Collisions")).id;
  await workspace.joinWorkspaceClass(student, classroom.joinCode);
  signedIn.user = teacher;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it("lets the class's teacher set it up on the class page, then see it inside any task", async () => {
  expect(await (await get(`classId=${classId}`)).json()).toEqual({ classProfile: null });

  const saved = await post({ classId, profile: answers });
  expect(saved.status).toBe(200);
  expect((await saved.json()).classProfile).toMatchObject({ ...answers, class_id: classId, status: "saved", updated_by: "teacher-1" });

  expect((await (await get(`classId=${classId}`)).json()).classProfile).toMatchObject({ locale: "rural", classType: "honors" });
  expect((await (await get(`classId=${classId}&assignmentId=${taskId}`)).json()).classProfile).toMatchObject({ locale: "rural", classType: "honors" });

  // Editing from inside the task updates the same class profile.
  expect((await post({ classId, assignmentId: taskId, profile: { ...answers, locale: "city" } })).status).toBe(200);
  expect((await (await get(`classId=${classId}`)).json()).classProfile.locale).toBe("city");
});

it("keeps other teachers, students and signed-out visitors out, with or without a task", async () => {
  await post({ classId, profile: answers });
  for (const [user, status] of [[otherTeacher, 403], [student, 403], [null, 401]] as const) {
    signedIn.user = user;
    expect((await get(`classId=${classId}`)).status).toBe(status);
    expect((await post({ classId, profile: { ...answers, locale: "city" } })).status).toBe(status);
    expect((await get(`classId=${classId}&assignmentId=${taskId}`)).status).toBe(status);
    expect((await post({ classId, assignmentId: taskId, profile: { ...answers, locale: "city" } })).status).toBe(status);
  }
  signedIn.user = teacher;
  expect((await (await get(`classId=${classId}`)).json()).classProfile.locale).toBe("rural");
});

it("refuses GENIUS tokens, GENIUS class IDs, other websites, repeated IDs and unknown classes on the class page", async () => {
  expect((await get(`classId=${classId}`, { authorization: "Bearer anything" })).status).toBe(400);
  expect((await get("classId=genius-class-7")).status).toBe(400);
  expect((await post({ classId, profile: answers }, { origin: "https://evil.example" })).status).toBe(403);
  expect((await get(`classId=${classId}&classId=ea-class-other`)).status).toBe(400);
  expect((await get("classId=ea-class-missing")).status).toBe(404);
  expect((await get("")).status).toBe(400);
  expect((await post({ classId, assignmentId: "", profile: answers })).status).toBe(400);
  expect((await (await get(`classId=${classId}`)).json()).classProfile).toBeNull();
});

it("records Skip for now on the class page without overwriting a saved profile", async () => {
  expect((await (await post({ classId, skip: true })).json()).classProfile.status).toBe("skipped");
  await post({ classId, profile: answers });
  expect((await (await post({ classId, skip: true })).json()).classProfile.status).toBe("saved");
});
