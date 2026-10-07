import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PutObjectCommand } from "@aws-sdk/client-s3";
const mocks = vi.hoisted(() => ({ session: vi.fn(), context: vi.fn(), get: vi.fn(), put: vi.fn(), published: vi.fn(), upsert: vi.fn(), send: vi.fn(), sign: vi.fn(), destroy: vi.fn() }));
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: (request: Request) => request.headers.get("origin") === "https://engage.test" }));
vi.mock("@/lib/workspace", async original => ({ ...await original<object>(), workspaceContext: mocks.context }));
vi.mock("@/lib/workspace-store", () => ({ workspaceGet: mocks.get, workspacePut: mocks.put }));
vi.mock("@/lib/nosql", () => ({ listPublishedContent: mocks.published, upsertContentPublish: mocks.upsert }));
vi.mock("@aws-sdk/client-s3", async original => ({ ...await original<object>(), S3Client: class { send = mocks.send; destroy = mocks.destroy; } }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
import { GET, POST } from "@/app/api/slides/publication/route";
import { SLIDE_PUBLICATION_STAGE_SECONDS, MAX_SLIDE_PUBLICATION_BYTES } from "@/lib/slides/publish-server";
import { isPublishedSlideResponse } from "@/lib/slides/publication";
import { WorkspaceError } from "@/lib/workspace";
import { deckFixture, tinyImage } from "../fixtures/slides";
import type { ContentPublishRecord } from "@/lib/nosql";

const context = { classId: "ea-class-publication", assignmentId: "ea-task-publication" };
const teacher = { role: "teacher", geniusId: "teacher-owner" };
const student = { role: "student", geniusId: "joined-student" };
const records = new Map<string, { value: Record<string, unknown>; expiresAt?: number }>();
const content = new Map<string, ContentPublishRecord>();
const request = (body: object, origin = "https://engage.test") => new Request("https://engage.test/api/slides/publication", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ ...context, ...body }) });
const read = (id: string, changes = {}) => GET(new Request(`https://engage.test/api/slides/publication?${new URLSearchParams({ ...context, publicationId: id, ...changes })}`));
const startBody = () => {
  const deck = deckFixture("cognitive conflict");
  deck.draft.visuals[0].prompt = "PRIVATE_IMAGE_PROMPT"; deck.draft.slides[0].teacherNotes = ["PRIVATE_TEACHER_NOTES"];
  return { operation: "start", deckId: "stable-deck-id", lessonNumber: 3, strategy: deck.strategy, draft: deck.draft, assets: { evidence: { width: 1, height: 1 } } };
};
const start = async () => {
  const response = await POST(request(startBody())); expect(response.status).toBe(200);
  return (await response.json()).publicationId as string;
};
const asset = (id: string, overrides = {}) => POST(request({ operation: "asset", publicationId: id, visualId: "evidence", asset: { data: tinyImage, width: 1, height: 1 }, ...overrides }));
const commit = (id: string) => POST(request({ operation: "commit", publicationId: id }));
const stored = (id: string) => records.get(`WORKSPACE#${context.classId}/SLIDE_PUBLICATION#${id}`)!;
const published = async () => { const id = await start(); expect((await asset(id)).status).toBe(200); expect((await commit(id)).status).toBe(200); return id; };

beforeEach(() => {
  vi.clearAllMocks(); records.clear(); content.clear(); vi.stubEnv("ENGAGE_S3_BUCKET", "private-test-bucket");
  mocks.session.mockResolvedValue(teacher); mocks.context.mockResolvedValue({}); mocks.send.mockResolvedValue({});
  mocks.sign.mockResolvedValue("https://private.example.test/fresh-image");
  mocks.get.mockImplementation(async (partition, key) => records.get(`${partition}/${key}`)?.value ?? null);
  mocks.put.mockImplementation(async rows => {
    for (const row of rows) if (row.createOnly && records.has(`${row.partition}/${row.key}`)) throw new Error("Already exists");
    for (const row of rows) records.set(`${row.partition}/${row.key}`, { value: structuredClone(row.value), ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}) });
  });
  mocks.published.mockImplementation(async () => [...content.values()]);
  mocks.upsert.mockImplementation(async row => { content.set(row.content_item_id, structuredClone(row)); return row; });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("stages only student projection and dimensional metadata, never private draft or embedded assets", async () => {
  const id = await start();
  expect(id).toMatch(/^[a-f0-9-]{36}$/u);
  const saved = stored(id);
  expect(saved.value.state).toBe("staging"); expect(saved.expiresAt).toBeGreaterThan(Date.now() / 1000);
  expect(JSON.stringify(saved)).not.toMatch(/PRIVATE_|teacherNotes|sourcePrompt|referenceData|checks|classroomContext|data:image/u);
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
  expect((await read(id)).status).toBe(404);
});

