import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ session: vi.fn(), context: vi.fn(), media: vi.fn() }));
vi.mock("@/lib/session", async original => ({ ...await original<object>(), sessionUser: mocks.session }));
vi.mock("@/lib/workspace", async original => ({ ...await original<object>(), workspaceContext: mocks.context }));
// Not about lessons: getLesson reads the lesson files here. See lesson-wiring.test.ts for the stored ones.
vi.mock("@/lib/lesson-scope", () => ({ enterLessonScope: () => {}, loadTaskLessons: async () => new Map() }));
vi.mock("@/lib/nosql", () => ({ getMedia: mocks.media }));
import { GET, POST } from "@/app/api/material-gallery/route";
import { GET as mediaGET } from "@/app/api/material-gallery/media/route";
import { resolveGalleryContentMedia } from "@/lib/material-gallery-server";
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
    expect((await get({ action: "asset", copyId: one.copyId, visualId: "evidence" }, { ...scope, assignmentId: "ea-task-other" })).status).toBe(404);
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
    expect(snapshot.class_id).toMatch(/^GALLERY_COPIES#/);
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

  it("rejects identity/focus forgery and isolates saves, lists, snapshots and assets by teacher and task", async () => {
    const copy = await copied();
    for (const patch of [{ lessonNumber: 2 }, { strategy: "analogy" }, { focus: { misconceptions: ["b"], coreIdeas: [] } }, { gallerySource: { ...copy.source, title: "Forged" } }]) {
      expect((await post({ action: "start-save", copyId: copy.copyId, expectedRevision: 0, deck: { ...copy.deck, ...patch } })).status).toBe(422);
    }
    const saveId = await stage(copy, 0, "Private"); await uploadCopy(copy.copyId, saveId); await commit(copy.copyId, saveId);
    const other = { ...scope, assignmentId: "ea-task-other" };
    expect((await get({ action: "saved-copy", copyId: copy.copyId }, other)).status).toBe(404);
    expect((await (await get({ action: "saved-copies" }, other)).json()).items).toEqual([]);
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
  it("rejects unsaved external videos without fetching caller-provided URLs", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mocks.media.mockResolvedValue({ class_id: scope.classId, assignment_id: scope.assignmentId, student_id: "cohort", content_item_id: item.id,
      mime_type: "video/mp4", data_url: "http://127.0.0.1/private" });
    expect((await shareVideo()).status).toBe(422); expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it("renews an unpublished copy after expiry and withdrawal, only for its teacher and exact task", async () => {
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
    expect((await get(fields, { ...scope, assignmentId: "ea-task-unrelated" })).status).toBe(404);
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
