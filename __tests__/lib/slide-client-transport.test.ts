import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext as EmbeddedUserContext } from "@/lib/auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { postSlideRequest } from "@/lib/slides/client-transport";

const body = { classId: "ea-class-a", assignmentId: "ea-task-a", lessonNumber: 3, strategy: "cognitive conflict" };
const reply = (data: unknown, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const pending = (id = "job-a") => reply({ job: { id, pollAfterMs: 2000 } }, 202);
const fetchMock = vi.fn();
const calls = () => fetchMock.mock.calls.map(([path, init]) => ({ path, body: JSON.parse(init.body), signal: init.signal, keepalive: init.keepalive }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps synchronous responses compatible without making polling requests", async () => {
  fetchMock.mockResolvedValue(reply({ draft: { title: "Complete" } }));
  expect(await postSlideRequest("/api/slides", body, new AbortController().signal)).toEqual({ draft: { title: "Complete" } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("submits once, polls 202 then returns the original successful payload", async () => {
  fetchMock.mockResolvedValueOnce(pending()).mockResolvedValueOnce(pending()).mockResolvedValueOnce(reply({ draft: { title: "Complete" }, model: "model" }));
  const result = postSlideRequest("/api/slides", body, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(4000);
  expect(await result).toEqual({ draft: { title: "Complete" }, model: "model" });
  expect(calls().map(call => call.path)).toEqual(["/api/slides", "/api/slides/jobs", "/api/slides/jobs"]);
  expect(calls()[1].body).toEqual({ classId: body.classId, assignmentId: body.assignmentId, jobId: "job-a" });
});

it("retries transient polling failures on the same job without repeating generation", async () => {
  fetchMock.mockResolvedValueOnce(pending()).mockRejectedValueOnce(new TypeError("Network failed"))
    .mockResolvedValueOnce(reply({ error: "Gateway unavailable" }, 503)).mockResolvedValueOnce(reply({ issues: [] }));
  const result = postSlideRequest("/api/slides/check", body, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await result).toEqual({ issues: [] });
  expect(calls().filter(call => call.path === "/api/slides/check")).toHaveLength(1);
  expect(calls().slice(1).every(call => call.body.jobId === "job-a")).toBe(true);
});

it.each([401, 403])("does not retry a failed authorization (%i)", async status => {
  fetchMock.mockResolvedValueOnce(pending()).mockResolvedValueOnce(reply({ error: "Sign in again" }, status)).mockResolvedValue(reply({ cancelled: true }));
  const failure = expect(postSlideRequest("/api/slides", body, new AbortController().signal)).rejects.toThrow("Sign in again");
  await vi.advanceTimersByTimeAsync(30_000); await failure;
  expect(calls().filter(call => call.path === "/api/slides/jobs" && !call.body.operation)).toHaveLength(1);
});

it("surfaces a terminal provider failure immediately without treating it as gateway instability", async () => {
  fetchMock.mockResolvedValueOnce(pending()).mockResolvedValueOnce(reply({ error: "Provider could not complete the draft", jobFailure: true }, 502))
    .mockResolvedValue(reply({ cancelled: true }));
  const failure = expect(postSlideRequest("/api/slides", body, new AbortController().signal)).rejects.toThrow("Provider could not complete");
  await vi.advanceTimersByTimeAsync(30_000); await failure;
  expect(calls().filter(call => !call.body.operation)).toHaveLength(2);
});

it("cancels an accepted job once when the user aborts during a polling wait", async () => {
  fetchMock.mockResolvedValueOnce(pending()).mockResolvedValue(reply({ cancelled: true }));
  const controller = new AbortController();
  const failure = expect(postSlideRequest("/api/slides", body, controller.signal)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0); controller.abort();
  await failure; await vi.advanceTimersByTimeAsync(30_000);
  expect(calls()).toHaveLength(2);
  expect(calls()[1].body).toEqual({ classId: body.classId, assignmentId: body.assignmentId, jobId: "job-a", operation: "cancel" });
  expect(calls()[1].signal.aborted).toBe(false); expect(calls()[1].keepalive).toBe(true);
});

it("captures and cancels an accepted ticket that arrives after cancellation", async () => {
  let resolve: (value: unknown) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise(finish => { resolve = finish; })).mockResolvedValue(reply({ cancelled: true }));
  const controller = new AbortController();
  const failure = expect(postSlideRequest("/api/slides", body, controller.signal)).rejects.toThrow();
  controller.abort(); resolve(pending());
  await failure;
  expect(calls()[1].body.operation).toBe("cancel");
  expect(calls()).toHaveLength(2);
});

it("bounds consecutive transient poll failures and best-effort cancels the old job", async () => {
  fetchMock.mockResolvedValueOnce(pending()).mockImplementation(async (_path, init) => JSON.parse(init.body).operation === "cancel"
    ? reply({ cancelled: true }) : reply({ error: "Gateway unavailable" }, 503));
  const failure = expect(postSlideRequest("/api/slides", body, new AbortController().signal)).rejects.toThrow("Gateway unavailable");
  await vi.advanceTimersByTimeAsync(30_000); await failure;
  expect(calls().filter(call => call.path === "/api/slides")).toHaveLength(1);
  expect(calls().filter(call => call.path === "/api/slides/jobs" && !call.body.operation)).toHaveLength(4);
  expect(calls().at(-1)?.body.operation).toBe("cancel");
});

it("stops a persistently pending job within eight minutes and cancels it", async () => {
  fetchMock.mockImplementation(async (_path, init) => JSON.parse(init.body).operation === "cancel" ? reply({ cancelled: true }) : pending());
  const failure = expect(postSlideRequest("/api/slides", body, new AbortController().signal)).rejects.toThrow("took too long");
  await vi.advanceTimersByTimeAsync(8 * 60_000); await failure;
  expect(calls().filter(call => call.path === "/api/slides")).toHaveLength(1);
  expect(calls().at(-1)?.body.operation).toBe("cancel");
});

it("never automatically resubmits an ambiguous initial network failure", async () => {
  fetchMock.mockRejectedValue(new TypeError("Network failed after server acceptance"));
  await expect(postSlideRequest("/api/slides", body, new AbortController().signal)).rejects.toThrow("connection was interrupted");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("applies a short HTTP deadline to creation without restarting the provider request", async () => {
  fetchMock.mockImplementation((_path, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
  const failure = expect(postSlideRequest("/api/slides", body, new AbortController().signal)).rejects.toThrow("connection timed out");
  await vi.advanceTimersByTimeAsync(25_000); await failure;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

afterEach(clearVerifiedClientAuth);

it("retains the original scoped bearer for polling and cancellation when the active task changes", async () => {
  const host = { ...body, classId: "host-class", assignmentId: "host-task" };
  setVerifiedClientAuth("original-token", host as unknown as EmbeddedUserContext);
  fetchMock.mockResolvedValueOnce(pending()).mockResolvedValueOnce(pending()).mockResolvedValue(reply({ cancelled: true }));
  const controller = new AbortController();
  const failure = expect(postSlideRequest("/api/slides", host, controller.signal)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  setVerifiedClientAuth("other-task-token", { ...host, assignmentId: "other-task" } as unknown as EmbeddedUserContext);
  await vi.advanceTimersByTimeAsync(2000);
  controller.abort(); await failure;
  expect(fetchMock.mock.calls).toHaveLength(3);
  for (const [, init] of fetchMock.mock.calls) {
    expect(init.headers.Authorization).toBe("Bearer original-token");
    expect(JSON.parse(init.body)).toMatchObject({ classId: host.classId, assignmentId: host.assignmentId });
  }
  expect(calls().at(-1)?.body.operation).toBe("cancel");
});

it("never forwards an embedded bearer to native tasks or a remote operation URL", async () => {
  setVerifiedClientAuth("embedded-secret", { classId: "host-class", assignmentId: "host-task" } as unknown as EmbeddedUserContext);
  fetchMock.mockResolvedValue(reply({ issues: [] }));
  await postSlideRequest("/api/slides/check", body, new AbortController().signal);
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  await expect(postSlideRequest("https://other.example/api/slides", body, new AbortController().signal)).rejects.toThrow("Invalid slide operation");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