it("uploads exact private image bytes once, requires every asset, and publishes a stable safe content reference", async () => {
  const id = await start(); expect((await commit(id)).status).toBe(422);
  expect((await asset(id)).status).toBe(200); expect((await asset(id)).status).toBe(200);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  const input = (mocks.send.mock.calls[0][0] as PutObjectCommand).input;
  expect(input.Body).toEqual(Buffer.from(tinyImage.split(",")[1], "base64"));
  expect(input).toMatchObject({ Bucket: "private-test-bucket", ContentType: "image/png", CacheControl: "private, no-store" });
  expect(input.ACL).toBeUndefined(); expect(input.Key).toMatch(/^slide-publications\/[a-f0-9]{64}\//u);
  expect(JSON.stringify([...records.values()])).not.toMatch(/data:image|https:\/\/|PRIVATE_/u);
  const response = await commit(id); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ publicationId: id, contentItemId: "slides-stable-deck-id", slides: { publicationId: id, slideCount: 5, lessonNumber: 3 } });
  const row = mocks.upsert.mock.calls[0][0];
  expect(row.published_by).toBe(teacher.geniusId);
  expect(JSON.parse(row.content_json)).toEqual({ id: "slides-stable-deck-id", type: "Slides", title: startBody().draft.title, body: "", strategy: "cognitive conflict", slides: { publicationId: id, slideCount: 5, lessonNumber: 3 } });
  expect(stored(id)).not.toHaveProperty("expiresAt"); expect(stored(id).value).not.toHaveProperty("expiresAt");
  expect([...records.values()].every(value => value.expiresAt === undefined)).toBe(true);
  expect((await commit(id)).status).toBe(200); expect(mocks.upsert).toHaveBeenCalledTimes(1);
});

it("allows the signed owner and joined student to fetch current published slides with fresh signed URLs", async () => {
  const id = await published();
  for (const user of [teacher, student]) {
    mocks.session.mockResolvedValue(user);
    const response = await read(id); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json(); expect(isPublishedSlideResponse(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|ownerId|digest|teacherNotes|classroomContext/u);
    expect(mocks.context).toHaveBeenLastCalledWith(user, context.classId, context.assignmentId);
  }
  expect(mocks.sign).toHaveBeenCalledTimes(2); expect(mocks.sign.mock.calls[0][2]).toEqual({ expiresIn: 600 });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 365 * 24 * 60 * 60 * 1000);
  expect((await read(id)).status).toBe(200); // Published records do not inherit staging expiry.
});

it("accepts the actual DynamoDB physical class partition while rejecting another class/task", async () => {
  const id = await published();
  const original = content.get("slides-stable-deck-id")!;
  content.set(original.content_item_id, { ...original, class_id: `CLASS#${context.classId}` });
  mocks.session.mockResolvedValue(student);
  expect((await read(id)).status).toBe(200);
  mocks.session.mockResolvedValue(teacher);
  expect((await commit(id)).status).toBe(200);
  expect(mocks.upsert).toHaveBeenCalledTimes(1);
  for (const foreign of [{ ...original, class_id: "CLASS#ea-class-other" }, { ...original, class_id: `CLASS#${context.classId}`, assignment_id: "ea-task-other" }]) {
    content.set(original.content_item_id, foreign);
    expect((await read(id)).status).toBe(404);
  }
});

it("denies missing sessions, student mutations, cross-origin posts, nonmembers and wrong tasks before signing", async () => {
  const id = await published();
  mocks.session.mockResolvedValue(null); expect((await read(id)).status).toBe(401); expect((await asset(id)).status).toBe(401);
  mocks.session.mockResolvedValue(student); expect((await asset(id)).status).toBe(403);
  mocks.session.mockResolvedValue(teacher); expect((await POST(request(startBody(), "https://attacker.test"))).status).toBe(403);
  mocks.context.mockRejectedValueOnce(new WorkspaceError("Join this class", 403)); expect((await read(id)).status).toBe(403);
  expect((await read(id, { assignmentId: "ea-task-other" })).status).toBe(404);
  mocks.session.mockResolvedValue({ ...teacher, geniusId: "other-teacher" }); expect((await commit(id)).status).toBe(404);
  expect(mocks.sign).not.toHaveBeenCalled();
});

it("rejects raw URLs, wrong dimensions, signatures, unexpected asset IDs and private extra fields", async () => {
  const id = await start();
  for (const value of [{ data: "https://other.example/image.png", width: 1, height: 1 }, { data: tinyImage, width: 2, height: 1 },
    { data: "data:image/png;base64,AAAA", width: 1, height: 1 }, { data: tinyImage, width: 1, height: 1, sourcePrompt: "private" }]) {
    expect((await asset(id, { asset: value })).status).toBeGreaterThanOrEqual(400);
  }
  expect((await asset(id, { visualId: "../other" })).status).toBe(400);
  expect(mocks.send).not.toHaveBeenCalled();
  const differentDimensions = { ...startBody(), assets: { evidence: { width: 2, height: 2 } } };
  const alternate = (await (await POST(request(differentDimensions))).json()).publicationId;
  expect((await asset(alternate, { asset: { data: tinyImage, width: 2, height: 2 } })).status).toBe(422);
});

