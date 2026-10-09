import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import JSZip from "jszip";
const mocks = vi.hoisted(() => ({ session: vi.fn(), context: vi.fn(), answers: vi.fn(), create: vi.fn(), retrieve: vi.fn(), cancel: vi.fn(),
  get: vi.fn(), put: vi.fn(), published: vi.fn(), upsert: vi.fn(), send: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: (r: Request) => r.headers.get("origin") === "https://engage.test" }));
vi.mock("@/lib/workspace", async original => ({ ...await original<object>(), workspaceContext: mocks.context }));
vi.mock("@/lib/workspace-store", () => ({ workspaceGet: mocks.get, workspacePut: mocks.put }));
vi.mock("@/lib/nosql", () => ({ listStudentAnswers: mocks.answers, listPublishedContent: mocks.published, upsertContentPublish: mocks.upsert }));
vi.mock("openai", () => ({ default: class { responses = { create: mocks.create, retrieve: mocks.retrieve, cancel: mocks.cancel }; } }));
vi.mock("@aws-sdk/client-s3", async original => ({ ...await original<object>(), S3Client: class { send = mocks.send; destroy() {} } }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
import { GET as catalog, POST as generate } from "@/app/api/slides/route";
import { POST as jobs } from "@/app/api/slides/jobs/route";
import { POST as image } from "@/app/api/slides/image/route";
import { POST as check } from "@/app/api/slides/check/route";
import { GET as read, POST as publish } from "@/app/api/slides/publication/route";
import { POST as materialFile } from "@/app/api/material-files/route";
import { PPTX_CONTENT_TYPE } from "@/lib/material-files";
import { SSO_ISSUER } from "@/lib/auth";
import { slideFixture, tinyImage } from "../fixtures/slides";
import { WorkspaceError } from "@/lib/workspace";

const context = { classId: "genius-class-47", assignmentId: "genius-assignment-12" };
const native = { classId: "ea-class-native", assignmentId: "ea-task-native" };
const teacher = { geniusId: "standalone-teacher", userId: "standalone-teacher", name: "Teacher", email: null, role: "teacher" };
const secret = "embedded-test-only-secret-not-a-real-credential";
const records = new Map<string, Record<string, unknown>>();
const contents = new Map<string, Record<string, unknown>>();
const draft = () => slideFixture("cognitive conflict");
const base = () => ({ ...context, lessonNumber: 3, strategy: "cognitive conflict" });
const startBody = () => ({ ...base(), operation: "start", deckId: "embedded-deck", draft: draft(), assets: { evidence: { width: 1, height: 1 } } });
const token = async (claims: Record<string, unknown> = {}, signingSecret = secret, issuer = SSO_ISSUER) => new SignJWT({
  sub: "embedded-teacher", role: "teacher", name: "GENIUS Teacher", aud: "engageagent-embed", ...context, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims,
}).setProtectedHeader({ alg: "HS256" }).setIssuer(issuer).sign(new TextEncoder().encode(signingSecret));
const request = (path: string, bearer: string | undefined, body?: object, origin = "https://engage.test") => new Request(`https://engage.test${path}`, {
  ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), headers: { origin, "Content-Type": "application/json", ...(bearer !== undefined ? { authorization: `Bearer ${bearer}` } : {}) },
});
const lookup = (bearer: string | undefined, publicationId: string, scope = context) => read(request(`/api/slides/publication?${new URLSearchParams({ ...scope, publicationId })}`, bearer));
const start = async (bearer: string) => {
  const response = await publish(request("/api/slides/publication", bearer, startBody()));
  expect(response.status).toBe(200); return (await response.json()).publicationId as string;
};
const upload = (bearer: string, id: string) => publish(request("/api/slides/publication", bearer, { ...context, operation: "asset", publicationId: id, visualId: "evidence", asset: { data: tinyImage, width: 1, height: 1 } }));
const commit = (bearer: string, id: string) => publish(request("/api/slides/publication", bearer, { ...context, operation: "commit", publicationId: id }));
const completePublication = async (bearer: string) => { const id = await start(bearer); expect((await upload(bearer, id)).status).toBe(200); expect((await commit(bearer, id)).status).toBe(200); return id; };
const fileRequest = (bearer: string | undefined, bytes: Uint8Array, scope = context) => new Request(`https://engage.test/api/material-files?${new URLSearchParams({ ...scope, fileName: "Lesson.pptx" })}`, {
  method: "POST", headers: { origin: "https://engage.test", "content-type": PPTX_CONTENT_TYPE, ...(bearer !== undefined ? { authorization: `Bearer ${bearer}` } : {}) }, body: bytes as BodyInit,
});
async function pptx() {
  const zip = new JSZip();
  for (const part of ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/slides/slide1.xml"]) zip.file(part, "<test/>");
  return new Uint8Array(await zip.generateAsync({ type: "arraybuffer" }));
}
beforeEach(() => {
  vi.clearAllMocks(); records.clear(); contents.clear();
  vi.stubEnv("SSO_SECRET", secret); vi.stubEnv("SSO_FALLBACK_SECRET", ""); vi.stubEnv("OPENAI_API_KEY", "test-provider-key"); vi.stubEnv("ENGAGE_S3_BUCKET", "private-test");
  mocks.session.mockResolvedValue(null); mocks.context.mockResolvedValue({}); mocks.answers.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "provider-private-response", status: "queued" }); mocks.retrieve.mockResolvedValue({ status: "in_progress" });
  mocks.send.mockResolvedValue({}); mocks.sign.mockResolvedValue("https://private.example.test/signed-material");
  mocks.get.mockImplementation(async (partition, key) => records.get(`${partition}/${key}`) ?? null);
  mocks.put.mockImplementation(async rows => { for (const row of rows) records.set(`${row.partition}/${row.key}`, structuredClone(row.value)); });
  mocks.published.mockImplementation(async () => [...contents.values()]);
  mocks.upsert.mockImplementation(async row => { contents.set(row.content_item_id, structuredClone(row)); return row; });
});
afterEach(() => vi.unstubAllEnvs());

