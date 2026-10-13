import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), local: vi.fn() }));
vi.mock("node:dns", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("@/lib/local-material-storage", () => ({ readLocalMaterial: mocks.local }));
import { GET } from "@/app/api/download/route";

type Upstream = { status?: number; headers?: Record<string, string>; body?: string };
let replies: Upstream[];
const download = (url: string, filename = "lesson.pptx") => GET(new NextRequest(`https://engage.test/api/download?${new URLSearchParams({ url, filename })}`));
beforeEach(() => {
  vi.clearAllMocks(); replies = [{ body: "file-bytes" }];
  mocks.lookup.mockImplementation((_hostname, _options, callback) => callback(null, [{ address: "8.8.8.8", family: 4 }]));
  mocks.request.mockImplementation((url, options, callback) => {
    const outgoing = new EventEmitter() as EventEmitter & { setTimeout: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; end: () => void };
    outgoing.setTimeout = vi.fn(); outgoing.destroy = vi.fn(error => outgoing.emit("error", error));
    outgoing.end = () => options.lookup(url.hostname, { all: true }, (error: Error | null) => {
      if (error) { outgoing.emit("error", error); return; }
      const reply = replies.shift() || {};
      const upstream = Object.assign(new PassThrough(), { statusCode: reply.status ?? 200, headers: reply.headers ?? { "content-type": "application/octet-stream" } });
      callback(upstream); upstream.end(reply.body ?? "file-bytes");
    });
    return outgoing;
  });
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["https://private-bucket.s3.us-east-2.amazonaws.com/slides/deck?X-Amz-Signature=signed", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["https://images.example.com/lesson.png", "image/png"],
  ["https://videos.example.com/lesson.mp4", "video/mp4"],
])("streams a legitimate HTTPS material without changing its bytes: %s", async (url, mime) => {
  replies = [{ headers: { "content-type": mime }, body: "exact bytes" }];
  const response = await download(url);
  expect(response.status).toBe(200); expect(await response.text()).toBe("exact bytes");
  expect(response.headers.get("content-type")).toBe(mime);
  expect(response.headers.get("content-disposition")).toContain('attachment; filename="lesson.pptx"');
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(mocks.request.mock.calls[0][0].href).toBe(url);
  expect(mocks.request.mock.calls[0][1]).toMatchObject({ agent: false, lookup: expect.any(Function), headers: { "Accept-Encoding": "identity" } });
});

it.each([
  "http://example.com/file", "file:///etc/passwd", "data:text/plain,secret", "https://localhost/file", "https://app.internal/file",
  "https://127.0.0.1/file", "https://2130706433/file", "https://0x7f000001/file", "https://10.2.3.4/file", "https://172.16.0.1/file",
  "https://192.168.1.1/file", "https://169.254.169.254/latest/meta-data", "https://100.64.0.1/file", "https://[::1]/file",
  "https://[::ffff:127.0.0.1]/file", "https://[fd00::1]/file", "https://[2002:7f00:1::]/file", "https://user:password@example.com/file",
  "https://example.com:8443/file", "//example.com/file",
])("blocks unsafe URL before opening a connection: %s", async url => {
  expect((await download(url)).status).toBeGreaterThanOrEqual(400);
  expect(mocks.request).not.toHaveBeenCalled();
});

it.each(["127.0.0.1", "169.254.169.254", "192.168.0.2", "::ffff:10.0.0.1", "fe80::1", "2001:db8::1"])("blocks public hostnames that actually resolve to %s", async address => {
  mocks.lookup.mockImplementation((_hostname, _options, callback) => callback(null, [{ address, family: address.includes(":") ? 6 : 4 }]));
  expect((await download("https://otherwise-public.example/file")).status).toBe(403);
  expect(mocks.lookup).toHaveBeenCalledOnce();
});

it("rejects a mixed public/private DNS answer in the actual connection lookup", async () => {
  mocks.lookup.mockImplementation((_hostname, _options, callback) => callback(null, [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]));
  expect((await download("https://rebind.example/file")).status).toBe(403);
  expect(mocks.lookup).toHaveBeenCalledOnce();
});

it("permits a globally routable IPv6 DNS result", async () => {
  mocks.lookup.mockImplementation((_hostname, _options, callback) => callback(null, [{ address: "2606:4700:4700::1111", family: 6 }]));
  const response = await download("https://cdn.example.com/file");
  expect(response.status).toBe(200); expect(await response.text()).toBe("file-bytes");
});

it("follows bounded HTTPS redirects and validates each new destination", async () => {
  replies = [{ status: 302, headers: { location: "https://cdn.example.com/final" } }, { body: "redirected bytes" }];
  const response = await download("https://images.example.com/start");
  expect(response.status).toBe(200); expect(await response.text()).toBe("redirected bytes");
  expect(mocks.lookup).toHaveBeenCalledTimes(2);
  replies = [{ status: 302, headers: { location: "https://169.254.169.254/private" } }];
  mocks.request.mockClear();
  expect((await download("https://images.example.com/start")).status).toBe(403);
  expect(mocks.request).toHaveBeenCalledOnce();
});

it("does not follow redirects to a private DNS resolution or an endless chain", async () => {
  replies = [{ status: 302, headers: { location: "https://private.example.com/final" } }];
  mocks.lookup.mockImplementation((host, _options, callback) => callback(null, [{ address: host === "private.example.com" ? "10.0.0.1" : "8.8.8.8", family: 4 }]));
  expect((await download("https://public.example.com/start")).status).toBe(403);
  replies = Array.from({ length: 5 }, () => ({ status: 302, headers: { location: "/again" } }));
  mocks.request.mockClear();
  expect((await download("https://public.example.com/start")).status).toBe(502);
  expect(mocks.request).toHaveBeenCalledTimes(4);
});

it.each(["x\r\nSet-Cookie: bad", 'x".png', "../image.png", "", "a".repeat(181)])("rejects invalid filename before fetching: %s", async filename => {
  expect((await download("https://cdn.example.com/file", filename)).status).toBe(400);
  expect(mocks.request).not.toHaveBeenCalled();
});

it("supports Chinese filenames using the encoded attachment parameter", async () => {
  const response = await download("https://cdn.example.com/file", "科学材料.pptx");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''%E7%A7%91%E5%AD%A6%E6%9D%90%E6%96%99.pptx");
  await response.text();
});

it("rejects oversized declared payloads and upstream errors", async () => {
  replies = [{ headers: { "content-length": String(128 * 1024 * 1024 + 1) } }];
  expect((await download("https://cdn.example.com/file")).status).toBe(413);
  replies = [{ status: 404 }]; expect((await download("https://cdn.example.com/file")).status).toBe(502);
});

it("keeps signed local development downloads on their verifier without fetching localhost", async () => {
  vi.stubEnv("NODE_ENV", "development");
  mocks.local.mockResolvedValue({ bytes: Buffer.from("local bytes"), mime: "image/png" });
  const response = await download("/api/local-material-assets?ticket=header.payload.signature");
  expect(response.status).toBe(200); expect(await response.text()).toBe("local bytes");
  expect(mocks.local).toHaveBeenCalledOnce(); expect(mocks.request).not.toHaveBeenCalled();
  vi.stubEnv("NODE_ENV", "production");
  expect((await download("/api/local-material-assets?ticket=header.payload.signature")).status).toBe(400);
});