it.each([
  ["jpeg", "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCcAAlK/9k="],
  ["webp", "UklGRjYAAABXRUJQVlA4ICoAAACwAQCdASoBAAEAAUAmJZgCdLoABDAAAP7z32fra9t4ZQf/EOdDnQ5kkAA="],
])("accepts complete real 1×1 %s image bytes with matching declared dimensions", async (format, base64) => {
  const id = await start();
  expect((await asset(id, { asset: { data: `data:image/${format};base64,${base64}`, width: 1, height: 1 } })).status).toBe(200);
  const input = (mocks.send.mock.calls[0][0] as PutObjectCommand).input;
  expect(input.ContentType).toBe(`image/${format}`);
  expect(input.Body).toEqual(Buffer.from(base64, "base64"));
});

it("keeps accepted images immutable and prevents changing images after commit", async () => {
  const id = await start(); await asset(id);
  const otherData = `data:image/png;base64,${Buffer.concat([Buffer.from(tinyImage.split(",")[1], "base64"), Buffer.from("extra")]).toString("base64")}`;
  expect((await asset(id, { asset: { data: otherData, width: 1, height: 1 } })).status).toBe(409);
  await commit(id); expect((await asset(id)).status).toBe(409);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("stops expired staging operations and bounds the complete JSON upload", async () => {
  const id = await start();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + (SLIDE_PUBLICATION_STAGE_SECONDS + 1) * 1000);
  expect((await asset(id)).status).toBe(410); expect((await commit(id)).status).toBe(410);
  const response = await POST(request({ operation: "asset", publicationId: id, padding: "x".repeat(MAX_SLIDE_PUBLICATION_BYTES) }));
  expect(response.status).toBe(413); expect(mocks.send).not.toHaveBeenCalled();
});

it("publishes a complete draft despite teaching-rule suggestions without requiring review or refinement metadata", async () => {
  const body = startBody(); body.draft.slides[0].task = "Describe the scene. Explain your thinking.";
  const response = await POST(request(body));
  expect(response.status).toBe(200);
  const id = (await response.json()).publicationId;
  expect((await asset(id)).status).toBe(200);
  expect((await commit(id)).status).toBe(200);
  mocks.session.mockResolvedValue(student);
  const readable = await read(id);
  expect(readable.status).toBe(200);
  const result = await readable.json();
  expect(isPublishedSlideResponse(result)).toBe(true);
  expect(result.manifest.pages[0].elements).toEqual(expect.arrayContaining([expect.objectContaining({ text: body.draft.slides[0].task })]));
});

it("requires valid draft structure and complete dimensions before creating a ticket", async () => {
  const wrongStage = startBody(); wrongStage.draft.slides[0].stage = "question";
  expect((await POST(request(wrongStage))).status).toBe(422);
  const tooLong = startBody(); tooLong.draft.slides[0].body = "x".repeat(261);
  expect((await POST(request(tooLong))).status).toBe(422);
  expect((await POST(request({ ...startBody(), assets: {} }))).status).toBe(422);
  expect((await POST(request({ ...startBody(), checks: {} }))).status).toBe(400);
  expect(records.size).toBe(0);
});

it("blocks reads for removed/replaced references and never lets an old commit replace the new version", async () => {
  const old = await published();
  const current = await published(); expect(current).not.toBe(old);
  expect(content.size).toBe(1); expect((await read(old)).status).toBe(404);
  expect((await commit(old)).status).toBe(409); expect((await read(current)).status).toBe(200);
  content.clear(); expect((await read(current)).status).toBe(404);
});

it("survives a failed final write without exposing an expiring or missing publication", async () => {
  const id = await start(); await asset(id);
  const persist = mocks.put.getMockImplementation()!;
  mocks.put.mockImplementationOnce(persist).mockRejectedValueOnce(new Error("final write failed"));
  expect((await commit(id)).status).toBe(503);
  expect(stored(id).value.state).toBe("ready"); expect(stored(id)).not.toHaveProperty("expiresAt");
  expect((await read(id)).status).toBe(200); // Reference exists and durable ready manifest is recoverable.
  expect((await commit(id)).status).toBe(200); expect(content.size).toBe(1);
});

it("does not expose prepared data after publish failure and permits a safe retry", async () => {
  const id = await start(); await asset(id);
  mocks.upsert.mockRejectedValueOnce(new Error("internal bucket details"));
  const failed = await commit(id); expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("bucket details");
  expect((await read(id)).status).toBe(404);
  expect((await commit(id)).status).toBe(200);
});
