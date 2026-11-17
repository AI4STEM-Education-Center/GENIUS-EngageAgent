import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ session: vi.fn(), context: vi.fn(), media: vi.fn(), complete: vi.fn() }));
vi.mock("openai", () => ({ default: class { chat = { completions: { create: mocks.complete } }; } }));
vi.mock("@/lib/session", async original => ({ ...await original<object>(), sessionUser: mocks.session }));
vi.mock("@/lib/workspace", async original => ({ ...await original<object>(), workspaceContext: mocks.context }));
// Not about lessons: getLesson reads the lesson files here. See lesson-wiring.test.ts for the stored ones.
vi.mock("@/lib/lesson-scope", () => ({ enterLessonScope: () => {}, loadTaskLessons: async () => new Map() }));
vi.mock("@/lib/nosql", () => ({ getMedia: mocks.media }));
// Local JSON silently removes undefined fields; DynamoDB rejects them. Exercise
// the actual AWS serializer before local writes so cloud-only failures surface.
vi.mock("@/lib/workspace-store", async original => {
  const store = await original<typeof import("@/lib/workspace-store")>();
  const { marshall } = await import("@aws-sdk/util-dynamodb");
  return { ...store, workspacePut: async (records: Parameters<typeof store.workspacePut>[0]) => {
    for (const row of records) if (!row.remove) marshall({ value: row.value });
    return store.workspacePut(records);
  } };
});
import { GET, POST } from "@/app/api/material-gallery/route";
import { GET as mediaGET } from "@/app/api/material-gallery/media/route";
import { resolveGalleryContentMedia } from "@/lib/material-gallery-server";
import { POST as adaptVideo } from "@/app/api/material-gallery/adapt-video/route";
import { deckFixture, tinyImage } from "../fixtures/slides";
import { WorkspaceError } from "@/lib/workspace";

