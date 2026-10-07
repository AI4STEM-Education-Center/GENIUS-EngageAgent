import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SignJWT } from "jose";
import JSZip from "jszip";
import { slideFixture, tinyImage } from "../fixtures/slides";
const mocks = vi.hoisted(() => ({ s3: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: (request: Request) => request.headers.get("origin") === "http://localhost:3104" }));
vi.mock("@aws-sdk/client-s3", async original => ({ ...await original<object>(), S3Client: class { constructor() { mocks.s3(); throw new Error("AWS must not be used in local storage tests"); } } }));
const context = { classId: "genius-local-course", assignmentId: "genius-local-task" };
const origin = "http://localhost:3104";
const secret = "local-storage-test-secret-not-a-real-credential";
let directory: string;
const token = (role = "teacher") => new SignJWT({ ...context, sub: `local-${role}`, role, aud: "engageagent-embed" })
  .setProtectedHeader({ alg: "HS256" }).setIssuer("genius-learning-platform").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
const post = (endpoint: string, bearer: string, body: object) => new Request(`${origin}${endpoint}`, { method: "POST",
  headers: { origin, authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ ...context, ...body }) });
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "engage-local-materials-"));
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("ENGAGE_LOCAL_MATERIAL_STORAGE", "1"); vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", directory);
  vi.stubEnv("ENGAGE_APP_URL", origin); vi.stubEnv("DYNAMODB_TABLE", ""); vi.stubEnv("ENGAGE_S3_BUCKET", ""); vi.stubEnv("SSO_SECRET", secret); vi.stubEnv("SSO_FALLBACK_SECRET", "");
  mocks.session.mockResolvedValue(null);
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

it("publishes and reads real local files through the unchanged signed teacher/student workflow without AWS", async () => {
  const publication = await import("@/app/api/slides/publication/route");
  const localAsset = await import("@/app/api/local-material-assets/route");
  const { isPublishedSlideResponse } = await import("@/lib/slides/publication");
  const bearer = await token();
  const start = await publication.POST(post("/api/slides/publication", bearer, { operation: "start", deckId: "local-deck", lessonNumber: 3,
    strategy: "cognitive conflict", draft: slideFixture("cognitive conflict"), assets: { evidence: { width: 1, height: 1 } } }));
  expect(start.status).toBe(200); const id = (await start.json()).publicationId;
  expect((await publication.POST(post("/api/slides/publication", bearer, { operation: "asset", publicationId: id,
    visualId: "evidence", asset: { data: tinyImage, width: 1, height: 1 } }))).status).toBe(200);
  expect((await publication.POST(post("/api/slides/publication", bearer, { operation: "commit", publicationId: id }))).status).toBe(200);
  const read = await publication.GET(new Request(`${origin}/api/slides/publication?${new URLSearchParams({ ...context, publicationId: id })}`,
    { headers: { authorization: `Bearer ${await token("student")}` } }));
  expect(read.status).toBe(200); const result = await read.json(); expect(isPublishedSlideResponse(result)).toBe(true);
  const url = result.assets.evidence.url as string;
  expect(url).toMatch(/^\/api\/local-material-assets\?ticket=/);
  const image = await localAsset.GET(new Request(`${origin}${url}`));
  expect(image.status).toBe(200); expect(image.headers.get("content-type")).toBe("image/png"); expect(image.headers.get("cache-control")).toBe("private, no-store");
  expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from(tinyImage.split(",")[1], "base64"));
  expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(["workspace.json", "engage-nosql.json", "material-assets"]));
  const [assetName] = await fs.readdir(path.join(directory, "material-assets"));
  expect(assetName).toMatch(/^[a-f0-9]{64}\.bin$/); expect((await fs.stat(path.join(directory, "material-assets", assetName))).mode & 0o777).toBe(0o600);
  expect(mocks.s3).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
});

