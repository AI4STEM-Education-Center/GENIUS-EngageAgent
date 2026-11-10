import { afterEach, expect, it, vi } from "vitest";
import { agentTaskFetch, clearVerifiedClientAuth, scopedClientAuthHeaders, scopedTaskFetch, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext } from "@/lib/auth";

const user: UserContext = { geniusId: "teacher", userId: "teacher", email: null, name: "Teacher", role: "teacher", classId: "host-class", assignmentId: "host-task" };
afterEach(() => { clearVerifiedClientAuth(); vi.unstubAllGlobals(); });

it("uses only an active verified identity matching both task coordinates", () => {
  expect(scopedClientAuthHeaders(user)).toEqual({});
  setVerifiedClientAuth("verified-credential", user);
  expect(scopedClientAuthHeaders(user)).toEqual({ Authorization: "Bearer verified-credential" });
  for (const scope of [{}, { classId: user.classId }, { classId: user.classId, assignmentId: "other-task" }, { classId: "other-class", assignmentId: user.assignmentId }]) {
    expect(scopedClientAuthHeaders(scope)).toEqual({});
  }
  clearVerifiedClientAuth();
  expect(scopedClientAuthHeaders(user)).toEqual({});
});

it("preserves request headers while authenticating matching task API requests", async () => {
  const transport = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", transport);
  setVerifiedClientAuth("host-token", user);
  const init = { method: "POST", headers: { "Content-Type": "application/json", "X-Request-ID": "test" }, body: "{}" };
  await scopedTaskFetch(user, "/api/content-rating", init);
  const sent = transport.mock.calls[0] as unknown as [string, RequestInit];
  const headers = new Headers(sent[1].headers);
  expect(headers.get("Authorization")).toBe("Bearer host-token");
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(headers.get("X-Request-ID")).toBe("test");
  expect(sent[1].body).toBe("{}");
  expect(init.headers).not.toHaveProperty("Authorization");
});

it.each(["ask-engageagent", "question-analysis", "question-board", "quiz-report", "quiz-report-release", "task-quiz", "task-quiz/lesson", "task-quiz/anchoring", "task-quiz/source", "task-quiz/upload", "task-quiz/link", "task-quiz/create", "task-quiz/match", "task-quiz/item", "task-quiz/publish", "task-quiz/preview", "task-quiz/source-file"])("authenticates the %s task API only for the verified class and assignment", async path => {
  const transport = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", transport);
  setVerifiedClientAuth("host-token", user);
  const input = `/api/${path}?classId=host-class&assignmentId=host-task`;
  await scopedTaskFetch(user, input, { headers: { "X-Request-ID": "discussion" } });
  const sent = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(sent[0]).toBe(input);
  expect(new Headers(sent[1].headers).get("Authorization")).toBe("Bearer host-token");
  expect(new Headers(sent[1].headers).get("X-Request-ID")).toBe("discussion");

  await scopedTaskFetch({ ...user, assignmentId: "other-task" }, `/api/${path}`);
  const differentTask = transport.mock.calls[1] as unknown as [string, RequestInit];
  expect(new Headers(differentTask[1].headers).has("Authorization")).toBe(false);
});

it("authenticates class profile reads and saves inside GENIUS (#173)", async () => {
  const transport = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", transport);
  setVerifiedClientAuth("host-token", user);
  await scopedTaskFetch(user, "/api/class-profile?classId=host-class&assignmentId=host-task");
  await scopedTaskFetch(user, "/api/class-profile", { method: "POST", body: "{}" });
  for (const call of transport.mock.calls as unknown as [string, RequestInit][]) {
    expect(new Headers(call[1].headers).get("Authorization")).toBe("Bearer host-token");
  }
});