const origin = "http://localhost:3199";
const scope = { classId: "ea-class-gallery", assignmentId: "ea-task-gallery" };
const teacher = { role: "teacher", geniusId: "gallery-owner", name: "Owner" };
const metadata = { title: "A soft ball during contact", description: "Explore deformation", gradeBand: "6–8", experienceContext: "Catching a ball", sharingConfirmed: true };
const hash = createHash("sha256").update(Buffer.from(tinyImage.split(",")[1], "base64")).digest("hex");
let directory: string;
const post = (body: object, requestScope = scope, requestOrigin = origin) => POST(new Request(`${origin}/api/material-gallery`, {
  method: "POST", headers: { "Content-Type": "application/json", origin: requestOrigin }, body: JSON.stringify({ ...requestScope, ...body }),
}));
const get = (fields: Record<string, string> = {}, requestScope = scope) => GET(new Request(`${origin}/api/material-gallery?${new URLSearchParams({ ...requestScope, ...fields })}`));
function startBody(overrides: object = {}) {
  const deck = deckFixture("cognitive conflict");
  return { action: "start-share", lessonNumber: 3, strategy: deck.strategy, draft: deck.draft,
    assets: { evidence: { width: 1, height: 1, digest: hash } }, metadata, ...overrides };
}
async function start(overrides: object = {}) {
  const result = await post(startBody(overrides)); expect(result.status).toBe(200); return (await result.json()).id as string;
}
const upload = (id: string, asset = { data: tinyImage, width: 1, height: 1 }) => post({ action: "upload-asset", id, visualId: "evidence", asset });
async function share(overrides: object = {}) {
  const id = await start(overrides); expect((await upload(id)).status).toBe(200);
  expect((await post({ action: "commit-share", id })).status).toBe(200); return id;
}
beforeEach(async () => {
  vi.clearAllMocks(); directory = await fs.mkdtemp(path.join(os.tmpdir(), "engage-gallery-test-"));
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DYNAMODB_TABLE", ""); vi.stubEnv("ENGAGE_S3_BUCKET", "");
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", directory); vi.stubEnv("ENGAGE_APP_URL", origin); vi.stubEnv("SSO_SECRET", "local-gallery-test-secret");
  mocks.session.mockResolvedValue(teacher); mocks.context.mockResolvedValue({}); mocks.media.mockResolvedValue(null);
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

describe("teacher material library", () => {
  it("records the verified author and prompt dimensions without accepting client attribution or raw class data", async () => {
    const id = await share({ creatorName: "Forged name", teacherCount: 99, materialId: "original-deck-id",
      classroomContext: "PRIVATE_RAW_CLASS", diagnostic: "PRIVATE_STUDENT_ANSWER", promptTags: { LEARNER_CONTEXT: "PRIVATE_FORGED" },
      metadata: { ...metadata, quizPattern: "Force direction", teachingContext: "Compare familiar ball games", classProfile: "Introductory physics",
        focus: { misconceptions: ["a"], coreIdeas: [] } } });
    const result = await (await get({ id })).json();
    expect(result.material).toMatchObject({ creatorName: "Owner", teacherCount: 0, promptTags: {
      GRADE_LEVEL: "6–8", SUBJECT: "Physics", SELECTED_STRATEGY: "Cognitive Conflict", CURRENT_UNDERSTANDING: "Force direction",
      LEARNER_CONTEXT: "Compare familiar ball games", CLASS_PROFILE: "Introductory physics", EXPERIENCE_CONTEXT: "Catching a ball",
      PREFERRED_MEDIA_TYPE: "SLIDE SEQUENCE",
    } });
    for (const key of ["TOPIC", "LEARNING_OBJECTIVE", "TARGET_CONCEPT", "MISCONCEPTION_OR_GAP", "KNOWLEDGE_GAP", "TARGET_UNDERSTANDING", "VISUAL_STYLE", "DURATION"]) {
      expect(result.material.promptTags[key]).toEqual(expect.any(String));
      expect(result.material.promptTags[key].length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|original-deck-id|gallery-owner|ea-task-gallery/);
    const disk = await fs.readFile(path.join(directory, "workspace.json"), "utf8");
    expect(disk).toContain("original-deck-id"); expect(disk).not.toMatch(/PRIVATE_|Forged name/);
    expect((await post(startBody({ metadata: { ...metadata, creatorName: "Forged" } }))).status).toBe(400);
  });

  it("combines lesson, strategy, reviewed tags and author search and ranks matching focus without losing pagination", async () => {
    const focused = await share({ metadata: { ...metadata, teachingContext: "Visual scaffolding", focus: { misconceptions: ["a"], coreIdeas: [] } } });
    await share({ metadata: { ...metadata, title: "A newer material" } });
    const other = await share({ lessonNumber: 2, metadata: { ...metadata, title: "Another lesson" } });
    const matching = await (await get({ lessonNumber: "3", strategy: "cognitive conflict", search: "visual scaffolding" })).json();
    expect(matching.items.map((item: { id: string }) => item.id)).toEqual([focused]);
    expect(matching.facets.lessons).toEqual([2, 3]);
    expect((await (await get({ lessonNumber: "3", strategy: "analogy", search: "visual scaffolding" })).json()).items).toEqual([]);
    expect((await (await get({ search: "Owner" })).json()).items).toHaveLength(3);
    expect((await get({ lessonNumber: "9999" })).status).toBe(200);
    const context = { recommendLesson: "3", recommendStrategy: "cognitive conflict", recommendFocus: JSON.stringify({ misconceptions: ["a"], coreIdeas: [] }), limit: "1" };
    const first = await (await get(context)).json();
    expect(first.items[0]).toMatchObject({ id: focused, matchReasons: ["Same lesson", "Same strategy", "Same focus"] });
    const second = await (await get({ ...context, cursor: first.nextCursor })).json();
    expect(second.items[0].id).not.toBe(focused);
    const third = await (await get({ ...context, cursor: second.nextCursor })).json();
    expect(third.items[0].id).toBe(other); expect(third.nextCursor).toBeUndefined();
    expect((await get({ ...context, recommendLesson: "2", cursor: first.nextCursor })).status).toBe(400);
    expect((await get({ strategy: "not-a-strategy" })).status).toBe(400);
    expect((await get({ recommendFocus: '{"coreIdeas":[-1],"misconceptions":[]}' })).status).toBe(400);
  });

  it("persists complete editable sources, exposes only committed templates, and excludes task/private generation metadata", async () => {
    const id = await start({ classroomContext: "PRIVATE_CLASS_CONTEXT", checks: { key: "PRIVATE_CHECK" }, promptProvenance: "PRIVATE_MODEL" });
    expect((await (await get()).json()).items).toEqual([]);
    expect((await get({ id })).status).toBe(404);
    expect((await post({ action: "commit-share", id })).status).toBe(422);
    expect((await upload(id)).status).toBe(200);
    expect((await upload(id)).status).toBe(200);
    const commit = await post({ action: "commit-share", id }); expect(commit.status).toBe(200);
    expect((await post({ action: "commit-share", id })).status).toBe(200);
    const items = (await (await get()).json()).items;
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ id, revision: 1, format: "slides", slideCount: 5, isOwner: true });
    expect(JSON.stringify(items)).not.toMatch(/gallery-owner|ea-class|ea-task|teacherNotes|sourcePrompt|data:image/);
    const detail = await (await get({ id })).json();
    expect(detail.draft).toEqual(deckFixture("cognitive conflict").draft);
    const disk = await fs.readFile(path.join(directory, "workspace.json"), "utf8");
    expect(disk).not.toMatch(/PRIVATE_|ea-class-gallery|ea-task-gallery|data:image/);
    expect((await fs.readdir(path.join(directory, "material-gallery-assets"))).length).toBe(1);
  });

  it("lets another authenticated teacher preview and copy, without mutating or taking ownership of the source", async () => {
    const id = await share(); mocks.session.mockResolvedValue({ ...teacher, geniusId: "second-teacher" });
    expect((await (await get()).json()).items[0].isOwner).toBe(false);
    const preview = await (await get({ id })).json(); expect(preview.draft.title).toBeDefined();
    const image = await (await get({ action: "asset", id, visualId: "evidence" })).json(); expect(image.asset.data).toBe(tinyImage);
    expect((await post({ action: "unshare", id })).status).toBe(404);
    expect((await upload(id)).status).toBe(404);
    const one = await (await post({ action: "copy", id, mode: "adapt" })).json();
    const two = await (await post({ action: "copy", id, mode: "use" })).json();
    expect(one.deck.id).not.toBe(two.deck.id);
    expect(one.source).toEqual({ templateId: id, revision: 1, title: metadata.title, mode: "adapt" });
    expect(one.deck.gallerySource).toEqual(one.source);
    one.deck.draft.slides[0].title = "My changed title";
    expect((await (await get({ id })).json()).draft.slides[0].title).toBe(preview.draft.slides[0].title);
    expect((await get({ action: "asset", copyId: one.copyId, visualId: "evidence" })).status).toBe(200);
    expect((await get({ action: "asset", copyId: one.copyId, visualId: "evidence" }, { ...scope, assignmentId: "ea-task-other" })).status).toBe(200);
    mocks.session.mockResolvedValue(teacher);
    expect((await get({ action: "asset", copyId: one.copyId, visualId: "evidence" })).status).toBe(404);
  });

  it("withdraws a template from new use while preserving existing teacher copies", async () => {
    const id = await share();
    const copy = await (await post({ action: "copy", id, mode: "use" })).json();
    expect((await post({ action: "unshare", id })).status).toBe(200);
    expect((await post({ action: "unshare", id })).status).toBe(200);
    expect((await (await get()).json()).items).toEqual([]);
    expect((await get({ id })).status).toBe(404);
    expect((await post({ action: "copy", id, mode: "use" })).status).toBe(404);
    expect((await post({ action: "commit-share", id })).status).toBe(409);
    expect((await get({ action: "asset", copyId: copy.copyId, visualId: "evidence" })).status).toBe(200);
  });

  it("denies anonymous, student, mismatched class, malformed-token and cross-origin requests before storage writes", async () => {
    mocks.session.mockResolvedValue(null); expect((await get()).status).toBe(401); expect((await post(startBody())).status).toBe(401);
    mocks.session.mockResolvedValue({ ...teacher, role: "student" }); expect((await get()).status).toBe(403); expect((await post(startBody())).status).toBe(403);
    mocks.session.mockResolvedValue(teacher); expect((await post(startBody(), scope, "https://evil.test")).status).toBe(403);
    mocks.context.mockRejectedValueOnce(new WorkspaceError("Wrong class", 403)); expect((await get()).status).toBe(403);
    const explicit = new Request(`${origin}/api/material-gallery?${new URLSearchParams(scope)}`, { headers: { Authorization: "Bearer invalid" } });
    expect((await GET(explicit)).status).toBe(401);
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("returns a library-specific availability error without exposing unexpected service details", async () => {
    mocks.context.mockRejectedValueOnce(new Error("PRIVATE_SERVICE_DETAIL"));
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The material library is temporarily unavailable. Please try again shortly." });
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("validates the lesson focus, sharing consent, image checksum and real dimensions", async () => {
    expect((await post(startBody({ metadata: { ...metadata, sharingConfirmed: false } }))).status).toBe(422);
    expect((await post(startBody({ metadata: { ...metadata, focus: { misconceptions: ["not-in-this-lesson"], coreIdeas: [] } } }))).status).toBe(422);
    expect((await post(startBody({ metadata: { ...metadata, focus: { misconceptions: [], coreIdeas: [0] } } }))).status).toBe(422);
    const id = await start({ metadata: { ...metadata, focus: { misconceptions: ["a"], coreIdeas: [] } } });
    expect((await upload(id, { data: tinyImage, width: 1536, height: 1024 })).status).toBe(422);
    expect((await upload(id, { data: "https://untrusted.example/image.png", width: 1, height: 1 })).status).toBe(422);
    expect((await upload(id)).status).toBe(200);
    expect((await post({ action: "commit-share", id })).status).toBe(200);
    expect((await upload(id)).status).toBe(409);
  });

  it("filters and paginates matching templates without leaking private metadata", async () => {
    const a = await share({ metadata: { ...metadata, title: "Contact and deformation" } });
    const b = await share({ metadata: { ...metadata, title: "A ball at rest" } });
    const first = await (await get({ lessonNumber: "3", limit: "1" })).json();
    expect(first.items).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const second = await (await get({ lessonNumber: "3", limit: "1", cursor: first.nextCursor })).json();
    expect(second.items).toHaveLength(1); expect(new Set([first.items[0].id, second.items[0].id])).toEqual(new Set([a, b]));
    expect(second.nextCursor).toBeUndefined();
    expect((await get({ lessonNumber: "2", cursor: first.nextCursor })).status).toBe(400);
    expect((await (await get({ search: "at rest" })).json()).items).toHaveLength(1);
    expect((await (await get({ format: "video" })).json()).items).toEqual([]);
    expect((await GET(new Request(`${origin}/api/material-gallery?${new URLSearchParams(scope)}&limit=1&limit=2`))).status).toBe(400);
  });
  it("preserves valid focus on copies, omits legacy empty focus and retains verified attribution on re-sharing", async () => {
    const id = await share({ metadata: { ...metadata, focus: { misconceptions: ["a"], coreIdeas: [] } } });
    const copy = await (await post({ action: "copy", id, mode: "adapt" })).json();
    expect(copy.deck.focus).toEqual({ misconceptions: ["a"], coreIdeas: [] });
    const child = await share({ copyId: copy.copyId, metadata: { ...metadata, title: "Adapted ball activity" } });
    expect((await (await get({ id: child })).json()).material.derivedFrom).toEqual({ templateId: id, revision: 1, title: metadata.title });
    const legacy = await share({ metadata: { ...metadata, focus: { misconceptions: [], coreIdeas: [] } } });
    expect((await (await post({ action: "copy", id: legacy, mode: "use" })).json()).deck.focus).toBeUndefined();
    mocks.session.mockResolvedValue({ ...teacher, geniusId: "different-teacher" });
    expect((await post(startBody({ copyId: copy.copyId }))).status).toBe(404);
  });
});

describe("private saved Gallery copies", () => {
  async function copied() {
    const id = await share({ metadata: { ...metadata, focus: { misconceptions: ["a"], coreIdeas: [] } } });
    return { id, ...await (await post({ action: "copy", id, mode: "adapt" })).json() };
  }
  async function stage(copy: Awaited<ReturnType<typeof copied>>, revision: number, title: string) {
    const response = await post({ action: "start-save", copyId: copy.copyId, expectedRevision: revision,
      deck: { ...copy.deck, draft: { ...copy.deck.draft, title }, classroomContext: "PRIVATE_COPY_CONTEXT" },
      assets: { evidence: { width: 1, height: 1, digest: hash, sourcePrompt: "Original image plan" } } });
    expect(response.status).toBe(200);
    return (await response.json()).saveId as string;
  }
  const uploadCopy = (copyId: string, saveId: string) => post({ action: "upload-copy-asset", copyId, saveId, visualId: "evidence", asset: { data: tinyImage, width: 1, height: 1 } });
  const commit = (copyId: string, saveId: string) => post({ action: "commit-save", copyId, saveId });

  it("discovers legacy task copies without selecting their class and keeps editing the canonical revision", async () => {
    const copy = await copied(); const first = await stage(copy, 0, "Legacy private material");
    await uploadCopy(copy.copyId, first); await commit(copy.copyId, first);
    const file = path.join(directory, "workspace.json");
    const legacyPartition = `GALLERY_COPIES#${createHash("sha256").update(JSON.stringify([scope.classId, scope.assignmentId])).digest("hex")}`;
    const rows = JSON.parse(await fs.readFile(file, "utf8"));
    const legacy = rows.filter((row: { class_id: string }) => row.class_id !== legacyPartition).map((row: { class_id: string; value: { deliveryOnly?: boolean } }) => {
      if (row.class_id.startsWith("GALLERY_LIBRARY#")) { row.class_id = legacyPartition; delete row.value.deliveryOnly; } return row;
    });
    await fs.writeFile(file, JSON.stringify(legacy));
    const unscoped = { classId: "", assignmentId: "" };
    const list = await (await get({ library: "true", action: "saved-copies" }, unscoped)).json();
    expect(list.items).toEqual([expect.objectContaining({ copyId: copy.copyId, title: "Legacy private material" })]);
    const next = await stage(copy, 1, "Edited from the library"); await uploadCopy(copy.copyId, next); await commit(copy.copyId, next);
    const reopened = await (await get({ library: "true", action: "saved-copy", copyId: copy.copyId }, unscoped)).json();
    expect(reopened).toMatchObject({ revision: 2, copy: { deck: { draft: { title: "Edited from the library" } } } });
    mocks.session.mockResolvedValue({ ...teacher, geniusId: "someone-else" });
    expect((await (await get({ library: "true", action: "saved-copies" }, unscoped)).json()).items).toEqual([]);
  });

  it("counts distinct verified teachers only after durable saves, across retries and task scopes", async () => {
    const copy = await copied();
    const count = async () => (await (await get({ id: copy.id })).json()).material.teacherCount;
    await get({ id: copy.id }); await get({ action: "asset", id: copy.id, visualId: "evidence" });
    expect(await count()).toBe(0);
    const first = await stage(copy, 0, "First saved copy");
    expect((await commit(copy.copyId, first)).status).toBe(422); expect(await count()).toBe(0);
    await uploadCopy(copy.copyId, first); expect((await commit(copy.copyId, first)).status).toBe(200);
    expect(await count()).toBe(1);
    await commit(copy.copyId, first); expect(await count()).toBe(1);
    const second = await stage(copy, 1, "Second revision"); await uploadCopy(copy.copyId, second); await commit(copy.copyId, second);
    expect(await count()).toBe(1);
    const anotherTask = { classId: "ea-class-another", assignmentId: "ea-task-another" };
    const otherCopy = await (await post({ action: "copy", id: copy.id, mode: "adapt" }, anotherTask)).json();
    const staged = await (await post({ action: "start-save", copyId: otherCopy.copyId, expectedRevision: 0, deck: otherCopy.deck,
      assets: { evidence: { width: 1, height: 1, digest: hash } } }, anotherTask)).json();
    expect((await post({ action: "upload-copy-asset", copyId: otherCopy.copyId, saveId: staged.saveId, visualId: "evidence", asset: { data: tinyImage, width: 1, height: 1 } }, anotherTask)).status).toBe(200);
    expect((await post({ action: "commit-save", copyId: otherCopy.copyId, saveId: staged.saveId }, anotherTask)).status).toBe(200);
    expect(await count()).toBe(1);
    mocks.session.mockResolvedValue({ ...teacher, geniusId: "another-teacher", name: "Another teacher" });
    const next = { id: copy.id, ...await (await post({ action: "copy", id: copy.id, mode: "use" })).json() };
    const nextSave = await stage(next, 0, "Another teacher's adaptation"); await uploadCopy(next.copyId, nextSave); await commit(next.copyId, nextSave);
    expect(await count()).toBe(2);
    const publicData = JSON.stringify(await (await get()).json());
    expect(publicData).not.toMatch(/another-teacher|gallery-owner|ea-class-another|ea-task-another/);
    expect((await get({ action: "copy-attribution", copyId: copy.copyId })).status).toBe(404);
    mocks.session.mockResolvedValue(teacher); await post({ action: "unshare", id: copy.id });
    expect(await (await get({ action: "copy-attribution", copyId: copy.copyId })).json()).toMatchObject({ creatorName: "Owner", teacherCount: 2 });
    mocks.session.mockResolvedValue({ ...teacher, role: "student" });
    expect((await get({ action: "copy-attribution", copyId: copy.copyId })).status).toBe(403);
  });

  it("saves and reloads complete private revisions without sharing, publishing or changing the source", async () => {
    const copy = await copied();
    expect((await (await get({ action: "saved-copies" })).json()).items).toEqual([]);
    const saveId = await stage(copy, 0, "My first saved adaptation");
    expect((await get({ action: "saved-copy", copyId: copy.copyId })).status).toBe(404);
    expect((await uploadCopy(copy.copyId, saveId)).status).toBe(200);
    const saved = await (await commit(copy.copyId, saveId)).json();
    expect(saved.saved).toMatchObject({ copyId: copy.copyId, revision: 1, title: "My first saved adaptation", source: copy.source });
    const loaded = await (await get({ action: "saved-copy", copyId: copy.copyId })).json();
    expect(loaded).toMatchObject({ revision: 1, copy: { deck: { id: copy.copyId, classroomContext: "PRIVATE_COPY_CONTEXT", draft: { title: saved.saved.title }, focus: { misconceptions: ["a"], coreIdeas: [] }, gallerySource: copy.source } } });
    const asset = await (await get({ action: "saved-asset", copyId: copy.copyId, revision: "1", visualId: "evidence" })).json();
    expect(asset.asset).toEqual({ data: tinyImage, width: 1, height: 1, sourcePrompt: "Original image plan" });
    expect((await (await get()).json()).items).toHaveLength(1);
    expect((await (await get({ id: copy.id })).json()).draft.title).toBe(copy.deck.draft.title);
    expect((await post({ action: "commit-share", id: saveId })).status).toBe(404);
    expect((await (await get({ action: "saved-copies" })).json()).items).toEqual([saved.saved]);
    const rows = JSON.parse(await fs.readFile(path.join(directory, "workspace.json"), "utf8"));
    expect(rows.filter((r: { record_id: string }) => /CONTENT|PUBLISH/.test(r.record_id))).toEqual([]);
    const snapshot = rows.find((r: { record_id: string }) => r.record_id === `DRAFT#${saveId}`);
    expect(snapshot.expiresAt).toBeUndefined();
    expect(snapshot.class_id).toMatch(/^GALLERY_LIBRARY#/);
    expect((await post({ action: "unshare", id: copy.id })).status).toBe(200);
    expect((await get({ action: "saved-copy", copyId: copy.copyId })).status).toBe(200);
  });

  it("keeps the last complete snapshot after failed uploads and resolves concurrent saves atomically", async () => {
    const copy = await copied();
    const first = await stage(copy, 0, "First version"); await uploadCopy(copy.copyId, first); await commit(copy.copyId, first);
    const a = await stage(copy, 1, "Version A"), b = await stage(copy, 1, "Version B");
    expect((await commit(copy.copyId, a)).status).toBe(422);
    expect((await (await get({ action: "saved-copy", copyId: copy.copyId })).json()).copy.deck.draft.title).toBe("First version");
    await uploadCopy(copy.copyId, a); await uploadCopy(copy.copyId, b);
    const results = await Promise.all([commit(copy.copyId, a), commit(copy.copyId, b)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const loaded = await (await get({ action: "saved-copy", copyId: copy.copyId })).json();
    expect(loaded.revision).toBe(2); expect(["Version A", "Version B"]).toContain(loaded.copy.deck.draft.title);
    // A late retry of an old successful commit is idempotent, not an overwrite.
    expect((await (await commit(copy.copyId, first)).json()).saved.revision).toBe(1);
    expect((await (await get({ action: "saved-copy", copyId: copy.copyId })).json()).copy.deck.draft.title).toBe(loaded.copy.deck.draft.title);
    expect((await get({ action: "saved-asset", copyId: copy.copyId, revision: "1", visualId: "evidence" })).status).toBe(200);
    const stale = await post({ action: "start-save", copyId: copy.copyId, expectedRevision: 1, deck: copy.deck });
    expect(stale.status).toBe(409);
  });

  it("rejects identity/focus forgery and isolates saves, lists, snapshots and assets by teacher while permitting reuse across their tasks", async () => {
    const copy = await copied();
    for (const patch of [{ lessonNumber: 2 }, { strategy: "analogy" }, { focus: { misconceptions: ["b"], coreIdeas: [] } }, { gallerySource: { ...copy.source, title: "Forged" } }]) {
      expect((await post({ action: "start-save", copyId: copy.copyId, expectedRevision: 0, deck: { ...copy.deck, ...patch } })).status).toBe(422);
    }
    const saveId = await stage(copy, 0, "Private"); await uploadCopy(copy.copyId, saveId); await commit(copy.copyId, saveId);
    const other = { ...scope, assignmentId: "ea-task-other" };
    expect((await get({ action: "saved-copy", copyId: copy.copyId }, other)).status).toBe(200);
    expect((await (await get({ action: "saved-copies" }, other)).json()).items).toHaveLength(1);
    mocks.session.mockResolvedValue({ ...teacher, geniusId: "other-teacher" });
    expect((await get({ action: "saved-copy", copyId: copy.copyId })).status).toBe(404);
    expect((await get({ action: "saved-asset", copyId: copy.copyId, revision: "1", visualId: "evidence" })).status).toBe(404);
    expect((await (await get({ action: "saved-copies" })).json()).items).toEqual([]);
    expect((await commit(copy.copyId, saveId)).status).toBe(404);
    mocks.session.mockResolvedValue({ ...teacher, role: "student" });
    expect((await get({ action: "saved-copies" })).status).toBe(403);
  });

  it("saves edited video text and durable media without trusting caller URLs or changing published fallback", async () => {
    const item = { id: "video-source", type: "Video", title: "Source clip", body: "Observe contact.", lessonNumber: 3, strategy: "cognitive conflict" };
    mocks.media.mockImplementation(async (_c, _a, _s, id, kind) => id === item.id && kind === "video" ? {
      class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: id,
      mime_type: "video/mp4", data_url: "data:video/mp4;base64,dmlkZW8=",
    } : null);
    const template = (await (await post({ action: "share-video", item, lessonNumber: 3, metadata })).json()).material;
    const copy = await (await post({ action: "copy", id: template.id, mode: "adapt" })).json();
    const originalMedia = await resolveGalleryContentMedia(scope.classId, scope.assignmentId, copy.item.id);
    const result = await post({ action: "start-save", copyId: copy.copyId, expectedRevision: 0, item: { ...copy.item, title: "My video", body: "My specific edited task." }, media: { video: "http://127.0.0.1/private" } });
    expect(result.status).toBe(200); const saveId = (await result.json()).saveId;
    expect((await commit(copy.copyId, saveId)).status).toBe(200);
    expect(await resolveGalleryContentMedia(scope.classId, scope.assignmentId, copy.item.id)).toEqual(originalMedia);
    await post({ action: "unshare", id: template.id });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60_000);
    const loaded = await (await get({ action: "saved-copy", copyId: copy.copyId })).json();
    expect(loaded.copy.item).toMatchObject({ id: copy.item.id, title: "My video", body: "My specific edited task.", gallerySource: copy.source });
    expect(loaded.copy.media.video).not.toBe(copy.media.video);
    const media = await mediaGET(new Request(`${origin}${loaded.copy.media.video}`));
    expect(media.status).toBe(200); expect(Buffer.from(await media.arrayBuffer()).toString()).toBe("video");
  });
});

describe("saved video reuse", () => {
  const item = { id: "generated-video", title: "Ball during contact", type: "Video", body: "Observe the ball during contact.", strategy: "cognitive conflict" };
  const shareVideo = () => post({ action: "share-video", item, lessonNumber: 3, metadata });
  it("copies saved video bytes rather than storing an expiring or arbitrary URL, and renews a published copy's media URL", async () => {
    const bytes = Buffer.from("local-test-video-bytes");
    mocks.media.mockImplementation(async (_classId, _assignmentId, _studentId, _itemId, kind) => kind === "video" ? {
      class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: item.id,
      mime_type: "video/mp4", data_url: `data:video/mp4;base64,${bytes.toString("base64")}`,
    } : null);
    const result = await shareVideo(); expect(result.status).toBe(200); const template = (await result.json()).material;
    mocks.session.mockResolvedValue({ ...teacher, geniusId: "another-teacher" });
    const copy = await (await post({ action: "copy", id: template.id, mode: "use" })).json();
    expect(copy.format).toBe("video"); expect(copy.item.id).toMatch(/^gallery-copy-/);
    expect(copy.item.id).not.toBe(item.id); expect(copy.media.video).toMatch(/^\/api\/material-gallery\/media\?ticket=/);
    expect(JSON.stringify(await (await get({ id: template.id })).json())).not.toMatch(/ea-class|ea-task|cohort|generated-video|data:video/);
    const renewed = await resolveGalleryContentMedia(scope.classId, scope.assignmentId, copy.item.id);
    expect(renewed?.video).toContain("ticket=");
    expect(await resolveGalleryContentMedia(scope.classId, "ea-task-other", copy.item.id)).toBeUndefined();
    const media = await mediaGET(new Request(`${origin}${renewed!.video}`));
    expect(media.status).toBe(200); expect(media.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await media.arrayBuffer())).toEqual(bytes);
    expect((await mediaGET(new Request(`${origin}/api/material-gallery/media?ticket=invalid`))).status).toBe(401);
    mocks.media.mockResolvedValue(null);
    const reshared = await post({ action: "share-video", item: { ...copy.item, title: "My adapted version" }, lessonNumber: 3, metadata: { ...metadata, title: "My adapted version" } });
    expect(reshared.status).toBe(200);
    expect((await reshared.json()).material.derivedFrom).toEqual({ templateId: template.id, revision: 1, title: metadata.title });
  });
  it("keeps sent video versions immutable while preparing later edits, and renews global saved media", async () => {
    let bytes = "first-video";
    mocks.media.mockImplementation(async (_class, _task, _student, id, kind) => kind === "video" ? {
      class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: id,
      media_type: "video", mime_type: "video/mp4", data_url: `data:video/mp4;base64,${Buffer.from(bytes).toString("base64")}`,
    } : null);
    const template = (await (await shareVideo()).json()).material;
    const copy = await (await post({ action: "copy", id: template.id, mode: "adapt" })).json();
    async function save(expectedRevision: number) {
      const stage = await post({ action: "start-save", copyId: copy.copyId, expectedRevision, item: copy.item });
      expect(stage.status).toBe(200);
      expect((await post({ action: "commit-save", copyId: copy.copyId, saveId: (await stage.json()).saveId })).status).toBe(200);
      return (await (await post({ action: "prepare-delivery", copyId: copy.copyId })).json()).contentItemId;
    }
    const first = await save(0);
    const retry = (await (await post({ action: "prepare-delivery", copyId: copy.copyId })).json()).contentItemId;
    expect(retry).toBe(first);
    bytes = "second-video";
    const second = await save(1); expect(second).not.toBe(first);
    async function videoBytes(id: string) {
      const urls = await resolveGalleryContentMedia(scope.classId, scope.assignmentId, id);
      return Buffer.from(await (await mediaGET(new Request(`${origin}${urls!.video}`))).arrayBuffer()).toString();
    }
    expect(await videoBytes(first)).toBe("first-video"); expect(await videoBytes(second)).toBe("second-video");
    expect(await resolveGalleryContentMedia(scope.classId, "other-task", first)).toBeUndefined();
    const saved = await (await get({ library: "true", action: "saved-copy", copyId: copy.copyId }, { classId: "", assignmentId: "" })).json();
    expect(saved.revision).toBe(2);
    const globalVideo = await mediaGET(new Request(`${origin}${saved.copy.media.video}`));
    expect(Buffer.from(await globalVideo.arrayBuffer()).toString()).toBe("second-video");
    expect((await (await get({ library: "true", action: "saved-copies" }, { classId: "", assignmentId: "" })).json()).items).toHaveLength(1);
  });
  it("rejects unsaved external videos without fetching caller-provided URLs", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mocks.media.mockResolvedValue({ class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: item.id,
      mime_type: "video/mp4", data_url: "http://127.0.0.1/private" });
    expect((await shareVideo()).status).toBe(422); expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it("renews an unpublished copy after expiry and withdrawal, only for its teacher, including another authorized task", async () => {
    mocks.media.mockImplementation(async (_class, _assignment, _student, id, kind) => id === item.id && kind === "video" ? {
      class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: item.id,
      mime_type: "video/mp4", media_type: "video", data_url: "data:video/mp4;base64,dmlkZW8=",
    } : null);
    const template = (await (await shareVideo()).json()).material;
    const copy = await (await post({ action: "copy", id: template.id, mode: "adapt" })).json();
    expect((await post({ action: "unshare", id: template.id })).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60_000);
    expect((await mediaGET(new Request(`${origin}${copy.media.video}`))).status).toBe(401);
    const fields = { action: "copy-media", copyId: copy.copyId };
    const renewedResponse = await get(fields); expect(renewedResponse.status).toBe(200);
    const renewed = (await renewedResponse.json()).media;
    expect(renewed.video).not.toBe(copy.media.video);
    expect((await mediaGET(new Request(`${origin}${renewed.video}`))).status).toBe(200);
    mocks.media.mockClear();
    expect((await get(fields, { ...scope, assignmentId: "ea-task-unrelated" })).status).toBe(200);
    mocks.media.mockClear();
    mocks.session.mockResolvedValue({ ...teacher, geniusId: "different-teacher" }); expect((await get(fields)).status).toBe(404);
    mocks.session.mockResolvedValue({ ...teacher, role: "student" }); expect((await get(fields)).status).toBe(403);
    mocks.session.mockResolvedValue(null); expect((await get(fields)).status).toBe(401);
    expect(mocks.media).not.toHaveBeenCalled();
  });
  it("prefers regenerated task media when refreshing a copied video and rejects mismatched records", async () => {
    mocks.media.mockImplementation(async (_class, _assignment, _student, id, kind) => id === item.id && kind === "video" ? {
      class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: item.id,
      mime_type: "video/mp4", media_type: "video", data_url: "data:video/mp4;base64,dmlkZW8=",
    } : null);
    const template = (await (await shareVideo()).json()).material;
    const copy = await (await post({ action: "copy", id: template.id, mode: "adapt" })).json();
    mocks.media.mockImplementation(async (_class, _assignment, _student, id, kind) => ({
      class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: id,
      mime_type: kind === "video" ? "video/mp4" : "image/png", media_type: kind, data_url: `https://saved.example/new-${kind}`,
    }));
    const response = await get({ action: "copy-media", copyId: copy.copyId });
    expect(response.status).toBe(200);
    expect((await response.json()).media).toEqual({ image: "https://saved.example/new-image", video: "https://saved.example/new-video" });
    mocks.media.mockResolvedValue({ class_id: "other-class", assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: copy.item.id,
      media_type: "video", data_url: "https://private.example/unrelated" });
    const mismatch = await get({ action: "copy-media", copyId: copy.copyId });
    expect(mismatch.status).toBe(422); expect(await mismatch.text()).not.toContain("private.example");
  });
  it("preserves a video's recorded lesson, focus and editable scene through copying and verified re-sharing", async () => {
    const focus = { misconceptions: ["a"], coreIdeas: [] };
    const focusedItem = { ...item, lessonNumber: 3, focus: { misconceptions: ["a"] }, visualBrief: "Show the ball during contact.", textModes: ["questions"],
      gallerySource: { templateId: "forged-template", revision: 99, title: "Forged attribution", mode: "use" } };
    mocks.media.mockImplementation(async (_class, _assignment, _student, id, kind) => id === item.id && kind === "video" ? {
      class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: item.id,
      mime_type: "video/mp4", data_url: "data:video/mp4;base64,dmlkZW8=",
    } : null);
    const result = await post({ action: "share-video", item: focusedItem, lessonNumber: 3, metadata });
    expect(result.status).toBe(200); const template = (await result.json()).material;
    expect(template.focus).toEqual(focus); expect(template.derivedFrom).toBeUndefined();
    const copy = await (await post({ action: "copy", id: template.id, mode: "adapt" })).json();
    expect(copy.item).toMatchObject({ lessonNumber: 3, focus, visualBrief: focusedItem.visualBrief, textModes: ["questions"],
      gallerySource: { templateId: template.id, revision: 1, mode: "adapt" } });
    const reshared = await post({ action: "share-video", item: { ...copy.item, visualBrief: "A reviewed new scene." }, lessonNumber: 3, metadata: { ...metadata, focus } });
    expect(reshared.status).toBe(200); const child = (await reshared.json()).material;
    expect(child).toMatchObject({ lessonNumber: 3, focus, derivedFrom: { templateId: template.id, revision: 1, title: metadata.title } });
    expect((await (await get({ id: child.id })).json()).item.visualBrief).toBe("A reviewed new scene.");
    mocks.session.mockResolvedValue({ ...teacher, geniusId: "another-teacher" });
    expect((await post({ action: "share-video", item: copy.item, lessonNumber: 3, metadata })).status).toBe(404);
  });
  it("rejects current-workspace lesson/focus labels that do not belong to the saved video before accessing media", async () => {
    const focused = { ...item, lessonNumber: 3, focus: { misconceptions: ["a"] } };
    expect((await post({ action: "share-video", item: focused, lessonNumber: 2, metadata })).status).toBe(422);
    expect((await post({ action: "share-video", item: focused, lessonNumber: 3, metadata: { ...metadata, focus: { misconceptions: ["a", "b"], coreIdeas: [] } } })).status).toBe(422);
    expect((await post({ action: "share-video", item, lessonNumber: 3, metadata: { ...metadata, focus: { misconceptions: ["a"], coreIdeas: [] } } })).status).toBe(422);
    expect(mocks.media).not.toHaveBeenCalled();
  });
});

describe("teacher library outside classes and strict Step 3 recommendations", () => {
  const globalScope = { classId: "", assignmentId: "" };
  const libraryGet = (fields: Record<string, string> = {}) => get({ library: "true", ...fields }, globalScope);
  const libraryPost = (fields: Record<string, unknown>) => post({ library: true, ...fields }, globalScope);

  it("allows an authenticated teacher to browse, copy, edit and save without creating a class", async () => {
    const id = await share(); mocks.context.mockClear();
    expect((await libraryGet()).status).toBe(200);
    const copy = await (await libraryPost({ action: "copy", id, mode: "adapt" })).json();
    const started = await libraryPost({ action: "start-save", copyId: copy.copyId, expectedRevision: 0,
      deck: { ...copy.deck, draft: { ...copy.deck.draft, title: "My independent material" } }, assets: { evidence: { width: 1, height: 1, digest: hash } } });
    expect(started.status).toBe(200); const { saveId } = await started.json();
    expect((await libraryPost({ action: "upload-copy-asset", copyId: copy.copyId, saveId, visualId: "evidence", asset: { data: tinyImage, width: 1, height: 1 } })).status).toBe(200);
    expect((await libraryPost({ action: "commit-save", copyId: copy.copyId, saveId })).status).toBe(200);
    expect((await (await libraryGet({ action: "saved-copies" })).json()).items).toEqual([expect.objectContaining({ title: "My independent material", revision: 1 })]);
    expect(mocks.context).not.toHaveBeenCalled();
    expect((await libraryPost({ action: "prepare-delivery", copyId: copy.copyId })).status).toBe(400);
    mocks.context.mockRejectedValueOnce(new WorkspaceError("Not your class", 403));
    expect((await post({ action: "prepare-delivery", copyId: copy.copyId })).status).toBe(403);
    expect((await post({ action: "prepare-delivery", copyId: copy.copyId })).status).toBe(200);
    const disk = await fs.readFile(path.join(directory, "workspace.json"), "utf8");
    expect(disk).not.toMatch(/"record_id":"(?:CONTENT|PUBLISH)/);
    mocks.session.mockResolvedValue({ ...teacher, geniusId: "another-teacher" });
    expect((await libraryGet({ action: "saved-copy", copyId: copy.copyId })).status).toBe(404);
    expect((await post({ action: "prepare-delivery", copyId: copy.copyId })).status).toBe(404);
  });

  it("requires teacher identity and same-origin writes even when no class is selected", async () => {
    expect((await get({}, globalScope)).status).toBe(400);
    mocks.session.mockResolvedValue(null); expect((await libraryGet()).status).toBe(401);
    mocks.session.mockResolvedValue({ ...teacher, role: "student" }); expect((await libraryGet()).status).toBe(403);
    mocks.session.mockResolvedValue(teacher);
    expect((await post({ library: true, action: "copy", id: "unused", mode: "use" }, globalScope, "https://evil.test")).status).toBe(403);
    expect((await GET(new Request(`${origin}/api/material-gallery?library=true`, { headers: { Authorization: "Bearer invalid" } }))).status).toBe(401);
  });

  it("returns at most three relevant matches, preferring both selected focus items and excluding unrelated materials", async () => {
    const exact = await share({ metadata: { ...metadata, title: "Both selected focuses", focus: { misconceptions: ["a", "b"], coreIdeas: [] } } });
    for (let i = 0; i < 4; i++) await share({ metadata: { ...metadata, title: `One related focus ${i}`, focus: { misconceptions: ["a"], coreIdeas: [] } } });
    await share({ lessonNumber: 2, metadata: { ...metadata, title: "Unrelated curriculum" } });
    const fields = { recommendedOnly: "true", recommendLesson: "3", recommendStrategy: "cognitive conflict", format: "slides", recommendFocus: JSON.stringify({ misconceptions: ["a", "b"], coreIdeas: [] }), limit: "60" };
    const result = await (await get(fields)).json();
    expect(result.items).toHaveLength(3); expect(result.items[0].id).toBe(exact);
    expect(result.nextCursor).toBeUndefined();
    expect(result.items.every((item: { matchReasons: string[] }) => item.matchReasons.includes("Same focus"))).toBe(true);
    expect((await (await get({ ...fields, format: "video" })).json()).items).toEqual([]);
    expect((await (await get({ ...fields, recommendLesson: "1" })).json()).items).toEqual([]);
    expect((await (await get({ ...fields, recommendStrategy: "analogy" })).json()).items).toEqual([]);
    expect((await get({ recommendedOnly: "true" })).status).toBe(400);
  });

  it("supports reviewed keywords and grade filters without inventing tags or accepting unlimited text", async () => {
    const id = await share({ metadata: { ...metadata, keywords: ["elasticity", "visual learning", "elasticity"] } });
    const result = await (await libraryGet({ search: "visual learning", gradeBand: "6–8" })).json();
    expect(result.items[0]).toMatchObject({ id, promptTags: { KEYWORDS: "elasticity, visual learning" } });
    expect(result.facets.grades).toEqual(["6–8"]);
    expect((await (await libraryGet({ gradeBand: "University" })).json()).items).toEqual([]);
    expect((await post(startBody({ metadata: { ...metadata, keywords: Array(13).fill("tag") } }))).status).toBe(422);
  });
});

it("saves a newly generated material privately without first sharing it, and keeps media and teaching settings across classes", async () => {
  const id = await start({ action: "start-private-save", metadata: { title: "My private lesson", gradeBand: "Middle school" } });
  expect((await post({ action: "commit-private-save", id })).status).toBe(422);
  await upload(id);
  const response = await post({ action: "commit-private-save", id });
  expect(response.status).toBe(200);
  const created = await response.json();
  expect(created.source.private).toBe(true);
  expect(await (await post({ action: "commit-private-save", id })).json()).toEqual(created);
  expect((await post({ action: "commit-share", id })).status).toBe(422);
  expect((await get({ id })).status).toBe(404);
  expect((await (await get()).json()).items).toEqual([]);
  const original = deckFixture("cognitive conflict");
  const deck = { ...original, id: created.copyId, gallerySource: created.source, classroomContext: "PRIVATE_CLASS_CONTEXT",
    teachingContext: { gradeBand: "Middle school", experienceContext: "Soccer", quizPattern: "55–70% correct" } };
  deck.draft.slides[0].videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const staged = await post({ action: "start-save", copyId: created.copyId, expectedRevision: 0, deck,
    assets: { evidence: { width: 1, height: 1, digest: hash } } });
  expect(staged.status).toBe(200);
  const { saveId } = await staged.json();
  await post({ action: "upload-copy-asset", copyId: created.copyId, saveId, visualId: "evidence", asset: { data: tinyImage, width: 1, height: 1 } });
  expect((await post({ action: "commit-save", copyId: created.copyId, saveId })).status).toBe(200);
  const reopenedResponse = await get({ action: "saved-copy", copyId: created.copyId }, { classId: "ea-class-other", assignmentId: "ea-task-other" });
  expect(reopenedResponse.status).toBe(200);
  const reopened = await reopenedResponse.json();
  expect(reopened.copy.deck).toMatchObject({ teachingContext: deck.teachingContext, classroomContext: "PRIVATE_CLASS_CONTEXT", libraryRevision: 1 });
  expect(reopened.copy.deck.draft.slides[0].videoUrl).toBe(deck.draft.slides[0].videoUrl);
  expect((await (await get()).json()).items).toEqual([]);
  mocks.session.mockResolvedValue({ ...teacher, geniusId: "another-teacher" });
  expect((await get({ action: "saved-copy", copyId: created.copyId })).status).toBe(404);
});

it("carries current teaching choices into an adaptation without changing its public source", async () => {
  const id = await share({ metadata: { ...metadata, focus: { misconceptions: ["a"], coreIdeas: [] } } });
  const adaptation = { classroomContext: "Use short directions", teachingContext: { gradeBand: "Middle school", experienceContext: "Soccer" }, focus: { misconceptions: ["b"], coreIdeas: [] } };
  const result = await post({ action: "copy", id, mode: "adapt", adaptation });
  expect(result.status).toBe(200);
  const copy = await result.json();
  expect(copy.deck).toMatchObject({ classroomContext: adaptation.classroomContext, teachingContext: adaptation.teachingContext, focus: adaptation.focus });
  const stage = await post({ action: "start-save", copyId: copy.copyId, expectedRevision: 0, deck: copy.deck, assets: { evidence: { width: 1, height: 1, digest: hash } } });
  expect(stage.status).toBe(200);
  expect((await (await get({ id })).json()).material.focus).toEqual({ misconceptions: ["a"], coreIdeas: [] });
  expect(JSON.stringify(await (await get({ id })).json())).not.toContain("Use short directions");
});

it("saves generated video privately, adapts its text with authorized context and preserves the saved media", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const item = { id: "generated-private-video", lessonNumber: 3, strategy: "cognitive conflict", type: "Video", title: "Contact", body: "Observe the ball during contact." };
  mocks.media.mockImplementation(async (_c, _a, _s, id, kind) => id === item.id && kind === "video" ? {
    class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: id,
    mime_type: "video/mp4", data_url: "data:video/mp4;base64,dmlkZW8=",
  } : null);
  const createdResponse = await post({ action: "save-private-video", item, lessonNumber: 3, metadata: { title: item.title } });
  expect(createdResponse.status).toBe(200);
  const created = await createdResponse.json();
  expect(created.source.private).toBe(true);
  expect((await (await get()).json()).items).toEqual([]);
  const original = { ...item, id: `gallery-copy-${created.copyId}`, gallerySource: created.source };
  const request = () => new Request(`${origin}/api/material-gallery/adapt-video`, { method: "POST", headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ library: true, copyId: created.copyId, item: original, classroomContext: "Use shorter sentences", teachingContext: { gradeBand: "Middle school" } }) });
  mocks.complete.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ title: "Watch contact", body: "Watch the ball. What happens during contact?", visualBrief: "FORGED NEW SCENE" }) } }] });
  const adapted = await adaptVideo(request());
  expect(adapted.status).toBe(200);
  const result = await adapted.json();
  expect(result.item).toMatchObject({ id: original.id, title: "Watch contact", teachingContext: { gradeBand: "Middle school" }, classroomContext: "Use shorter sentences" });
  expect(JSON.stringify(result)).not.toContain("FORGED NEW SCENE");
  expect(mocks.complete.mock.calls[0][0].messages[1].content).toContain("Use shorter sentences");
  const staged = await post({ action: "start-save", copyId: created.copyId, expectedRevision: 0, item: result.item });
  expect(staged.status).toBe(200);
  const { saveId } = await staged.json();
  expect((await post({ action: "commit-save", copyId: created.copyId, saveId })).status).toBe(200);
  const reopened = await (await get({ action: "saved-copy", copyId: created.copyId })).json();
  expect(reopened.copy.item).toMatchObject(result.item);
  const media = await mediaGET(new Request(`${origin}${reopened.copy.media.video}`));
  expect(Buffer.from(await media.arrayBuffer()).toString()).toBe("video");
  mocks.session.mockResolvedValue({ ...teacher, geniusId: "other-teacher" });
  expect((await adaptVideo(request())).status).toBe(404);
  mocks.session.mockResolvedValue({ ...teacher, role: "student" });
  expect((await adaptVideo(request())).status).toBe(403);
  expect(mocks.complete).toHaveBeenCalledOnce();
});

