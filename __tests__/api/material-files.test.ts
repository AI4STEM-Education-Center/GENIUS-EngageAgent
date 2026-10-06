import { afterEach, beforeEach, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
const mocks = vi.hoisted(() => ({ session: vi.fn(), context: vi.fn(), send: vi.fn(), sign: vi.fn(), client: vi.fn(), destroy: vi.fn() }));
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: (request: Request) => request.headers.get("origin") === "https://engage.test" }));
vi.mock("@/lib/workspace", async original => ({ ...await original<object>(), workspaceContext: mocks.context }));
vi.mock("@aws-sdk/client-s3", async original => ({ ...await original<object>(), S3Client: class {
  constructor(options: unknown) { mocks.client(options); }
  send = mocks.send;
  destroy = mocks.destroy;
} }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
import { POST } from "@/app/api/material-files/route";
import { MAX_MATERIAL_FILE_BYTES, MATERIAL_FILE_URL_SECONDS, PPTX_CONTENT_TYPE } from "@/lib/material-files";
import { buildStudentMaterialHtml } from "@/lib/material-export";
import { WorkspaceError } from "@/lib/workspace";

const context = { classId: "ea-class-files", assignmentId: "ea-task-files" };
const html = buildStudentMaterialHtml({ id: "generated", type: "phenomenon", strategy: "cognitive conflict", title: "A bounce", body: "Write your question." }, "data:image/png;base64,aGVsbG8=");
const request = (body: BodyInit = html, options: { fileName?: string; contentType?: string; origin?: string; extra?: Record<string, string>; headers?: Record<string, string> } = {}) => {
  const params = new URLSearchParams({ ...context, fileName: options.fileName ?? "A-bounce.html", ...options.extra });
  return new Request(`https://engage.test/api/material-files?${params}`, { method: "POST", headers: {
    origin: options.origin ?? "https://engage.test", "content-type": options.contentType ?? "text/html;charset=utf-8", ...options.headers,
  }, body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);
};
async function pptx(extra: Record<string, string> = {}) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries({ "[Content_Types].xml": "<Types/>", "_rels/.rels": "<Relationships/>", "ppt/presentation.xml": "<p:presentation/>", "ppt/slides/slide1.xml": "<p:sld/>", ...extra })) zip.file(name, value);
  return new Uint8Array(await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ geniusId: "teacher-a", role: "teacher" });
  mocks.context.mockResolvedValue({}); mocks.send.mockResolvedValue({});
  mocks.sign.mockResolvedValue("https://test-private.s3.us-east-2.amazonaws.com/material-files/file?X-Amz-Signature=test");
  vi.stubEnv("ENGAGE_S3_BUCKET", "test-private"); vi.stubEnv("ENGAGE_AWS_REGION", "us-east-2");
  vi.stubEnv("ENGAGE_AWS_ACCESS_KEY_ID", "test-access"); vi.stubEnv("ENGAGE_AWS_SECRET_ACCESS_KEY", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

it("stores exact generated HTML bytes privately and signs an attachment-only HTTPS download for ten minutes", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ url: "https://test-private.s3.us-east-2.amazonaws.com/material-files/file?X-Amz-Signature=test", fileName: "A-bounce.html" });
  expect(mocks.context).toHaveBeenCalledWith({ geniusId: "teacher-a", role: "teacher" }, context.classId, context.assignmentId);
  const upload = mocks.send.mock.calls[0][0] as PutObjectCommand;
  expect(upload).toBeInstanceOf(PutObjectCommand);
  expect(upload.input).toMatchObject({ Bucket: "test-private", ContentType: "application/octet-stream", ContentLength: Buffer.byteLength(html),
    ContentDisposition: 'attachment; filename="A-bounce.html"', CacheControl: "private, no-store" });
  expect(Buffer.from(upload.input.Body as Uint8Array).toString("utf8")).toBe(html);
  expect(upload.input.Key).toMatch(/^material-files\/[a-f0-9]{64}\/[a-f0-9-]{36}\.html$/);
  expect(upload.input.ACL).toBeUndefined();
  const signed = mocks.sign.mock.calls[0][1] as GetObjectCommand;
  expect(signed).toBeInstanceOf(GetObjectCommand);
  expect(signed.input).toMatchObject({ Key: upload.input.Key, Bucket: "test-private", ResponseContentType: "application/octet-stream",
    ResponseContentDisposition: 'attachment; filename="A-bounce.html"', ResponseCacheControl: "private, no-store" });
  expect(mocks.sign.mock.calls[0][2]).toEqual({ expiresIn: MATERIAL_FILE_URL_SECONDS });
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it("accepts bounded native PowerPoint ZIP bytes without changing the package", async () => {
  const bytes = await pptx();
  expect((await POST(request(bytes, { fileName: "Lesson-3.pptx", contentType: PPTX_CONTENT_TYPE }))).status).toBe(200);
  const input = (mocks.send.mock.calls[0][0] as PutObjectCommand).input;
  expect(input.ContentType).toBe(PPTX_CONTENT_TYPE);
  expect(Buffer.from(input.Body as Uint8Array)).toEqual(Buffer.from(bytes));
});

it.each([null, { geniusId: "student", role: "student" }])("denies unauthenticated/student uploads before reading file bytes", async user => {
  mocks.session.mockResolvedValue(user);
  const upload = request(); const read = vi.spyOn(upload.body!, "getReader");
  expect([401, 403]).toContain((await POST(upload)).status);
  expect(read).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
});

it("enforces same-origin writes and task ownership", async () => {
  expect((await POST(request(html, { origin: "https://attacker.test" }))).status).toBe(403);
  mocks.context.mockRejectedValueOnce(new WorkspaceError("Task not found", 404));
  expect((await POST(request())).status).toBe(404);
  expect(mocks.send).not.toHaveBeenCalled();
});

it("rejects excess declared size and stops an oversized stream before storing it", async () => {
  const declared = request(html, { headers: { "content-length": String(MAX_MATERIAL_FILE_BYTES + 1) } });
  const read = vi.spyOn(declared.body!, "getReader");
  expect((await POST(declared)).status).toBe(413); expect(read).not.toHaveBeenCalled();
  const cancel = vi.fn(); let chunks = 0;
  const stream = new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(1_000_000)); }, cancel });
  expect((await POST(request(stream))).status).toBe(413);
  expect(cancel).toHaveBeenCalledOnce(); expect(chunks).toBeLessThanOrEqual(6);
  expect(mocks.send).not.toHaveBeenCalled();
});

