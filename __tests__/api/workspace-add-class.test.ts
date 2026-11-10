import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";

// Adding a class saves the class, then its profile (#173). If only the first
// works, the class must still count as added, or trying again makes a second one.
const mocks = vi.hoisted(() => ({ upsertClassProfile: vi.fn() }));
vi.mock("@/lib/nosql", () => ({ upsertClassProfile: mocks.upsertClassProfile }));
const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Teacher", email: null, role: "teacher" };
vi.mock("@/lib/session", async original => ({
  ...await original<typeof import("@/lib/session")>(),
  sessionUser: vi.fn(async () => teacher),
}));

const origin = "https://engageagent.ai4genius.org";
const answers = { locale: "rural", groups: ["white"], groupAlternative: null, classType: "honors", englishLearners: true, iepOr504: false };
let dir: string;

const add = async (body: Record<string, unknown>) => {
  const { POST } = await import("@/app/api/workspace/route");
  return POST(new Request(`${origin}/api/workspace`, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify({ action: "createClass", ...body }) }));
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-add-class-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir);
  vi.stubEnv("DYNAMODB_TABLE", "");
  vi.stubEnv("ENGAGE_APP_URL", origin);
  vi.resetModules();
  mocks.upsertClassProfile.mockReset().mockImplementation(async (record: unknown) => record);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("stores the profile under the new class, as saved, with who added it", async () => {
  const response = await add({ name: "Physics", profile: answers });
  const { classroom } = await response.json();
  expect(mocks.upsertClassProfile).toHaveBeenCalledTimes(1);
  expect(mocks.upsertClassProfile.mock.calls[0][0]).toMatchObject({ ...answers, class_id: classroom.id, status: "saved", updated_by: "teacher-1" });
  expect(mocks.upsertClassProfile.mock.calls[0][0].updated_at).toBeTruthy();
});

it("doesn't store a profile when none was sent, or when the answers are bad", async () => {
  const nameOnly = await add({ name: "Physics" });
  expect(nameOnly.status).toBe(201);
  // Leaving the questions blank isn't a failed save, so the class page shows no warning.
  expect(await nameOnly.json()).not.toHaveProperty("profileSaved");
  expect((await add({ name: "Physics", profile: { locale: "moon" } })).status).toBe(400);
  expect(mocks.upsertClassProfile).not.toHaveBeenCalled();
});

it("still counts as added when only the profile fails, and says so without logging the class details", async () => {
  mocks.upsertClassProfile.mockRejectedValueOnce(new Error("secret table details"));
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await add({ name: "Physics", profile: answers });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.profileSaved).toBe(false);
  expect(body.classroom.name).toBe("Physics");
  expect(JSON.stringify(body)).not.toContain("secret table details");
  expect(JSON.stringify(logged.mock.calls)).not.toContain("secret table details");
  expect(JSON.stringify(logged.mock.calls)).not.toContain("Physics");

  const { listWorkspaceClasses } = await import("@/lib/workspace");
  expect(await listWorkspaceClasses(teacher)).toEqual([{ id: body.classroom.id, name: "Physics" }]);
});