it("keeps captured inputs distinct from reviewed labels and rejects forged format provenance", async () => {
  const { recordGeneration } = await import("@/lib/generation-record-server");
  const generation = await recordGeneration({ ...scope, userId: teacher.geniusId }, { lessonNumber: 3, strategy: "cognitive conflict", format: "slides", operation: "generate", model: "test-model", prompt: { system: "contract", user: "PRIVATE_CLASS_PROMPT" }, variables: { TOPIC: "Original topic", LEARNING_OBJECTIVE: "Observe contact" }, settings: { experienceContext: "PRIVATE_CHECK_IN", gradeBand: "Middle school" } });
  const id = await share({ generation: { ...generation, model: "forged" }, metadata: { ...metadata, topic: "Reviewed topic", experienceContext: "Ball games" } });
  const result = await (await get({ id })).json();
  expect(result.material).toMatchObject({ metadataOrigin: "captured", promptTags: { TOPIC: "Reviewed topic", EXPERIENCE_CONTEXT: "Ball games" }, generation: { id: generation.id, model: "test-model", tags: { TOPIC: "Original topic" } } });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  const copy = await (await post({ action: "copy", id, mode: "use" })).json();
  expect(copy.deck.generation.id).toBe(generation.id);
  const videoGeneration = await recordGeneration({ ...scope, userId: teacher.geniusId }, { lessonNumber: 3, strategy: "cognitive conflict", format: "video", operation: "generate", model: "test", prompt: { system: "", user: "video" } });
  expect((await post(startBody({ generation: videoGeneration }))).status).toBe(422);
});