describe("GENIUS embedded slide requests with genuine signed JWTs and no application cookie", () => {
  it("loads catalog, generates, polls, and cancels an owner-bound job using only the signed host identity", async () => {
    const bearer = await token();
    const catalogResponse = await catalog(request(`/api/slides?${new URLSearchParams(context)}`, bearer));
    expect(catalogResponse.status).toBe(200); expect(catalogResponse.headers.get("set-cookie")).toBeNull();
    const created = await generate(request("/api/slides", bearer, base()));
    expect(created.status).toBe(202); const id = (await created.json()).job.id;
    const stored = records.get(`SLIDE_JOBS#embedded-teacher/JOB#${id}`)!;
    expect(stored).toMatchObject({ ...context, ownerId: "embedded-teacher" });
    expect(JSON.stringify(stored)).not.toContain(bearer);
    expect(mocks.answers).toHaveBeenCalledWith(context.classId, context.assignmentId);
    const response = await jobs(request("/api/slides/jobs", bearer, { ...context, jobId: id }));
    expect(response.status).toBe(202);
    expect((await jobs(request("/api/slides/jobs", bearer, { ...context, jobId: id, operation: "cancel" }))).status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith("provider-private-response", { timeout: 10_000 });
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
  });

  it("stages, uploads, commits and reads a student-safe publication in the exact GENIUS assignment", async () => {
    const bearer = await token(); const id = await completePublication(bearer);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ class_id: context.classId, assignment_id: context.assignmentId, published_by: "embedded-teacher" }));
    for (const role of ["teacher", "student", "guest"]) {
      const result = await lookup(await token({ role, sub: `${role}-reader` }), id);
      expect(result.status).toBe(200); expect(result.headers.get("set-cookie")).toBeNull();
      const data = await result.json(); expect(data.manifest.pages).toHaveLength(5);
      expect(JSON.stringify(data)).not.toMatch(/teacherNotes|ownerId|sourcePrompt|imagePrompt/);
    }
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
  });

  it("hosts a prepared PPTX for an embedded teacher without reading a standalone session", async () => {
    const bytes = await pptx(); const response = await materialFile(fileRequest(await token(), bytes));
    expect(response.status).toBe(200); expect((await response.json()).url).toMatch(/^https:/);
    expect(mocks.send).toHaveBeenCalledOnce(); expect(mocks.session).not.toHaveBeenCalled();
    expect(Buffer.from(mocks.send.mock.calls[0][0].input.Body)).toEqual(Buffer.from(bytes));
  });

  it.each(["student", "guest"])("allows %s read-only access but blocks every slide mutation and upload", async role => {
    const bearer = await token({ role });
    for (const [handler, path, body] of [
      [generate, "/api/slides", base()], [check, "/api/slides/check", { ...base(), draft: draft() }],
      [image, "/api/slides/image", { ...base(), draft: draft(), visualId: "evidence" }],
      [jobs, "/api/slides/jobs", { ...context, jobId: "00000000-0000-4000-8000-000000000000" }],
      [publish, "/api/slides/publication", startBody()],
    ] as const) expect((await handler(request(path, bearer, body))).status).toBe(403);
    const file = fileRequest(bearer, await pptx()); const readBytes = vi.spyOn(file.body!, "getReader");
    expect((await materialFile(file)).status).toBe(403); expect(readBytes).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.answers).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong class", { classId: "other-class" }], ["wrong assignment", { assignmentId: "other-task" }],
    ["missing class", { classId: undefined }], ["missing assignment", { assignmentId: undefined }],
    ["taskId is not assignmentId", { assignmentId: undefined, taskId: context.assignmentId }],
  ])("rejects signed %s before touching diagnostics, jobs, or publication storage", async (_name, claims) => {
    const bearer = await token(claims); mocks.session.mockResolvedValue(teacher);
    expect((await generate(request("/api/slides", bearer, base()))).status).toBe(403);
    expect((await publish(request("/api/slides/publication", bearer, startBody()))).status).toBe(403);
    expect((await lookup(bearer, "00000000-0000-4000-8000-000000000000")).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.answers).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", { exp: Math.floor(Date.now() / 1000) - 1 }], ["missing expiry", { exp: undefined }],
    ["missing issue time", { iat: undefined }], ["future issue time", { iat: Math.floor(Date.now() / 1000) + 120 }],
    ["invalid identity", { sub: { id: "forged" } }], ["missing identity", { sub: undefined }], ["invalid role", { role: "admin" }],
  ])("rejects %s credentials even when a valid unrelated standalone cookie is present", async (_name, claims) => {
    mocks.session.mockResolvedValue(teacher);
    const bearer = await token(claims);
    expect((await generate(request("/api/slides", bearer, base()))).status).toBe(401);
    expect((await lookup(bearer, "00000000-0000-4000-8000-000000000000")).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.answers).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  it("fails closed for forged/malformed Authorization and never accepts a URL token instead", async () => {
    mocks.session.mockResolvedValue(teacher);
    for (const bearer of ["not-a-token", "", await token({}, "wrong-secret")]) {
      expect((await generate(request("/api/slides", bearer, base()))).status).toBe(401);
    }
    const malformed = request("/api/slides", undefined, base()); malformed.headers.set("authorization", "Basic ignored");
    expect((await generate(malformed)).status).toBe(401); expect(mocks.session).not.toHaveBeenCalled();
    expect((await generate(request(`/api/slides?sso_token=${await token()}`, undefined, base()))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined], ["foreign", "another-agent"], ["mixed", ["another-agent", "engageagent-embed"]],
  ])("rejects %s audience at every protected API even with an unrelated teacher cookie", async (_name, aud) => {
    mocks.session.mockResolvedValue(teacher);
    const bearer = await token({ aud });
    const upgradeError = { code: "genius_launch_upgrade_required",
      error: "This GENIUS launch does not support Slides yet. Ask the platform administrator to update the GENIUS integration, then reopen this activity." };
    const result = await catalog(request(`/api/slides?${new URLSearchParams(context)}`, bearer));
    expect(result.status).toBe(401); expect(await result.json()).toEqual(upgradeError);
    for (const [handler, path, body] of [
      [generate, "/api/slides", base()], [check, "/api/slides/check", { ...base(), draft: draft() }],
      [image, "/api/slides/image", { ...base(), draft: draft(), visualId: "evidence" }],
      [jobs, "/api/slides/jobs", { ...context, jobId: "00000000-0000-4000-8000-000000000000" }],
      [publish, "/api/slides/publication", startBody()],
    ] as const) {
      const response = await handler(request(path, bearer, body));
      expect(response.status).toBe(401); expect(await response.json()).toEqual(upgradeError);
    }
    const reading = await lookup(bearer, "00000000-0000-4000-8000-000000000000");
    expect(reading.status).toBe(401); expect(await reading.json()).toEqual(upgradeError);
    const file = fileRequest(bearer, await pptx()); const readBytes = vi.spyOn(file.body!, "getReader");
    const fileResponse = await materialFile(file);
    expect(fileResponse.status).toBe(401); expect(await fileResponse.json()).toEqual(upgradeError); expect(readBytes).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.answers).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.retrieve).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });

  it.each(["expired", "forged", "wrong issuer", "missing expiry", "missing issue time"])("does not diagnose a host upgrade from %s legacy credentials", async reason => {
    mocks.session.mockResolvedValue(teacher);
    const bearer = await token({ aud: undefined,
      ...(reason === "expired" ? { exp: Math.floor(Date.now() / 1000) - 1 } : {}),
      ...(reason === "missing expiry" ? { exp: undefined } : {}),
      ...(reason === "missing issue time" ? { iat: undefined } : {}),
    }, reason === "forged" ? "wrong-secret" : secret, reason === "wrong issuer" ? "another-issuer" : SSO_ISSUER);
    for (const response of [
      await catalog(request(`/api/slides?${new URLSearchParams(context)}`, bearer)),
      await generate(request("/api/slides", bearer, base())),
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Reopen this activity from GENIUS to sign in." });
    }
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.answers).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });

  it("retains same-origin write protection for valid host tokens", async () => {
    const bearer = await token();
    expect((await generate(request("/api/slides", bearer, base(), "https://attacker.test"))).status).toBe(403);
    expect((await publish(request("/api/slides/publication", bearer, startBody(), "https://learn.ai4genius.org"))).status).toBe(403);
    expect(mocks.answers).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });

  it("keeps jobs and staged publications owned by the verified teacher, even with another cookie", async () => {
    const owner = await token(); mocks.session.mockResolvedValue(teacher);
    const generated = await generate(request("/api/slides", owner, base())); const jobId = (await generated.json()).job.id;
    const publicationId = await start(owner); const otherTeacher = await token({ sub: "other-embedded-teacher" });
    for (const operation of [undefined, "cancel"]) expect((await jobs(request("/api/slides/jobs", otherTeacher, { ...context, jobId, operation }))).status).toBe(404);
    expect((await upload(otherTeacher, publicationId)).status).toBe(404); expect((await commit(otherTeacher, publicationId)).status).toBe(404);
    expect(mocks.retrieve).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("does not allow a separately authorized assignment to poll or read another assignment's objects", async () => {
    const owner = await token(); const id = await completePublication(owner);
    const response = await generate(request("/api/slides", owner, base())); const jobId = (await response.json()).job.id;
    const other = { ...context, assignmentId: "other-authorized-assignment" }; const bearer = await token(other);
    expect((await lookup(bearer, id, other)).status).toBe(404);
    expect((await jobs(request("/api/slides/jobs", bearer, { ...other, jobId }))).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("requires a current published reference even for a correctly signed assigned student", async () => {
    const bearer = await token(); const id = await start(bearer); const learner = await token({ role: "student", sub: "student" });
    expect((await lookup(learner, id)).status).toBe(404);
    await upload(bearer, id); await commit(bearer, id); contents.clear();
    expect((await lookup(learner, id)).status).toBe(404); expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("keeps native classes session- and membership-bound; a GENIUS token cannot grant native access", async () => {
    mocks.session.mockResolvedValue(teacher);
    const bearer = await token(native);
    expect((await generate(request("/api/slides", bearer, { ...base(), ...native }))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
    expect((await generate(request("/api/slides", undefined, { ...base(), ...native }))).status).toBe(202);
    expect(mocks.context).toHaveBeenCalledWith(teacher, native.classId, native.assignmentId);
    mocks.context.mockRejectedValueOnce(new WorkspaceError("Not your task", 403));
    expect((await generate(request("/api/slides", undefined, { ...base(), ...native }))).status).toBe(403);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    mocks.session.mockResolvedValue(null);
    expect((await generate(request("/api/slides", undefined, { ...base(), ...native }))).status).toBe(401);
  });
});