it("loads activity progress for a verified GENIUS task without authorizing another task or a signed-out request", async () => {
  const progress = { assessment: "done", strategy: "in-progress", materials: "not-started", discussion: "not-started" };
  const transport = vi.fn(async (_input: string, init?: RequestInit) => {
    const authorized = new Headers(init?.headers).get("Authorization") === "Bearer host-token";
    return new Response(JSON.stringify(authorized ? { progress } : { error: "Sign-in required." }), { status: authorized ? 200 : 401 });
  });
  vi.stubGlobal("fetch", transport);
  setVerifiedClientAuth("host-token", user);
  const path = "/api/activity-progress?classId=host-class&assignmentId=host-task";
  const response = await scopedTaskFetch(user, path, { cache: "no-store" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ progress });

  const wrongTask = await scopedTaskFetch({ ...user, assignmentId: "other-task" }, "/api/activity-progress?classId=host-class&assignmentId=other-task");
  expect(wrongTask.status).toBe(401);
  expect(new Headers(transport.mock.calls[1][1]?.headers).has("Authorization")).toBe(false);

  clearVerifiedClientAuth();
  const signedOut = await scopedTaskFetch(user, path);
  expect(signedOut.status).toBe(401);
  expect(new Headers(transport.mock.calls[2][1]?.headers).has("Authorization")).toBe(false);
});

it("sends the launch credential for a task's lessons, but not for the open lesson pages", async () => {
  const transport = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", transport);
  setVerifiedClientAuth("host-token", user);
  await scopedTaskFetch(user, "/api/lessons?classId=c&assignmentId=a");
  await scopedTaskFetch(user, "/api/lessons/9?classId=c&assignmentId=a");
  await scopedTaskFetch(user, "/api/lessons/9");
  const sent = transport.mock.calls as unknown as [string, RequestInit | undefined][];
  expect(new Headers(sent[0][1]?.headers).get("Authorization")).toBe("Bearer host-token");
  expect(new Headers(sent[1][1]?.headers).get("Authorization")).toBe("Bearer host-token");
  expect(new Headers(sent[2][1]?.headers).has("Authorization")).toBe(false);
});

it("never leaks the launch credential to external, media, download, or different-task requests", async () => {
  const transport = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", transport);
  setVerifiedClientAuth("host-token", user);
  for (const url of ["https://provider.example/api/content-rating", "//provider.example/api/content-rating", "/api/download?url=https://provider.example", "/api/lessons", "/api/quiz-status/../../download", "/image.png"]) {
    await scopedTaskFetch(user, url);
  }
  await scopedTaskFetch({ ...user, assignmentId: "other-task" }, "/api/content-rating");
  for (const call of transport.mock.calls) {
    const sent = call as unknown as [string, RequestInit | undefined];
    expect(new Headers(sent[1]?.headers).has("Authorization")).toBe(false);
  }
});

it("never sends embedded credentials for native classes, or carries old credentials into an unscoped identity", () => {
  setVerifiedClientAuth("host-token", user);
  const native = { ...user, classId: "ea-class-a", assignmentId: "ea-task-a" };
  expect(scopedClientAuthHeaders(native)).toEqual({});
  setVerifiedClientAuth("native-token", native);
  expect(scopedClientAuthHeaders(native)).toEqual({});
  expect(scopedClientAuthHeaders(user)).toEqual({});
  setVerifiedClientAuth("host-token", user);
  setVerifiedClientAuth("unscoped-token", { ...user, classId: undefined });
  expect(scopedClientAuthHeaders(user)).toEqual({});
});

it("sends the verified token to the activity API even without a class, but never a native workspace one", async () => {
  const transport = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", transport);
  const headerOf = (call: number) => new Headers((transport.mock.calls[call] as unknown as [string, RequestInit])[1].headers).get("Authorization");
  setVerifiedClientAuth("create-token", { ...user, classId: undefined, assignmentId: undefined });
  expect(scopedClientAuthHeaders(user)).toEqual({});
  await agentTaskFetch({ action: "create", title: "Forces" });
  expect(transport.mock.calls[0]).toMatchObject(["/api/agent-tasks", { method: "POST", body: JSON.stringify({ action: "create", title: "Forces" }) }]);
  expect(headerOf(0)).toBe("Bearer create-token");
  setVerifiedClientAuth("native-token", { ...user, classId: "ea-class-1", assignmentId: "ea-task-1" });
  await agentTaskFetch({ action: "open" });
  expect(headerOf(1)).toBeNull();
  clearVerifiedClientAuth();
  await agentTaskFetch({ action: "open" });
  expect(headerOf(2)).toBeNull();
});
