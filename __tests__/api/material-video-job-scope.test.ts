import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), user: vi.fn(), get: vi.fn(), put: vi.fn(), fetch: vi.fn(), saveMedia: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: mocks.guard, workspaceRequestUser: mocks.user }));
vi.mock("@/lib/workspace-store", () => ({ workspaceGet: mocks.get, workspacePut: mocks.put }));
vi.mock("@/lib/nosql", () => ({ getMedia: vi.fn(), upsertMedia: mocks.saveMedia }));
import { POST } from "@/app/api/engagement-video/route";
import { GET } from "@/app/api/engagement-video/status/route";

const scope = { classId: "host-class", assignmentId: "host-task", studentId: "cohort" };
const records = new Map<string, Record<string, unknown>>();
const create = () => POST(new Request("https://engage.test/api/engagement-video", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...scope, item: { id: "item-1", title: "Look closely", body: "Observe" }, imageUrl: "https://private.example/image.webp" }) }));
const poll = (changes = {}) => GET(new NextRequest(`https://engage.test/api/engagement-video/status?${new URLSearchParams({ ...scope, contentItemId: "item-1", requestId: "provider-request-1", ...changes })}`));
beforeEach(() => {
  vi.clearAllMocks(); records.clear(); vi.stubEnv("GROK_API_KEY", "test-provider-key"); vi.stubGlobal("fetch", mocks.fetch);
  mocks.guard.mockResolvedValue(null); mocks.user.mockResolvedValue({ role: "teacher", geniusId: "teacher-1" });
  mocks.put.mockImplementation(async rows => { for (const row of rows) records.set(`${row.partition}/${row.key}`, structuredClone(row.value)); });
  mocks.get.mockImplementation(async (partition, key) => records.get(`${partition}/${key}`) ?? null);
  mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith("/generations") ? { request_id: "provider-request-1" } : { status: "pending" }), { status: 200 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("persists the authorized teacher and full destination before returning the provider ticket", async () => {
  const result = await create(); expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ requestId: "provider-request-1", done: false, contentItemId: "item-1" });
  expect([...records.values()]).toEqual([expect.objectContaining({ ...scope, contentItemId: "item-1", ownerId: "teacher-1", requestId: "provider-request-1" })]);
  expect((await poll()).status).toBe(200);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("rejects another class/task, material, recipient or teacher before polling or saving media", async () => {
  await create(); mocks.fetch.mockClear();
  for (const changes of [{ classId: "other-class" }, { assignmentId: "other-task" }, { contentItemId: "other-item" }, { studentId: "another-student" }, { requestId: "unknown-request" }]) {
    expect((await poll(changes)).status).toBe(404);
  }
  mocks.user.mockResolvedValue({ role: "teacher", geniusId: "another-teacher" });
  expect((await poll()).status).toBe(404);
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.saveMedia).not.toHaveBeenCalled();
});

it("does not accept an unbound legacy request or an expired ownership record", async () => {
  expect((await poll()).status).toBe(404); expect(mocks.fetch).not.toHaveBeenCalled();
  await create(); mocks.fetch.mockClear();
  for (const record of records.values()) record.expiresAt = Math.floor(Date.now() / 1000) - 1;
  expect((await poll()).status).toBe(404); expect(mocks.fetch).not.toHaveBeenCalled();
});

it("never returns an unbound ticket when durable ownership storage fails", async () => {
  mocks.put.mockRejectedValueOnce(new Error("Storage unavailable"));
  const response = await create(); expect(response.status).toBe(500);
  expect(await response.json()).not.toHaveProperty("requestId");
  expect((await poll()).status).toBe(404);
});

it("rejects provider path injection and missing destination identifiers without a provider call", async () => {
  for (const changes of [{ requestId: "../another-provider-route" }, { contentItemId: "" }, { studentId: "" }]) expect((await poll(changes)).status).toBe(400);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
