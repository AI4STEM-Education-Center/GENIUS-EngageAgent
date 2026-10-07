import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext as EmbeddedUserContext } from "@/lib/auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAX_MATERIAL_FILE_BYTES, uploadMaterialFile } from "@/lib/material-file-client";

const scope = { classId: "ea-class-a", assignmentId: "ea-task-a" };
const blob = new Blob(["<!doctype html><p>Prepared bytes</p>"], { type: "text/html;charset=utf-8" });
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("uploads the exact prepared Blob once with task scope and no JSON/base64 envelope", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: "https://files.example.test/material.html", fileName: "Material.html" }) });
  expect(await uploadMaterialFile(blob, "Material.html", scope)).toEqual({ url: "https://files.example.test/material.html", fileName: "Material.html" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [path, options] = fetchMock.mock.calls[0];
  const query = new URL(path, "https://engage.example.test");
  expect(query.pathname).toBe("/api/material-files");
  expect(Object.fromEntries(query.searchParams)).toEqual({ ...scope, fileName: "Material.html" });
  expect(options).toMatchObject({ method: "POST", headers: { "Content-Type": blob.type }, body: blob, cache: "no-store" });
  expect(options.body).toBe(blob);
});

it("skips upload without authorized workspace context or above the exact raw-byte cap", async () => {
  expect(await uploadMaterialFile(blob, "Material.html")).toBeUndefined();
  expect(await uploadMaterialFile(blob, "Material.html", { classId: scope.classId })).toBeUndefined();
  expect(await uploadMaterialFile(new Blob([new Uint8Array(MAX_MATERIAL_FILE_BYTES + 1)]), "Material.pptx", scope)).toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("uploads exactly 4.4 MB but does not submit a Blob one byte larger", async () => {
  expect(MAX_MATERIAL_FILE_BYTES).toBe(4_400_000);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: "https://files.example.test/material.html", fileName: "Material.html" }) });
  const boundary = new Blob([new Uint8Array(MAX_MATERIAL_FILE_BYTES)], { type: "text/html;charset=utf-8" });
  expect(await uploadMaterialFile(boundary, "Material.html", scope)).toBeDefined();
  expect(fetchMock.mock.calls[0][1].body).toBe(boundary);
  expect(await uploadMaterialFile(new Blob([boundary, "x"], { type: boundary.type }), "Material.html", scope)).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([401, 413, 503])("falls back without retry when the attachment endpoint returns %s", async status => {
  fetchMock.mockResolvedValue({ ok: false, status });
  expect(await uploadMaterialFile(blob, "Material.html", scope)).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([{ url: "javascript:alert(1)", fileName: "Material.html" }, { url: "data:text/html,hello", fileName: "Material.html" }, { url: "https://user:password@example.test/file", fileName: "Material.html" }, {}])("rejects an unusable returned attachment link", async result => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => result });
  expect(await uploadMaterialFile(blob, "Material.html", scope)).toBeUndefined();
});

it("falls back once on connection failure or an upload timeout", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("network failure"));
  expect(await uploadMaterialFile(blob, "Material.html", scope)).toBeUndefined();
  vi.useFakeTimers();
  fetchMock.mockImplementation((_path, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))));
  const pending = uploadMaterialFile(blob, "Material.html", scope);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(await pending).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("propagates explicit cancellation instead of turning it into a stale local download", async () => {
  let finish: (value: unknown) => void = () => {};
  fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = uploadMaterialFile(blob, "Material.html", scope, controller.signal);
  const failure = expect(pending).rejects.toThrow();
  controller.abort();
  finish({ ok: true, json: async () => ({ url: "https://files.example.test/stale", fileName: "Material.html" }) });
  await failure;
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});

afterEach(clearVerifiedClientAuth);

it("authorizes scoped GENIUS uploads without placing the bearer in the downloadable URL", async () => {
  const host = { classId: "host-class", assignmentId: "host-task" };
  setVerifiedClientAuth("file-token", host as EmbeddedUserContext);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: "https://files.example.test/material.html", fileName: "Material.html" }) });
  const result = await uploadMaterialFile(new Blob(["file"], { type: "text/html" }), "Material.html", host);
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer file-token");
  expect(fetchMock.mock.calls[0][0]).not.toContain("file-token");
  expect(result?.url).not.toContain("file-token");
});