it("lets the owner correct historical labels once per revision without changing material contents", async () => {
  const id = await share();
  const original = await (await get({ id })).json();
  const body = { action: "update-metadata", id, expectedMetadataRevision: 0, metadata: { ...metadata, gradeBand: "Grades 7–8", topic: "Collisions", keywords: ["motion"] } };
  const updated = await post(body);
  expect(updated.status).toBe(200);
  const value = await (await get({ id })).json();
  expect(value.material).toMatchObject({ metadataRevision: 1, metadataOrigin: "teacher_confirmed", gradeBand: "Middle school", promptTags: { TOPIC: "Collisions", KEYWORDS: "motion" } });
  expect(value.draft).toEqual(original.draft);
  expect(value.material.generation).toBeUndefined();
  expect(value.material.lessonIdentity).toEqual({ topic: original.material.promptTags.TOPIC, learningObjective: original.material.promptTags.LEARNING_OBJECTIVE });
  const recommended = await (await get({ recommendedOnly: "true", recommendLesson: "3", recommendStrategy: "cognitive conflict", format: "slides" })).json();
  expect(recommended.items.map((item: { id: string }) => item.id)).toContain(id);
  expect((await post(body)).status).toBe(409);
  mocks.session.mockResolvedValue({ ...teacher, geniusId: "intruder" });
  expect((await post({ ...body, expectedMetadataRevision: 1 })).status).toBe(404);
});