it("rejects arbitrary destinations, filename header injection and mismatched content types", async () => {
  const invalid: NonNullable<Parameters<typeof request>[1]>[] = [
    { extra: { url: "https://attacker.test/file" } }, { extra: { bucket: "public" } }, { extra: { key: "chosen/path" } },
    { fileName: "x\r\nSet-Cookie:bad.html" }, { fileName: "../x.html" }, { fileName: "x.pptx" },
    { contentType: "application/javascript" }, { headers: { "content-encoding": "gzip" } },
  ];
  for (const options of invalid) expect((await POST(request(html, options))).status).toBeGreaterThanOrEqual(400);
  expect(mocks.send).not.toHaveBeenCalled();
});

it("rejects empty, foreign HTML, malformed UTF-8, incomplete ZIP and macro packages", async () => {
  for (const bytes of ["", "<html><script>alert(1)</script></html>", new Uint8Array([0xff, 0xfe])]) {
    expect((await POST(request(bytes))).status).toBe(422);
  }
  const incomplete = new JSZip(); incomplete.file("notes.txt", "not a PPTX");
  for (const bytes of [new Uint8Array([0x50, 0x4b, 0x03, 0x04]), new Uint8Array(await incomplete.generateAsync({ type: "arraybuffer" })), await pptx({ "ppt/vbaProject.bin": "macro" })]) {
    expect((await POST(request(bytes, { fileName: "x.pptx", contentType: PPTX_CONTENT_TYPE }))).status).toBe(422);
  }
  expect(mocks.send).not.toHaveBeenCalled();
});

it("fails closed without S3 and offers the local fallback without leaking backend details", async () => {
  vi.stubEnv("ENGAGE_S3_BUCKET", "");
  const missing = await POST(request()); expect(missing.status).toBe(503);
  expect((await missing.json()).error).toContain("local save link"); expect(mocks.send).not.toHaveBeenCalled();
  vi.stubEnv("ENGAGE_S3_BUCKET", "test-private"); mocks.send.mockRejectedValueOnce(new Error("Secret internal bucket details"));
  const unavailable = await POST(request()); expect(unavailable.status).toBe(503);
  expect(JSON.stringify(await unavailable.json())).not.toContain("Secret internal");
  expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.destroy).toHaveBeenCalledOnce();
});
