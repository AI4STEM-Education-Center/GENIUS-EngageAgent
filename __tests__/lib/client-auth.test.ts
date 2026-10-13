import { afterEach, expect, it, vi } from "vitest";
import { clearVerifiedClientAuth, scopedClientAuthHeaders, scopedTaskFetch, setVerifiedClientAuth } from "@/lib/client-auth";
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
