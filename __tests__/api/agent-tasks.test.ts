import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
vi.mock("@/lib/session", () => ({ sameOriginRequest: (r: Request) => r.headers.get("origin") === "https://engage.test" }));
import { POST } from "@/app/api/agent-tasks/route";
import { SSO_ISSUER } from "@/lib/auth";
import { listAgentTaskLinks } from "@/lib/agent-tasks";

const secret = "agent-task-test-only-secret-not-a-real-credential";
const now = () => Math.floor(Date.now() / 1000);
const token = (claims: Record<string, unknown> = {}, signingSecret = secret) => new SignJWT({
  sub: "genius-teacher", role: "teacher", name: "GENIUS Teacher", aud: "engageagent-embed", iat: now(), exp: now() + 3600, ...claims,
}).setProtectedHeader({ alg: "HS256" }).setIssuer(SSO_ISSUER).sign(new TextEncoder().encode(signingSecret));
const call = async (body: unknown, bearer?: string, origin = "https://engage.test") => {
  const response = await POST(new Request("https://engage.test/api/agent-tasks", { method: "POST", body: JSON.stringify(body),
    headers: { origin, "Content-Type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } }));
  return { status: response.status, body: await response.json() };
};
const create = async (bearer?: string) => (await call({ action: "create", title: "Forces" }, bearer ?? await token())).body.task;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-agent-task-api-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir); vi.stubEnv("DYNAMODB_TABLE", ""); vi.stubEnv("SSO_SECRET", secret);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("authentication", () => {
  it("requires a valid embedded GENIUS token, with no class needed", async () => {
    expect((await call({ action: "create", title: "x" })).status).toBe(401);
    expect((await call({ action: "create", title: "x" }, await token({}, "wrong-secret"))).status).toBe(401);
    expect((await call({ action: "create", title: "x" }, await token({ aud: "engageagent-login" }))).status).toBe(401);
    expect((await call({ action: "create", title: "x" }, await token({ aud: undefined }))).status).toBe(401);
    expect((await call({ action: "create", title: "x" }, await token({ iat: now() - 7200, exp: now() - 3600 }))).status).toBe(401);
    expect((await call({ action: "create", title: "x" }, await token())).status).toBe(201);
  });
  it("rejects cross-origin writes and malformed bodies", async () => {
    expect((await call({ action: "create", title: "x" }, await token(), "https://evil.test")).status).toBe(403);
    expect((await call([], await token())).status).toBe(400);
    expect((await call({ action: "remove" }, await token())).status).toBe(400);
  });
});

describe("teacher actions", () => {
  it("creates, opens, updates and archives an owned activity", async () => {
    const bearer = await token();
    const task = await create(bearer);
    expect(task).toMatchObject({ title: "Forces", ownerGeniusId: "genius-teacher", archived: false });
    expect((await call({ action: "open", taskId: task.agentTaskId }, bearer)).body).toEqual({ task, links: [] });
    expect((await call({ action: "update", taskId: task.agentTaskId, title: "Motion" }, bearer)).body.task.title).toBe("Motion");
    expect((await call({ action: "archive", taskId: task.agentTaskId }, bearer)).body.task).toMatchObject({ archived: true, title: "Motion" });
    expect((await call({ action: "open", taskId: task.agentTaskId }, bearer)).status).toBe(410);
    expect((await call({ action: "open", taskId: task.agentTaskId, allowArchived: true }, bearer)).body.task.archived).toBe(true);
  });
  it("blocks other teachers and students from managing the activity", async () => {
    const task = await create();
    for (const claims of [{ sub: "other-teacher" }, { role: "student" }]) {
      const bearer = await token(claims);
      for (const action of ["open", "update", "archive"]) expect((await call({ action, taskId: task.agentTaskId, title: "x" }, bearer)).status).toBe(403);
    }
    expect((await call({ action: "create", title: "x" }, await token({ role: "student" }))).status).toBe(403);
  });
  it("links the signed GENIUS class on create and when opened from another class", async () => {
    const task = await create(await token({ classId: "class-a", assignmentId: "assign-a" }));
    await call({ action: "open", taskId: task.agentTaskId }, await token({ classId: "class-b", assignmentId: "assign-b" }));
    const { body } = await call({ action: "open", taskId: task.agentTaskId }, await token());
    expect(body.links.map((link: { classId: string }) => link.classId).sort()).toEqual(["class-a", "class-b"]);
  });
  it("returns 404 for unknown or malformed task IDs", async () => {
    for (const taskId of ["ea-agent-task-00000000-0000-0000-0000-000000000000", "nope", 7]) {
      expect((await call({ action: "open", taskId }, await token())).status).toBe(404);
    }
  });
});

describe("student launch", () => {
  const student = (claims: Record<string, unknown> = {}) => token({ sub: "genius-student", role: "student", classId: "class-a", assignmentId: "assign-a", ...claims });
  it("returns only the title and records the class link", async () => {
    const task = await create();
    const { status, body } = await call({ action: "launch", taskId: task.agentTaskId }, await student());
    expect(status).toBe(200);
    expect(body).toEqual({ task: { agentTaskId: task.agentTaskId, title: "Forces" } });
    expect(await listAgentTaskLinks(task.agentTaskId)).toMatchObject([{ classId: "class-a", assignmentId: "assign-a", linkedBy: "genius-student" }]);
  });
  it("refuses archived, unknown and class-less launches", async () => {
    const bearer = await token();
    const task = await create(bearer);
    expect((await call({ action: "launch", taskId: task.agentTaskId }, await student({ classId: undefined }))).status).toBe(403);
    expect((await call({ action: "launch", taskId: "ea-agent-task-00000000-0000-0000-0000-000000000000" }, await student())).status).toBe(404);
    await call({ action: "archive", taskId: task.agentTaskId }, bearer);
    expect((await call({ action: "launch", taskId: task.agentTaskId }, await student())).body).toEqual({ error: "This activity is no longer available." });
  });
});