it("serves exact validated PPTX bytes as an expiring attachment capability after teacher authorization", async () => {
  const files = await import("@/app/api/material-files/route"); const local = await import("@/app/api/local-material-assets/route");
  const zip = new JSZip(); for (const name of ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/slides/slide1.xml"]) zip.file(name, "<test/>");
  const bytes = new Uint8Array(await zip.generateAsync({ type: "arraybuffer" }));
  const { PPTX_CONTENT_TYPE } = await import("@/lib/material-files");
  const upload = (bearer: string) => new Request(`${origin}/api/material-files?${new URLSearchParams({ ...context, fileName: "Local lesson.pptx" })}`, {
    method: "POST", headers: { origin, authorization: `Bearer ${bearer}`, "content-type": PPTX_CONTENT_TYPE }, body: bytes,
  });
  expect((await files.POST(upload(await token("student")))).status).toBe(403);
  expect(await fs.readdir(directory)).toEqual([]);
  const response = await files.POST(upload(await token())); expect(response.status).toBe(200);
  const result = await response.json(); const request = new Request(`${origin}${result.url}`);
  const download = await local.GET(request); expect(download.status).toBe(200);
  expect(download.headers.get("content-disposition")).toBe('attachment; filename="Local lesson.pptx"');
  expect(Buffer.from(await download.arrayBuffer())).toEqual(Buffer.from(bytes));
  const badUrl = new URL(request.url); const ticket = badUrl.searchParams.get("ticket")!;
  badUrl.searchParams.set("ticket", ticket.replace(/^./, ticket[0] === "a" ? "b" : "a"));
  expect((await local.GET(new Request(badUrl))).status).toBe(404);
  expect((await local.GET(new Request(`${request.url}&ticket=duplicate`))).status).toBe(404);
  expect((await local.GET(new Request(request.url.replace(origin, "http://localhost:9999")))).status).toBe(404);
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 601_000);
  expect((await local.GET(request)).status).toBe(404);
  expect(mocks.s3).not.toHaveBeenCalled();
});

it.each([
  ["production", "NODE_ENV", "production"], ["DynamoDB configured", "DYNAMODB_TABLE", "must-not-touch"],
  ["S3 configured", "ENGAGE_S3_BUCKET", "must-not-touch"], ["nonlocal origin", "ENGAGE_APP_URL", "https://engage.example.com"],
])("fails closed for %s even when local storage is explicitly requested", async (_name, variable, value) => {
  vi.stubEnv(variable, value);
  const { storeLocalMaterial } = await import("@/lib/local-material-storage");
  const { GET } = await import("@/app/api/local-material-assets/route");
  await expect(storeLocalMaterial("internal-key", Buffer.from("bytes"))).rejects.toThrow();
  expect((await GET(new Request(`${origin}/api/local-material-assets?ticket=invalid`))).status).toBe(404);
  expect(await fs.readdir(directory)).toEqual([]); expect(mocks.s3).not.toHaveBeenCalled();
});

it("requires explicit opt-in and refuses path/URL injection or generic SSO tokens on the local asset route", async () => {
  const local = await import("@/app/api/local-material-assets/route");
  for (const ticket of [await token(), "../../workspace.json", "file:///etc/passwd"]) {
    expect((await local.GET(new Request(`${origin}/api/local-material-assets?${new URLSearchParams({ ticket })}`))).status).toBe(404);
  }
  const { storeLocalMaterial, localMaterialUrl } = await import("@/lib/local-material-storage");
  await storeLocalMaterial("safe-storage-key", Buffer.from("original"));
  await storeLocalMaterial("safe-storage-key", Buffer.from("original"));
  await expect(storeLocalMaterial("safe-storage-key", Buffer.from("replacement"))).rejects.toThrow();
  const url = await localMaterialUrl("safe-storage-key", "image/png");
  vi.stubEnv("ENGAGE_LOCAL_MATERIAL_STORAGE", "");
  expect((await local.GET(new Request(`${origin}${url}`))).status).toBe(404);
});
