import type { GenerationRecord } from "./generation-record";
import { resolveGeneration } from "./generation-record-server";
import { canonicalGrade } from "./material-teaching-context";
import { parseTeachingContext, type MaterialTeachingContext } from "./material-teaching-context";
import { galleryFeedback, galleryFeedbackCache, indexGalleryUse } from "./material-gallery-feedback";
import { createHash, randomUUID } from "node:crypto";
import { workspaceGet, workspacePut, workspaceQuery, legacyGalleryCopies } from "./workspace-store";
import { authorizeSlides, authorizeMaterialLibrary, requestDraft, slideContext, SlideRequestError, type AuthorizedSlideContext } from "./slides/server";
import { getLesson } from "./quiz-data";
import { enterLessonScope, loadTaskLessons } from "./lesson-scope";
import { resolveStrategyFocus } from "./strategy-focus";
import { getMedia } from "./nosql";
import { parseMaterialActivity } from "./material-activities";
import { galleryLessonIdentity, galleryMatches, galleryPromptTags } from "./material-gallery-tags";
import { draftVisibleVisualIds, isSlideStrategy, isSlideAsset, type SlideDraft } from "./slides/model";
import type { ContentItem, TextMode } from "./types";
import type { GalleryFilters, GalleryFocus, GalleryMaterial, GalleryMetadata, GalleryProvenance, GalleryScope, SavedGalleryCopySummary } from "./material-gallery";
import { assertGalleryStorage, copyGalleryBlob, duplicateGalleryBlob, galleryBlobUrl, readGalleryBlob, storeGalleryBlob, type GalleryBlob } from "./material-gallery-storage";

const PARTITION = "MATERIAL_GALLERY#v1";
const MAX_SOURCE_BYTES = 180_000;
const MAX_IMAGE_BYTES = 4_350_000;
const STAGING_SECONDS = 30 * 60;
type AssetDescription = { generation?: GenerationRecord; width: number; height: number; digest: string };
type Source = {
  lessonIdentity?: GalleryMaterial["lessonIdentity"];
  generation?: GenerationRecord; metadataRevision?: number; metadataOrigin?: "captured" | "teacher_confirmed" | "legacy";
  id: string; revision: 1; ownerId: string; createdAt: string; expiresAt: number;
  privateCopyId?: string; creatorName?: string; originMaterialId?: string; promptTags?: Record<string, string>;
  metadata: Omit<GalleryMetadata, "sharingConfirmed">;
  lessonNumber: number; strategy: string; format: "slides" | "video";
  draft?: SlideDraft; item?: ContentItem; assets: Record<string, AssetDescription>;
  videoMedia?: { video: GalleryBlob; image?: GalleryBlob };
  derivedFrom?: Pick<GalleryProvenance, "templateId" | "revision" | "title">;
};
type LibraryContext = AuthorizedSlideContext & { storagePartition?: string };
type Copy = { focus?: GalleryFocus; teachingContext?: MaterialTeachingContext; classroomContext?: string; deliveryOnly?: boolean; videoMedia?: Source["videoMedia"]; storagePartition?: string; id: string; ownerId: string; classId: string; assignmentId: string; templateId: string; source: GalleryProvenance; createdAt: string; saved?: SavedGalleryCopySummary & { snapshotId: string } };
type CopySnapshot = {
  generation?: GenerationRecord;
  id: string; copyId: string; expectedRevision: number; createdAt: string; expiresAt: number;
  format: "slides" | "video"; lessonNumber: number; strategy: string;
  draft?: SlideDraft; item?: ContentItem; classroomContext?: string; teachingContext?: MaterialTeachingContext;
  assets: Record<string, AssetDescription & { sourcePrompt?: string; referenceDigest?: string }>;
  videoMedia?: Source["videoMedia"];
};
const snapshotKey = (id: string) => `DRAFT#${id}`;
const savedKey = (id: string, revision: number) => `SAVE#${id}#${String(revision).padStart(10, "0")}`;
const saveConflict = () => new SlideRequestError("This copy has a newer saved version. Reopen it before saving again; your current edits are retained.", 409);
type Shared = { id: string; ownerId: string; material: Omit<GalleryMaterial, "isOwner"> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const sourceKey = (id: string) => `SOURCE#${id}`;
const assetKey = (id: string, visualId: string) => `ASSET#${id}#${visualId}`;
const legacyCopyPartition = (scope: GalleryScope) => `GALLERY_COPIES#${createHash("sha256").update(JSON.stringify([scope.classId, scope.assignmentId])).digest("hex")}`;
const libraryPartition = (userId: string) => `GALLERY_LIBRARY#${createHash("sha256").update(userId).digest("hex")}`;
const copyPartition = (scope: GalleryScope & { userId?: string; storagePartition?: string }) => scope.storagePartition || (scope.userId ? libraryPartition(scope.userId) : legacyCopyPartition(scope));
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const usagePartition = (id: string) => `GALLERY_USAGE#${id}`;
const creatorName = (context: LibraryContext) => context.teacherName?.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 120) || "Teacher";
const teacherCount = async (id: string) => (await workspaceQuery(usagePartition(id), "TEACHER#")).length;
const idValue = (value: unknown) => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new SlideRequestError("Choose a valid Gallery material.");
  return value;
};
function text(value: unknown, label: string, max: number, optional = true) {
  if (value === undefined && optional) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) throw new SlideRequestError(`${label} must be ${optional ? "at most" : "1–"}${max} characters of plain text.`);
  return value.trim();
}
function teachingSettings(value: unknown) {
  try { return parseTeachingContext(value); }
  catch (error) { throw new SlideRequestError(error instanceof Error ? error.message : "Invalid teaching settings.", 422); }
}
function metadata(value: unknown, lessonNumber: number, strategy: string): Source["metadata"] {
  if (!record(value) || value.sharingConfirmed !== true) throw new SlideRequestError("Review the shared content and confirm that class details have been removed.", 422);
  if (Object.keys(value).some(key => !["topic", "title", "description", "gradeBand", "experienceContext", "quizPattern", "teachingContext", "classProfile", "focus", "keywords", "sharingConfirmed"].includes(key))) throw new SlideRequestError("Unexpected sharing metadata.");
  if (value.keywords !== undefined && (!Array.isArray(value.keywords) || value.keywords.length > 12 || value.keywords.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 40 || /[\u0000-\u001f\u007f]/u.test(tag)))) throw new SlideRequestError("Use up to 12 keywords, each 1–40 characters.", 422);
  let focus: GalleryFocus | undefined;
  if (value.focus !== undefined) {
    const f = value.focus;
    if (!record(f) || !Array.isArray(f.misconceptions) || !Array.isArray(f.coreIdeas) || Object.keys(f).some(k => !["misconceptions", "coreIdeas"].includes(k))
      || f.misconceptions.length > 2 || f.coreIdeas.length > 2) throw new SlideRequestError("Choose focus items from this lesson.", 422);
    // Legacy materials may have no focus. Do not copy an empty selection into
    // a new deck, where draft restore and generation require one or two items.
    if (f.misconceptions.length || f.coreIdeas.length) {
      try { resolveStrategyFocus(lessonNumber, strategy, f); }
      catch (error) { throw new SlideRequestError(error instanceof Error ? error.message : "Choose focus items from this lesson.", 422); }
      focus = { misconceptions: f.misconceptions as string[], coreIdeas: f.coreIdeas as number[] };
    }
  }
  return { title: text(value.title, "Title", 160, false), description: text(value.description, "Description", 1000),
    ...(Array.isArray(value.keywords) ? { keywords: [...new Set(value.keywords.map(tag => String(tag).trim()))] } : {}),
    topic: text(value.topic, "Topic", 160), gradeBand: canonicalGrade(text(value.gradeBand, "Grade band", 80)), experienceContext: text(value.experienceContext, "Experience context", 200),
    quizPattern: text(value.quizPattern, "Quiz pattern", 200),
    ...(value.teachingContext === undefined ? {} : { teachingContext: text(value.teachingContext, "Teaching context", 400) }),
    ...(value.classProfile === undefined ? {} : { classProfile: text(value.classProfile, "Class profile summary", 200) }), ...(focus ? { focus } : {}) };
}
function shareableGeneration(generation: GenerationRecord): GenerationRecord {
  const tags = Object.fromEntries(Object.entries(generation.tags).filter(([key]) => !["EXPERIENCE_CONTEXT", "CURRENT_UNDERSTANDING", "LEARNER_CONTEXT", "CLASS_PROFILE"].includes(key)));
  return { ...generation, tags };
}
function tagsFromGeneration(source: Source, fallback: Record<string, string>) {
  if (!source.generation) return { ...fallback, ...(source.metadata.topic ? { TOPIC: source.metadata.topic } : {}) };
  const tags = { ...fallback, ...shareableGeneration(source.generation).tags };
  // Published suitability is explicitly reviewed and may differ from original inputs.
  return { ...tags, ...(source.metadata.topic ? { TOPIC: source.metadata.topic } : {}), GRADE_LEVEL: source.metadata.gradeBand || tags.GRADE_LEVEL, EXPERIENCE_CONTEXT: source.metadata.experienceContext || "Not shared",
    CURRENT_UNDERSTANDING: source.metadata.quizPattern || "Not shared", CLASS_PROFILE: source.metadata.classProfile || "Not shared", LEARNER_CONTEXT: source.metadata.teachingContext || "Not shared" };
}
function materialSummary(source: Source): Omit<GalleryMaterial, "isOwner"> {
  return { id: source.id, revision: source.revision, title: source.metadata.title,
    ...(source.lessonIdentity ? { lessonIdentity: source.lessonIdentity } : {}),
    ...(source.generation ? { generation: shareableGeneration(source.generation) } : {}), metadataOrigin: source.metadataOrigin || "legacy", metadataRevision: source.metadataRevision || 0,
    description: source.metadata.description || "", gradeBand: source.metadata.gradeBand || "", experienceContext: source.metadata.experienceContext || "",
    quizPattern: source.metadata.quizPattern || "", ...(source.metadata.focus ? { focus: source.metadata.focus } : {}),
    lessonNumber: source.lessonNumber, strategy: source.strategy, format: source.format, createdAt: source.createdAt,
    ...(source.draft ? { slideCount: source.draft.slides.length } : {}), ...(source.derivedFrom ? { derivedFrom: source.derivedFrom } : {}),
    ...(source.creatorName ? { creatorName: source.creatorName } : {}), ...(source.promptTags ? { promptTags: source.promptTags } : {}) };
}
function publicMaterial(source: Source, ownerId: string): GalleryMaterial {
  return { ...materialSummary(source), isOwner: source.ownerId === ownerId };
}
async function ownedSource(id: unknown, userId: string) {
  const source = await workspaceGet<Source>(PARTITION, sourceKey(idValue(id)));
  if (!source || source.ownerId !== userId) throw new SlideRequestError("Gallery material not found.", 404);
  return source;
}
async function isShared(id: string) {
  const [share, withdrawn] = await Promise.all([workspaceGet(PARTITION, `SHARED#${id}`), workspaceGet(PARTITION, `WITHDRAWN#${id}`)]);
  return !!share && !withdrawn;
}
async function sharedSource(id: unknown) {
  const templateId = idValue(id);
  if (!(await isShared(templateId))) throw new SlideRequestError("This material is no longer in the Gallery.", 404);
  const source = await workspaceGet<Source>(PARTITION, sourceKey(templateId));
  if (!source) throw new SlideRequestError("Gallery material not found.", 404);
  return source;
}
async function activeStage(id: unknown, userId: string) {
  const source = await ownedSource(id, userId);
  if (await workspaceGet(PARTITION, `SHARED#${source.id}`)) throw new SlideRequestError("A shared template cannot be edited. Share the revised material as a new item.", 409);
  if (source.expiresAt <= Date.now() / 1000) throw new SlideRequestError("The sharing upload expired. Share the current material again.", 410);
  return source;
}
function boundedSource(source: Source) {
  if (Buffer.byteLength(JSON.stringify(source), "utf8") > MAX_SOURCE_BYTES) throw new SlideRequestError("This material is too large to share. Shorten its text and notes first.", 413);
  return JSON.parse(JSON.stringify(source)) as Source;
}
function parseAssetDescriptions(value: unknown, draft: SlideDraft) {
  if (!record(value) || Object.keys(value).length !== draft.visuals.length) throw new SlideRequestError("Include every current slide image.", 422);
  return Object.fromEntries(draft.visuals.map(visual => {
    const a = value[visual.id];
    if (!record(a) || !Number.isInteger(a.width) || Number(a.width) < 1 || Number(a.width) > 4096 || !Number.isInteger(a.height) || Number(a.height) < 1 || Number(a.height) > 4096
      || typeof a.digest !== "string" || !/^[a-f0-9]{64}$/u.test(a.digest)) throw new SlideRequestError("Include every current slide image and its checksum.", 422);
    return [visual.id, { width: Number(a.width), height: Number(a.height), digest: a.digest }];
  }));
}
async function captureAssetGenerations(assets: Record<string, AssetDescription>, input: unknown, context: LibraryContext, source: Source, inherited?: Record<string, AssetDescription>) {
  for (const [visualId, asset] of Object.entries(assets)) {
    const value = record(input) && record(input[visualId]) ? input[visualId].generation : undefined;
    const generation = await resolveGeneration(context.userId, value, source.lessonNumber, source.strategy, inherited?.[visualId]?.generation, "slides");
    if (generation) {
      if (!generation.operation.startsWith("image")) throw new SlideRequestError("Choose the generation record for this image.", 422);
      asset.generation = generation;
    }
  }
}
function imageDimensions(bytes: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === "image/png") return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR"
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
  if (mime === "image/webp") {
    if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && bytes[20] === 0x2f) return { width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)) };
    return null;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return length >= 8 ? { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) } : null;
    offset += length;
  }
  return null;
}

async function startShare(body: Record<string, unknown>, context: LibraryContext, privateOnly = false) {
  enterLessonScope(await loadTaskLessons(context, body.lessonNumber));
  const { strategy } = slideContext(body);
  const draft = requestDraft(body.draft, strategy, true);
  const assets = parseAssetDescriptions(body.assets, draft);
  const parent = body.copyId === undefined ? undefined : await copiedSource(context, body.copyId);
  const derivedFrom = parent && !parent.source.privateCopyId ? { templateId: parent.source.id, revision: parent.source.revision, title: parent.source.metadata.title } : undefined;
  const source: Source = boundedSource({ id: randomUUID(), revision: 1, ownerId: context.userId, createdAt: new Date().toISOString(), expiresAt: Math.floor(Date.now() / 1000) + STAGING_SECONDS,
    creatorName: creatorName(context), ...(body.materialId === undefined ? {} : { originMaterialId: text(body.materialId, "Material ID", 160, false) }),
    ...(privateOnly ? { privateCopyId: randomUUID() } : {}),
    metadata: metadata(privateOnly && record(body.metadata) ? { ...body.metadata, sharingConfirmed: true } : body.metadata, Number(body.lessonNumber), strategy), format: "slides", lessonNumber: Number(body.lessonNumber), strategy,
    draft, assets, ...(derivedFrom ? { derivedFrom } : {}) });
  const generation = await resolveGeneration(context.userId, body.generation, source.lessonNumber, strategy, parent?.source.generation, "slides");
  if (generation) source.generation = generation;
  await captureAssetGenerations(source.assets, body.assets, context, source, parent?.source.assets);
  source.metadataOrigin = source.generation ? "captured" : "teacher_confirmed";
  const originalTags = galleryPromptTags(source.lessonNumber, strategy, "slides", source.metadata, draft);
  source.lessonIdentity = galleryLessonIdentity(source.generation?.tags) || galleryLessonIdentity(originalTags);
  source.promptTags = tagsFromGeneration(source, originalTags);
  boundedSource(source);
  assertGalleryStorage();
  await workspacePut([{ partition: PARTITION, key: sourceKey(source.id), value: source, createOnly: true, expiresAt: source.expiresAt }]);
  return { id: source.id };
}
async function commitPrivate(body: Record<string, unknown>, context: LibraryContext) {
  const source = await ownedSource(body.id, context.userId);
  if (!source.privateCopyId) throw new SlideRequestError("Choose a private material draft.", 422);
  const partition = libraryPartition(context.userId);
  const existing = await workspaceGet<Copy>(partition, `COPY#${source.privateCopyId}`);
  const copy: Copy = existing || { id: source.privateCopyId, ownerId: context.userId, classId: context.classId, assignmentId: context.assignmentId,
    templateId: source.id, source: { templateId: source.id, revision: 1, title: source.metadata.title, mode: "use", private: true }, createdAt: source.createdAt };
  if (!existing) {
    await activeStage(source.id, context.userId);
    const assets: { partition: string; key: string; value: GalleryBlob }[] = [];
    for (const [id, expected] of Object.entries(source.assets)) {
      const value = await workspaceGet<GalleryBlob>(PARTITION, assetKey(source.id, id));
      if (!value || value.digest !== expected.digest) throw new SlideRequestError("Include every slide image before saving.", 422);
      assets.push({ partition: PARTITION, key: assetKey(source.id, id), value });
    }
    try { await workspacePut([{ partition: PARTITION, key: sourceKey(source.id), value: source }, ...assets,
      { partition, key: `COPY#${copy.id}`, value: copy, createOnly: true }]); }
    catch (error) { if (!(await workspaceGet<Copy>(partition, `COPY#${copy.id}`))) throw error; }
  }
  return { copyId: copy.id, source: copy.source };
}

async function uploadAsset(body: Record<string, unknown>, context: LibraryContext) {
  const source = await activeStage(body.id, context.userId);
  if (source.format !== "slides" || typeof body.visualId !== "string" || !Object.hasOwn(source.assets, body.visualId)) throw new SlideRequestError("Choose an image in this template.", 422);
  const asset = body.asset;
  if (!isSlideAsset(asset) || asset.data.length > MAX_IMAGE_BYTES) throw new SlideRequestError("Use a PNG, JPEG or WebP image smaller than 3 MB.", 422);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/u.exec(asset.data)!;
  const bytes = Buffer.from(match[2], "base64"); const expected = source.assets[body.visualId];
  const size = imageDimensions(bytes, match[1]);
  if (bytes.toString("base64") !== match[2] || !size || expected.width !== asset.width || expected.height !== asset.height || size.width !== asset.width || size.height !== asset.height || digest(bytes) !== expected.digest)
    throw new SlideRequestError("The image changed or its dimensions do not match. Share the current material again.", 422);
  const key = assetKey(source.id, body.visualId);
  const existing = await workspaceGet<GalleryBlob>(PARTITION, key);
  if (!existing) {
    const saved = { ...await storeGalleryBlob(`material-gallery/${source.id}/${body.visualId}-${expected.digest}`, bytes, match[1]), width: asset.width, height: asset.height };
    try { await workspacePut([{ partition: PARTITION, key, value: saved, createOnly: true, expiresAt: source.expiresAt }]); }
    catch (error) { if ((await workspaceGet<GalleryBlob>(PARTITION, key))?.digest !== expected.digest) throw error; }
  }
  return { id: source.id, visualId: body.visualId };
}
async function commitShare(body: Record<string, unknown>, context: LibraryContext) {
  const source = await ownedSource(body.id, context.userId);
  if (source.privateCopyId) throw new SlideRequestError("Private material cannot be published through this operation. Use Share to Gallery after reviewing it.", 422);
  if (await workspaceGet(PARTITION, `WITHDRAWN#${source.id}`)) throw new SlideRequestError("This item was removed from the Gallery. Share a new copy instead.", 409);
  if (!(await isShared(source.id))) {
    await activeStage(source.id, context.userId);
    const durableAssets: { partition: string; key: string; value: GalleryBlob }[] = [];
    for (const [id, expected] of Object.entries(source.assets)) {
      const saved = await workspaceGet<GalleryBlob>(PARTITION, assetKey(source.id, id));
      if (!saved || saved.digest !== expected.digest) throw new SlideRequestError("Upload every slide image before sharing.", 422);
      durableAssets.push({ partition: PARTITION, key: assetKey(source.id, id), value: saved });
    }
    const material = materialSummary(source);
    // Make the source/assets durable in the same transaction that exposes the
    // template; an abandoned staging upload retains its expiry instead.
    try { await workspacePut([{ partition: PARTITION, key: sourceKey(source.id), value: source }, ...durableAssets,
      { partition: PARTITION, key: `SHARED#${source.id}`, value: { id: source.id, ownerId: context.userId, material }, createOnly: true }]); }
    catch (error) { if (!(await isShared(source.id))) throw error; }
  }
  if (source.originMaterialId) await indexGalleryUse(source.id, context, source.format === "slides" ? `slides-${source.originMaterialId}` : source.originMaterialId);
  return { material: { ...publicMaterial(source, context.userId), teacherCount: await teacherCount(source.id) } };
}

function videoItem(value: unknown, lessonNumber: number): ContentItem {
  if (!record(value)) throw new SlideRequestError("Choose a video material.", 422);
  const id = text(value.id, "Material ID", 160, false);
  const strategy = text(value.strategy, "Strategy", 80, false);
  if (!["analogy", "cognitive conflict", "experience bridging", "engaged critiquing"].includes(strategy)) throw new SlideRequestError("Choose a supported strategy.", 422);
  if (value.lessonNumber !== undefined && value.lessonNumber !== lessonNumber) throw new SlideRequestError("Share this material under its original lesson.", 422);
  let focus: GalleryFocus | undefined;
  if (value.focus !== undefined) {
    try {
      if (!resolveStrategyFocus(lessonNumber, strategy, value.focus)) throw new Error("Choose a valid material focus.");
    } catch (error) { throw new SlideRequestError(error instanceof Error ? error.message : "Choose a valid material focus.", 422); }
    const f = value.focus as Partial<GalleryFocus>;
    focus = { misconceptions: f.misconceptions ?? [], coreIdeas: f.coreIdeas ?? [] };
  }
  if (value.textModes !== undefined && (!Array.isArray(value.textModes) || value.textModes.length > 3
    || value.textModes.some(mode => !["questions", "phenomenon", "dialogue"].includes(mode)))) throw new SlideRequestError("The material text modes are invalid.", 422);
  const activity = value.activity === undefined ? undefined : parseMaterialActivity(value.activity, strategy);
  if (value.activity !== undefined && !activity) throw new SlideRequestError("The material activity is invalid.", 422);
  return { id, type: "Video", title: text(value.title, "Title", 160, false), body: text(value.body, "Material text", 16_000, false), strategy, lessonNumber,
    ...(focus ? { focus } : {}), ...(value.visualBrief !== undefined ? { visualBrief: text(value.visualBrief, "Video scene description", 5000) } : {}),
    ...(value.textModes !== undefined ? { textModes: [...new Set(value.textModes as TextMode[])] } : {}),
    ...(activity ? { activity } : {}) };
}
async function savedVideoMedia(context: LibraryContext, item: ContentItem, id: string, kind: "video" | "image") {
  const record = context.classId && context.assignmentId ? await getMedia(context.classId, context.assignmentId, "cohort", item.id, kind) : null;
  if (!record) {
    const copyId = /^gallery-copy-([a-f0-9-]{36})$/iu.exec(item.id)?.[1];
    if (copyId) {
      const { copy, source } = await copiedSource(context, copyId);
      const snapshot = copy.saved ? await workspaceGet<CopySnapshot>(copyPartition(context), snapshotKey(copy.saved.snapshotId)) : null;
      const saved = snapshot?.videoMedia?.[kind] || source.videoMedia?.[kind];
      if (saved) return duplicateGalleryBlob(`material-gallery/${id}/${kind}-${digest(randomUUID())}`, saved);
    }
    if (kind === "image") return undefined;
    throw new SlideRequestError("Save the generated video before sharing it.", 422);
  }
  if (record.class_id !== context.classId && record.class_id !== `CLASS#${context.classId}` || record.assignment_id !== context.assignmentId || record.student_id !== "cohort" || record.content_item_id !== item.id) throw new SlideRequestError("Saved media did not match this task.", 422);
  const mime = record.mime_type;
  if (kind === "video" ? mime !== "video/mp4" : !["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new SlideRequestError("This saved media format cannot be shared.", 422);
  const key = `material-gallery/${id}/${kind}-${digest(randomUUID())}`;
  if (record.s3_bucket && record.s3_key) return copyGalleryBlob(key, { bucket: record.s3_bucket, key: record.s3_key, mime });
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(record.data_url || "");
  if (!match || match[1] !== mime || match[2].length > 80_000_000) throw new SlideRequestError("This video is not durably saved. Save or regenerate it before sharing.", 422);
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.toString("base64") !== match[2]) throw new SlideRequestError("The saved media is invalid.", 422);
  return storeGalleryBlob(key, bytes, mime);
}
async function shareVideo(body: Record<string, unknown>, context: LibraryContext, privateOnly = false) {
  enterLessonScope(await loadTaskLessons(context, body.lessonNumber));
  if (!Number.isInteger(body.lessonNumber) || !getLesson(Number(body.lessonNumber))) throw new SlideRequestError("Choose a valid lesson.", 422);
  const item = videoItem(body.item, Number(body.lessonNumber));
  const meta = metadata(privateOnly && record(body.metadata) ? { ...body.metadata, sharingConfirmed: true } : body.metadata, Number(body.lessonNumber), item.strategy);
  // Focus belongs to the saved material, not the workspace's current selection.
  // Legacy materials without a recorded focus must remain unlabelled.
  if (meta.focus && (!item.focus || JSON.stringify([...meta.focus.misconceptions].sort()) !== JSON.stringify([...(item.focus.misconceptions ?? [])].sort())
    || JSON.stringify([...meta.focus.coreIdeas].sort()) !== JSON.stringify([...(item.focus.coreIdeas ?? [])].sort()))) {
    throw new SlideRequestError("The Gallery focus must match this material's saved focus.", 422);
  }
  if (item.focus) meta.focus = item.focus as GalleryFocus;
  const id = randomUUID(); assertGalleryStorage();
  const copyId = /^gallery-copy-([a-f0-9-]{36})$/iu.exec(item.id)?.[1];
  const parent = copyId ? await copiedSource(context, copyId) : undefined;
  const derivedFrom = parent && !parent.source.privateCopyId ? { templateId: parent.source.id, revision: parent.source.revision, title: parent.source.metadata.title } : undefined;
  const generation = await resolveGeneration(context.userId, record(body.item) ? body.item.generation : undefined, Number(body.lessonNumber), item.strategy, parent?.source.generation, "video");
  const video = await savedVideoMedia(context, item, id, "video");
  const image = await savedVideoMedia(context, item, id, "image");
  const source: Source = boundedSource({ id, revision: 1, ownerId: context.userId, createdAt: new Date().toISOString(), expiresAt: Math.floor(Date.now() / 1000) + STAGING_SECONDS,
    creatorName: creatorName(context), ...(generation ? { generation } : {}), metadataOrigin: generation ? "captured" : "teacher_confirmed", originMaterialId: item.id, ...(privateOnly ? { privateCopyId: randomUUID() } : {}),
    promptTags: galleryPromptTags(Number(body.lessonNumber), item.strategy, "video", meta, undefined, item.textModes),
    metadata: meta, format: "video", lessonNumber: Number(body.lessonNumber), strategy: item.strategy,
    // The originating class/task/content identifiers never enter the shared template.
    item: { ...item, id: `gallery-${id}` }, assets: {}, videoMedia: { video: video!, ...(image ? { image } : {}) }, ...(derivedFrom ? { derivedFrom } : {}) });
  source.lessonIdentity = galleryLessonIdentity(source.generation?.tags) || galleryLessonIdentity(source.promptTags);
  source.promptTags = tagsFromGeneration(source, source.promptTags || {});
  await workspacePut([{ partition: PARTITION, key: sourceKey(id), value: source, createOnly: true, expiresAt: source.expiresAt }]);
  return privateOnly ? commitPrivate({ id }, context) : commitShare({ id }, context);
}
async function copiedSource(context: LibraryContext, copyId: unknown) {
  const key = `COPY#${idValue(copyId)}`;
  const entry = await workspaceGet<Copy>(libraryPartition(context.userId), key);
  let partition = entry?.storagePartition || libraryPartition(context.userId);
  let copy = entry?.storagePartition ? await workspaceGet<Copy>(partition, key) : entry;
  if (!copy && context.classId && context.assignmentId) {
    partition = legacyCopyPartition(context);
    copy = await workspaceGet<Copy>(partition, key);
  }
  if (!copy || copy.ownerId !== context.userId) throw new SlideRequestError("Copied material not found.", 404);
  context.storagePartition = partition;
  const source = await workspaceGet<Source>(PARTITION, sourceKey(copy.templateId));
  if (!source) throw new SlideRequestError("Copied material not found.", 404);
  return { copy, source };
}

function sameFocus(a: unknown, b: unknown) {
  const normalized = (value: unknown) => record(value) ? JSON.stringify([
    Array.isArray(value.misconceptions) ? [...value.misconceptions].sort() : [],
    Array.isArray(value.coreIdeas) ? [...value.coreIdeas].sort() : [],
  ]) : "[[],[]]";
  return normalized(a) === normalized(b);
}
async function startCopySave(body: Record<string, unknown>, context: LibraryContext) {
  const { copy, source } = await copiedSource(context, body.copyId);
  enterLessonScope(await loadTaskLessons(context, source.lessonNumber));
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw new SlideRequestError("Provide the last saved revision.", 422);
  if ((copy.saved?.revision ?? 0) !== body.expectedRevision) throw saveConflict();
  const value = source.format === "slides" ? body.deck : body.item;
  if (!record(value) || value.id !== (source.format === "slides" ? copy.id : `gallery-copy-${copy.id}`)
    || value.lessonNumber !== source.lessonNumber || value.strategy !== source.strategy || !sameFocus(value.focus, copy.focus ?? source.metadata.focus)) {
    throw new SlideRequestError("Keep this copy's original lesson, strategy and focus.", 422);
  }
  if (value.gallerySource !== undefined && (!record(value.gallerySource)
    || Object.entries(copy.source).some(([key, expected]) => value.gallerySource && (value.gallerySource as Record<string, unknown>)[key] !== expected))) {
    throw new SlideRequestError("The copy's Gallery source does not match its receipt.", 422);
  }
  const id = randomUUID();
  const snapshot: CopySnapshot = { id, copyId: copy.id, expectedRevision: Number(body.expectedRevision), createdAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + STAGING_SECONDS, format: source.format, lessonNumber: source.lessonNumber, strategy: source.strategy, assets: {} };
  const generation = await resolveGeneration(context.userId, value.generation, source.lessonNumber, source.strategy, source.generation, source.format);
  if (generation) snapshot.generation = generation;
  if (source.format === "slides") {
    const draft = requestDraft(value.draft, slideContext(source).strategy, true);
    snapshot.draft = draft;
    snapshot.assets = parseAssetDescriptions(body.assets, draft);
    await captureAssetGenerations(snapshot.assets, body.assets, context, source, source.assets);
    snapshot.classroomContext = text(value.classroomContext, "Classroom context", 1200);
    snapshot.teachingContext = teachingSettings(value.teachingContext) ?? {};
    for (const [visualId, description] of Object.entries(snapshot.assets)) {
      const input = (body.assets as Record<string, Record<string, unknown>>)[visualId];
      if (input.sourcePrompt !== undefined) description.sourcePrompt = text(input.sourcePrompt, "Image source prompt", 50_000);
      if (input.referenceDigest !== undefined) {
        if (typeof input.referenceDigest !== "string" || !/^[a-f0-9]{64}$/u.test(input.referenceDigest)) throw new SlideRequestError("Invalid image reference.", 422);
        description.referenceDigest = input.referenceDigest;
      }
    }
  } else {
    snapshot.item = videoItem(value, source.lessonNumber);
    snapshot.teachingContext = teachingSettings(value.teachingContext) ?? {};
    snapshot.classroomContext = text(value.classroomContext, "Classroom context", 1200);
    const video = await savedVideoMedia(context, snapshot.item, id, "video");
    const image = await savedVideoMedia(context, snapshot.item, id, "image");
    snapshot.videoMedia = { video: video!, ...(image ? { image } : {}) };
  }
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_SOURCE_BYTES) throw new SlideRequestError("This copy is too large to save. Shorten its text and notes first.", 413);
  assertGalleryStorage();
  await workspacePut([{ partition: copyPartition(context), key: snapshotKey(id), value: snapshot, createOnly: true, expiresAt: snapshot.expiresAt }]);
  return { saveId: id };
}
async function copySaveStage(context: LibraryContext, copyId: unknown, saveId: unknown) {
  const { copy, source } = await copiedSource(context, copyId);
  const snapshot = await workspaceGet<CopySnapshot>(copyPartition(context), snapshotKey(idValue(saveId)));
  if (!snapshot || snapshot.copyId !== copy.id) throw new SlideRequestError("Saved copy not found.", 404);
  return { copy, source, snapshot };
}
async function uploadCopyAsset(body: Record<string, unknown>, context: LibraryContext) {
  const { snapshot } = await copySaveStage(context, body.copyId, body.saveId);
  const partition = copyPartition(context);
  if (await workspaceGet(partition, savedKey(snapshot.copyId, snapshot.expectedRevision + 1))) throw saveConflict();
  if (snapshot.expiresAt <= Date.now() / 1000) throw new SlideRequestError("This save upload expired. Save your current copy again.", 410);
  if (snapshot.format !== "slides" || typeof body.visualId !== "string" || !Object.hasOwn(snapshot.assets, body.visualId)) throw new SlideRequestError("Choose an image in this copy.", 422);
  const asset = body.asset;
  if (!isSlideAsset(asset) || asset.data.length > MAX_IMAGE_BYTES) throw new SlideRequestError("Use a PNG, JPEG or WebP image smaller than 3 MB.", 422);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/u.exec(asset.data)!;
  const bytes = Buffer.from(match[2], "base64"), expected = snapshot.assets[body.visualId], size = imageDimensions(bytes, match[1]);
  if (bytes.toString("base64") !== match[2] || !size || expected.width !== asset.width || expected.height !== asset.height
    || size.width !== asset.width || size.height !== asset.height || digest(bytes) !== expected.digest) throw new SlideRequestError("The image changed during saving. Save the current copy again.", 422);
  const key = assetKey(snapshot.id, body.visualId);
  const existing = await workspaceGet<GalleryBlob>(partition, key);
  if (!existing) {
    const saved = { ...await storeGalleryBlob(`material-gallery/${snapshot.id}/${body.visualId}-${expected.digest}`, bytes, match[1]), width: asset.width, height: asset.height };
    try { await workspacePut([{ partition, key, value: saved, createOnly: true, expiresAt: snapshot.expiresAt }]); }
    catch (error) { if ((await workspaceGet<GalleryBlob>(partition, key))?.digest !== expected.digest) throw error; }
  }
  return { saveId: snapshot.id, visualId: body.visualId };
}
async function commitCopySave(body: Record<string, unknown>, context: LibraryContext) {
  const { copy, source, snapshot } = await copySaveStage(context, body.copyId, body.saveId);
  const partition = copyPartition(context), revision = snapshot.expectedRevision + 1, key = savedKey(copy.id, revision);
  const previous = await workspaceGet<SavedGalleryCopySummary & { snapshotId: string }>(partition, key);
  // Retrying a lost success acknowledgement never overwrites a later revision.
  if (previous?.snapshotId === snapshot.id) { const { snapshotId: _id, ...summary } = previous; void _id; return { saved: summary }; }
  if (previous || (copy.saved?.revision ?? 0) !== snapshot.expectedRevision) throw saveConflict();
  if (snapshot.expiresAt <= Date.now() / 1000) throw new SlideRequestError("This save upload expired. Save your current copy again.", 410);
  const assets = [];
  for (const [visualId, description] of Object.entries(snapshot.assets)) {
    const asset = await workspaceGet<GalleryBlob>(partition, assetKey(snapshot.id, visualId));
    if (!asset || asset.digest !== description.digest) throw new SlideRequestError("Upload every current slide image before saving.", 422);
    assets.push({ partition, key: assetKey(snapshot.id, visualId), value: asset });
  }
  const saved: SavedGalleryCopySummary = { copyId: copy.id, revision, savedAt: new Date().toISOString(), title: snapshot.draft?.title ?? snapshot.item!.title,
    format: source.format, lessonNumber: source.lessonNumber, strategy: source.strategy, source: copy.source };
  const pointer = { ...saved, snapshotId: snapshot.id };
  try {
    // The create-only revision record is the compare-and-swap guard. Snapshot,
    // images and receipt pointer become durable in the very same transaction.
    await workspacePut([{ partition, key, value: pointer, createOnly: true },
      { partition, key: snapshotKey(snapshot.id), value: snapshot }, ...assets,
      { partition, key: `COPY#${copy.id}`, value: { ...copy, saved: pointer } },
      ...(partition === libraryPartition(context.userId) ? [] : [{ partition: libraryPartition(context.userId), key: `COPY#${copy.id}`, value: { ...copy, storagePartition: partition } }]),
      // One stable key per verified teacher across copies, classes and retries.
      // Coupled to the successful save transaction, never to preview or open.
      { partition: usagePartition(source.id), key: `TEACHER#${digest(context.userId)}`,
        value: { teacherId: context.userId, templateId: source.id, classId: context.classId, assignmentId: context.assignmentId, copyId: copy.id, savedAt: saved.savedAt } }]);
  } catch (error) {
    const winner = await workspaceGet<{ snapshotId: string }>(partition, key);
    if (winner?.snapshotId !== snapshot.id) { if (winner) throw saveConflict(); throw error; }
  }
  return { saved };
}
async function savedSnapshot(context: LibraryContext, copyId: unknown, revision?: number) {
  const { copy, source } = await copiedSource(context, copyId);
  const pointer = revision === undefined ? copy.saved : await workspaceGet<SavedGalleryCopySummary & { snapshotId: string }>(copyPartition(context), savedKey(copy.id, revision));
  if (!pointer) throw new SlideRequestError("This copy has not been saved yet.", 404);
  const snapshot = await workspaceGet<CopySnapshot>(copyPartition(context), snapshotKey(pointer.snapshotId));
  if (!snapshot || snapshot.copyId !== copy.id) throw new SlideRequestError("The saved copy is unavailable.", 503);
  return { copy, source, snapshot, pointer };
}

/** Authorize the copy before reading private context or invoking an AI provider. */
export async function videoAdaptationInput(request: Request, body: Record<string, unknown>) {
  const context = await authorizeMaterialLibrary(request, body);
  const { copy, source } = await copiedSource(context, body.copyId);
  if (source.format !== "video" || !source.item) throw new SlideRequestError("Choose a video material.", 422);
  enterLessonScope(await loadTaskLessons(context, source.lessonNumber));
  const current = record(body.item) ? body.item : { ...source.item, id: `gallery-copy-${copy.id}`, focus: copy.focus ?? source.metadata.focus };
  if (current.id !== `gallery-copy-${copy.id}` || current.strategy !== source.strategy || !sameFocus(current.focus, copy.focus ?? source.metadata.focus)) {
    throw new SlideRequestError("Open the current video copy before adapting it.", 422);
  }
  const item = { ...videoItem(current, source.lessonNumber), gallerySource: copy.source,
    classroomContext: text(body.classroomContext, "Classroom context", 1200), teachingContext: teachingSettings(body.teachingContext) };
  const generation = await resolveGeneration(context.userId, current.generation, source.lessonNumber, source.strategy, source.generation, "video");
  if (generation) item.generation = generation;
  return { context, item };
}
async function loadCopySave(context: LibraryContext, copyId: unknown) {
  const { copy, source, snapshot, pointer } = await savedSnapshot(context, copyId);
  const common = { source: copy.source };
  return { revision: pointer.revision, savedAt: pointer.savedAt,
    copy: snapshot.format === "slides" ? { ...common, format: "slides", deck: { id: copy.id, lessonNumber: source.lessonNumber, strategy: source.strategy,
      draft: snapshot.draft, ...(snapshot.generation ? { generation: snapshot.generation } : {}), assets: {}, libraryRevision: pointer.revision, gallerySource: copy.source, classroomContext: snapshot.classroomContext, teachingContext: snapshot.teachingContext,
      ...((copy.focus ?? source.metadata.focus) ? { focus: copy.focus ?? source.metadata.focus } : {}) } } : { ...common, format: "video", item: { ...snapshot.item,
      gallerySource: copy.source, ...(snapshot.generation ? { generation: snapshot.generation } : {}), teachingContext: snapshot.teachingContext, classroomContext: snapshot.classroomContext }, media: await videoUrls(snapshot) },
    visualIds: Object.keys(snapshot.assets) };
}
async function savedCopyAsset(context: LibraryContext, params: URLSearchParams) {
  const revision = Number(params.get("revision"));
  if (!Number.isSafeInteger(revision) || revision < 1) throw new SlideRequestError("Choose a saved revision.", 422);
  const { snapshot } = await savedSnapshot(context, params.get("copyId"), revision);
  const visualId = params.get("visualId");
  if (!visualId || !Object.hasOwn(snapshot.assets, visualId)) throw new SlideRequestError("Saved image not found.", 404);
  const asset = await workspaceGet<GalleryBlob>(copyPartition(context), assetKey(snapshot.id, visualId));
  if (!asset) throw new SlideRequestError("The saved image is unavailable.", 503);
  const bytes = await readGalleryBlob(asset);
  if (bytes.length > MAX_IMAGE_BYTES || digest(bytes) !== snapshot.assets[visualId].digest) throw new SlideRequestError("The saved image could not be verified.", 503);
  const description = snapshot.assets[visualId];
  return { asset: { data: `data:${asset.mime};base64,${bytes.toString("base64")}`, width: asset.width, height: asset.height,
    ...(description.sourcePrompt === undefined ? {} : { sourcePrompt: description.sourcePrompt }), ...(description.generation ? { generation: description.generation } : {}) }, referenceDigest: description.referenceDigest };
}
async function copyMaterial(body: Record<string, unknown>, context: LibraryContext) {
  if (body.mode !== "use" && body.mode !== "adapt") throw new SlideRequestError("Choose use or adapt.");
  const source = await sharedSource(body.id);
  let selectedFocus = source.metadata.focus;
  let classroomContext = "";
  let teachingContext = teachingSettings({ gradeBand: source.metadata.gradeBand || "", quizPattern: source.metadata.quizPattern || "", experienceContext: source.metadata.experienceContext || "" });
  if (body.mode === "adapt" && body.adaptation !== undefined) {
    if (!record(body.adaptation)) throw new SlideRequestError("Choose valid adaptation settings.", 422);
    enterLessonScope(await loadTaskLessons(context, source.lessonNumber));
    const adapted = body.adaptation;
    classroomContext = text(adapted.classroomContext, "Classroom context", 1200);
    teachingContext = teachingSettings(adapted.teachingContext);
    if (adapted.focus !== undefined) {
      try { resolveStrategyFocus(source.lessonNumber, source.strategy, adapted.focus); selectedFocus = adapted.focus as GalleryFocus; }
      catch { throw new SlideRequestError("Choose focus items from this lesson.", 422); }
    }
  }
  const copy: Copy = { id: randomUUID(), ownerId: context.userId, classId: context.classId, assignmentId: context.assignmentId, templateId: source.id,
    ...(selectedFocus ? { focus: selectedFocus } : {}), classroomContext, teachingContext: teachingContext ?? {},
    source: { templateId: source.id, revision: source.revision, title: source.metadata.title, mode: body.mode }, createdAt: new Date().toISOString() };
  await workspacePut([{ partition: libraryPartition(context.userId), key: `COPY#${copy.id}`, value: copy, createOnly: true },
    ...(context.classId && context.assignmentId ? [{ partition: legacyCopyPartition(context), key: `COPY#${copy.id}`, value: { ...copy, deliveryOnly: true }, createOnly: true }] : [])]);
  await indexGalleryUse(source.id, context, source.format === "slides" ? `slides-${copy.id}` : `gallery-copy-${copy.id}`);
  if (source.format === "slides") return { format: "slides", copyId: copy.id, source: copy.source,
    deck: { id: copy.id, lessonNumber: source.lessonNumber, strategy: source.strategy, draft: source.draft, ...(source.generation ? { generation: shareableGeneration(source.generation) } : {}), assets: {}, gallerySource: copy.source, classroomContext, teachingContext,
      ...(selectedFocus ? { focus: selectedFocus } : {}) }, visualIds: Object.keys(source.assets) };
  return { format: "video", copyId: copy.id, source: copy.source, item: { ...source.item, id: `gallery-copy-${copy.id}`, lessonNumber: source.lessonNumber,
    ...(selectedFocus ? { focus: selectedFocus } : {}), ...(source.generation ? { generation: shareableGeneration(source.generation) } : {}), gallerySource: copy.source, teachingContext, classroomContext }, media: await videoUrls(source) };
}
async function videoUrls(source: { videoMedia?: Source["videoMedia"] }) {
  if (!source.videoMedia) throw new SlideRequestError("Saved video is missing.", 503);
  return { video: await galleryBlobUrl(source.videoMedia.video), ...(source.videoMedia.image ? { image: await galleryBlobUrl(source.videoMedia.image) } : {}) };
}

/** A copied draft is private to its teacher/task even before student publication. */
async function copyVideoMedia(context: LibraryContext, copyId: unknown) {
  const { copy, source } = await copiedSource(context, copyId);
  if (source.format !== "video") throw new SlideRequestError("Choose a copied video material.", 422);
  const contentItemId = `gallery-copy-${copy.id}`;
  const [fallback, image, video] = await Promise.all([
    videoUrls(source),
    context.classId ? getMedia(context.classId, context.assignmentId, "cohort", contentItemId, "image") : null,
    context.classId ? getMedia(context.classId, context.assignmentId, "cohort", contentItemId, "video") : null,
  ]);
  const media = { ...fallback };
  for (const [kind, saved] of [["image", image], ["video", video]] as const) {
    if (!saved) continue;
    if (![context.classId, `CLASS#${context.classId}`].includes(saved.class_id) || saved.assignment_id !== context.assignmentId
      || saved.student_id !== "cohort" || saved.content_item_id !== contentItemId || saved.media_type !== kind) {
      throw new SlideRequestError("Saved media did not match this task.", 422);
    }
    if (!saved.data_url) throw new SlideRequestError("The saved video links could not be refreshed. Please try again.", 503);
    // An adapted copy may have newly generated task media. Never replace it
    // with the Gallery original when renewing a draft's expiring URLs.
    media[kind] = saved.data_url;
  }
  return { media };
}

/** Called only after the content-publish handler authorizes this task. URLs are renewed on every read. */
export async function resolveGalleryContentMedia(classId: string, assignmentId: string, contentItemId: string) {
  const match = /^gallery-copy-([0-9a-f-]{36})$/iu.exec(contentItemId);
  if (!match) return undefined;
  const copy = await workspaceGet<Copy>(copyPartition({ classId, assignmentId }), `COPY#${match[1]}`);
  if (!copy || copy.classId !== classId || copy.assignmentId !== assignmentId) return undefined;
  if (copy.videoMedia) return videoUrls(copy);
  const source = await workspaceGet<Source>(PARTITION, sourceKey(copy.templateId));
  return source?.format === "video" ? videoUrls(source) : undefined;
}

export async function galleryPost(request: Request, body: Record<string, unknown>) {
  const context = await authorizeMaterialLibrary(request, body);
  switch (body.action) {
    case "update-metadata": {
      const source = await ownedSource(body.id, context.userId);
      if (!(await isShared(source.id))) throw new SlideRequestError("Choose a shared material.", 404);
      if (body.expectedMetadataRevision !== (source.metadataRevision || 0)) throw new SlideRequestError("These details changed. Reopen them before saving.", 409);
      enterLessonScope(await loadTaskLessons(context, source.lessonNumber));
      if (!record(body.metadata) || body.metadata.sharingConfirmed !== true) throw new SlideRequestError("Review the public labels before saving.", 422);
      const updated = metadata({ ...source.metadata, ...body.metadata }, source.lessonNumber, source.strategy);
      if (source.metadata.focus && !sameFocus(updated.focus, source.metadata.focus)) throw new SlideRequestError("Keep this material's recorded focus.", 422);
      const next: Source = { ...source, metadata: { ...source.metadata, ...updated }, creatorName: source.creatorName || creatorName(context),
        lessonIdentity: source.lessonIdentity || galleryLessonIdentity(source.generation?.tags) || galleryLessonIdentity(source.promptTags),
        metadataRevision: (source.metadataRevision || 0) + 1, metadataOrigin: source.generation ? "captured" : "teacher_confirmed" };
      const rebuilt = galleryPromptTags(source.lessonNumber, source.strategy, source.format, next.metadata, source.draft, source.item?.textModes);
      next.promptTags = tagsFromGeneration(next, { ...rebuilt, ...source.promptTags, GRADE_LEVEL: updated.gradeBand || "Not supplied", CURRENT_UNDERSTANDING: updated.quizPattern || "Not shared", LEARNER_CONTEXT: updated.teachingContext || "Not shared", CLASS_PROFILE: updated.classProfile || "Not shared", EXPERIENCE_CONTEXT: updated.experienceContext || "Not supplied", KEYWORDS: updated.keywords?.join(", ") || "" });
      try {
        await workspacePut([
          { partition: PARTITION, key: `METADATA#${source.id}#${next.metadataRevision}`, createOnly: true, value: { before: source.metadata, after: next.metadata, updatedBy: context.userId, updatedAt: new Date().toISOString() } },
          { partition: PARTITION, key: sourceKey(source.id), value: boundedSource(next) },
          { partition: PARTITION, key: `SHARED#${source.id}`, value: { id: source.id, ownerId: source.ownerId, material: materialSummary(next) } },
        ]);
      } catch (error) {
        if (await workspaceGet(PARTITION, `METADATA#${source.id}#${next.metadataRevision}`)) throw new SlideRequestError("These details changed. Reopen them before saving.", 409);
        throw error;
      }
      return { material: { ...publicMaterial(next, context.userId), teacherCount: await teacherCount(source.id) } };
    }
    case "save-private-video": return shareVideo(body, context, true);
    case "prepare-delivery": {
      const target = await authorizeSlides(request, body);
      const { copy, source } = await copiedSource(context, body.copyId);
      if (!copy.saved) throw new SlideRequestError("Save this material before sending it.", 422);
      const { snapshot } = await savedSnapshot(context, copy.id);
      // A delivery gets its own immutable ID. Preparing a newer saved version
      // must not change the media of an already-published version, even if the
      // later publish fails. Never overwrite a legacy copy's canonical receipt.
      const partition = legacyCopyPartition(target);
      const key = `DELIVERY#${copy.id}#${copy.saved.revision}`;
      let delivery = await workspaceGet<{ id: string }>(partition, key);
      if (!delivery) {
        delivery = { id: randomUUID() };
        const videoMedia = snapshot.videoMedia || source.videoMedia;
        try { await workspacePut([
          { partition, key, value: delivery, createOnly: true },
          { partition, key: `COPY#${delivery.id}`, createOnly: true,
            value: { ...copy, id: delivery.id, classId: target.classId, assignmentId: target.assignmentId, deliveryOnly: true,
              ...(videoMedia ? { videoMedia } : {}) } },
        ]); } catch (error) {
          const existing = await workspaceGet<{ id: string }>(partition, key);
          if (!existing) throw error;
          delivery = existing;
        }
      }
      await indexGalleryUse(source.id, target, `gallery-copy-${delivery.id}`);
      return { ready: true, contentItemId: `gallery-copy-${delivery.id}` };
    }
    case "start-save": return startCopySave(body, context);
    case "upload-copy-asset": return uploadCopyAsset(body, context);
    case "commit-save": return commitCopySave(body, context);
    case "start-private-save": return startShare(body, context, true);
    case "commit-private-save": return commitPrivate(body, context);
    case "start-share": return startShare(body, context);
    case "upload-asset": return uploadAsset(body, context);
    case "commit-share": return commitShare(body, context);
    case "share-video": return shareVideo(body, context);
    case "copy": return copyMaterial(body, context);
    case "unshare": {
      const source = await ownedSource(body.id, context.userId);
      // Withdrawal wins over any concurrent commit and never deletes existing copies.
      if (!(await workspaceGet(PARTITION, `WITHDRAWN#${source.id}`))) {
        try { await workspacePut([{ partition: PARTITION, key: `WITHDRAWN#${source.id}`, value: { id: source.id, withdrawnAt: new Date().toISOString() }, createOnly: true }]); }
        catch (error) { if (!(await workspaceGet(PARTITION, `WITHDRAWN#${source.id}`))) throw error; }
      }
      return { removed: true };
    }
    default: throw new SlideRequestError("Unsupported material library operation.");
  }
}

export async function galleryGet(request: Request) {
  const params = new URL(request.url).searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length) throw new SlideRequestError("Repeated query parameters are not allowed.");
  const context = await authorizeMaterialLibrary(request, Object.fromEntries(params));
  if (params.get("action") === "saved-copy") return loadCopySave(context, params.get("copyId"));
  if (params.get("action") === "saved-asset") return savedCopyAsset(context, params);
  if (params.get("action") === "saved-copies") {
    const partition = libraryPartition(context.userId);
    if (!await workspaceGet(partition, "LEGACY_INDEXED_V2")) {
      for (const legacy of await legacyGalleryCopies<Copy>(context.userId)) {
        const original = await workspaceGet<Source>(PARTITION, sourceKey(legacy.value.templateId));
        if (original) await indexGalleryUse(original.id, legacy.value, original.format === "slides" ? `slides-${legacy.value.id}` : `gallery-copy-${legacy.value.id}`);
        if (!legacy.value.saved || legacy.value.deliveryOnly) continue;
        const key = `COPY#${legacy.value.id}`;
        if (!await workspaceGet(partition, key)) {
          try { await workspacePut([{ partition, key, value: { ...legacy.value, storagePartition: legacy.partition }, createOnly: true }]); }
          catch (error) { if (!await workspaceGet(partition, key)) throw error; }
        }
      }
      await workspacePut([{ partition, key: "LEGACY_INDEXED_V2", value: { indexedAt: new Date().toISOString() } }]);
    }
    const entries = await workspaceQuery<Copy>(partition, "COPY#");
    const copies = await Promise.all(entries.map(entry => entry.storagePartition ? workspaceGet<Copy>(entry.storagePartition, `COPY#${entry.id}`) : entry));
    return { items: copies.filter((copy): copy is Copy => !!copy && copy.ownerId === context.userId && !!copy.saved)
      .map(copy => { const { snapshotId: _id, ...summary } = copy.saved!; void _id; return summary; }).sort((a, b) => b.savedAt.localeCompare(a.savedAt)) };
  }
  if (params.get("action") === "copy-media") return copyVideoMedia(context, params.get("copyId"));
  if (params.get("action") === "copy-attribution") {
    const { source } = await copiedSource(context, params.get("copyId"));
    return { ...publicMaterial(source, context.userId), teacherCount: await teacherCount(source.id), feedback: await galleryFeedback(source.id) };
  }
  if (params.get("action") === "asset") {
    const { source } = params.has("copyId") ? await copiedSource(context, params.get("copyId")) : { source: await sharedSource(params.get("id")) };
    const visualId = params.get("visualId");
    if (!visualId || !Object.hasOwn(source.assets, visualId)) throw new SlideRequestError("Gallery image not found.", 404);
    const asset = await workspaceGet<GalleryBlob>(PARTITION, assetKey(source.id, visualId));
    if (!asset) throw new SlideRequestError("Gallery image not found.", 404);
    const bytes = await readGalleryBlob(asset);
    if (bytes.length > MAX_IMAGE_BYTES || digest(bytes) !== asset.digest) throw new SlideRequestError("The saved image could not be verified. Please try another material.", 503);
    return { asset: { data: `data:${asset.mime};base64,${bytes.toString("base64")}`, width: asset.width, height: asset.height, ...(source.assets[visualId].generation ? { generation: shareableGeneration(source.assets[visualId].generation!) } : {}) } };
  }
  if (params.has("id")) {
    const source = await sharedSource(params.get("id"));
    return { material: { ...publicMaterial(source, context.userId), teacherCount: await teacherCount(source.id), feedback: await galleryFeedback(source.id) }, ...(source.format === "slides" ? { draft: source.draft, visualIds: Object.keys(source.assets) } : { item: source.item, media: await videoUrls(source) }),
      lessonNumber: source.lessonNumber, strategy: source.strategy };
  }
  const filters: GalleryFilters = {};
  if (params.has("lessonNumber")) {
    const n = Number(params.get("lessonNumber")); if (!Number.isSafeInteger(n) || n < 1) throw new SlideRequestError("Choose a valid lesson."); filters.lessonNumber = n;
  }
  const strategies = ["analogy", "cognitive conflict", "engaged critiquing", "experience bridging"];
  if (params.has("strategy")) { filters.strategy = text(params.get("strategy"), "Strategy", 80, false); if (!strategies.includes(filters.strategy)) throw new SlideRequestError("Choose a supported strategy."); }
  const recommendLesson = Number(params.get("recommendLesson") || 0), recommendStrategy = params.get("recommendStrategy") || "";
  if (!Number.isSafeInteger(recommendLesson) || recommendLesson < 0 || (recommendStrategy && !strategies.includes(recommendStrategy))) throw new SlideRequestError("Choose a valid recommendation context.");
  let recommendFocus: GalleryFocus | undefined;
  if (params.has("recommendFocus")) {
    try {
      const value = JSON.parse(params.get("recommendFocus")!);
      if (!record(value) || !Array.isArray(value.misconceptions) || value.misconceptions.length > 2 || !value.misconceptions.every(v => typeof v === "string" && v.length < 100)
        || !Array.isArray(value.coreIdeas) || value.coreIdeas.length > 2 || !value.coreIdeas.every(v => Number.isSafeInteger(v) && v >= 0)) throw new Error();
      recommendFocus = value as GalleryFocus;
    } catch { throw new SlideRequestError("Choose a valid recommendation focus."); }
  }
  let recommendationTags: Record<string, string> | undefined;
  if (recommendLesson) {
    enterLessonScope(await loadTaskLessons(context, recommendLesson));
    const lesson = getLesson(recommendLesson);
    if (lesson) recommendationTags = { TOPIC: lesson.topic?.trim() && lesson.target_concept?.trim() ? lesson.topic.trim() : lesson.lesson_title, LEARNING_OBJECTIVE: lesson.learning_objective };
  }
  const recommendationSettings = {
    GRADE_LEVEL: text(params.get("recommendGrade") ?? undefined, "Recommendation grade", 80),
    CURRENT_UNDERSTANDING: text(params.get("recommendQuiz") ?? undefined, "Recommendation quiz pattern", 200),
    EXPERIENCE_CONTEXT: text(params.get("recommendExperience") ?? undefined, "Recommendation experience", 200),
    FORMAT: params.get("format") || "",
  };
  if (recommendationTags) recommendationTags = { ...recommendationTags, ...recommendationSettings };
  if (params.has("format")) { if (!["slides", "video"].includes(params.get("format")!)) throw new SlideRequestError("Choose slides or video."); filters.format = params.get("format") as "slides" | "video"; }
  const gradeBand = canonicalGrade(text(params.get("gradeBand") ?? undefined, "Grade band", 80)).toLocaleLowerCase();
  const recommendedOnly = params.get("recommendedOnly") === "true";
  if (recommendedOnly && (!recommendLesson || !recommendStrategy || !filters.format)) throw new SlideRequestError("Choose a lesson, strategy and material type for recommendations.");
  const search = text(params.get("search") ?? undefined, "Search", 200).toLocaleLowerCase();
  const requestedLimit = params.has("limit") ? Number(params.get("limit")) : 12;
  const limit = recommendedOnly ? Math.min(requestedLimit, 3) : requestedLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 60) throw new SlideRequestError("Page size must be between 1 and 60.");
  const fingerprint = digest(JSON.stringify([filters, search, params.get("mine") === "true", context.userId, recommendLesson, recommendStrategy, recommendFocus, recommendationTags, recommendedOnly, gradeBand]));
  let after = "";
  if (params.has("cursor")) {
    try { const c = JSON.parse(Buffer.from(params.get("cursor")!, "base64url").toString()); if (!record(c) || c.fingerprint !== fingerprint || typeof c.after !== "string" || c.after.length > 90) throw new Error(); after = c.after; }
    catch { throw new SlideRequestError("The Gallery page changed. Refresh the list."); }
  }
  const [shared, withdrawals] = await Promise.all([workspaceQuery<Shared>(PARTITION, "SHARED#"), workspaceQuery<{ id: string }>(PARTITION, "WITHDRAWN#")]);
  const withdrawn = new Set(withdrawals.map(row => row.id));
  const available = shared.filter(row => !withdrawn.has(row.id) && (!filters.format || row.material.format === filters.format));
  const rank = (row: Shared) => galleryMatches({ ...row.material, isOwner: row.ownerId === context.userId }, recommendLesson, recommendStrategy, recommendFocus, recommendationTags);
  const orderKey = (row: Shared) => `${String(rank(row).score).padStart(2, "0")}|${row.material.createdAt}|${row.id}`;
  const matches = available.filter(row => (params.get("mine") !== "true" || row.ownerId === context.userId)
    && (!gradeBand || canonicalGrade(row.material.gradeBand).toLocaleLowerCase() === gradeBand)
    && (!recommendedOnly || (!!recommendationTags && !!row.material.promptTags && rank(row).reasons.includes("Same lesson")
      && rank(row).reasons.includes("Same strategy") && (!recommendFocus || !(recommendFocus.misconceptions.length || recommendFocus.coreIdeas.length) || rank(row).reasons.includes("Same focus"))))
    && (!filters.lessonNumber || row.material.lessonNumber === filters.lessonNumber) && (!filters.strategy || row.material.strategy === filters.strategy)
    && (!search || [row.material.title, row.material.description, row.material.experienceContext, row.material.gradeBand, row.material.quizPattern, row.material.strategy,
      row.material.creatorName, ...Object.values(row.material.promptTags || {})].join(" ").toLocaleLowerCase().includes(search)))
    .sort((a, b) => orderKey(b).localeCompare(orderKey(a)))
    .filter(row => !after || orderKey(row) < after);
  const page = matches.slice(0, limit); const last = page.at(-1);
  const feedbackCache = galleryFeedbackCache();
  return { items: await Promise.all(page.map(async row => {
    const source = await workspaceGet<Source>(PARTITION, sourceKey(row.id));
    const firstSlide = source?.format === "slides" ? source.draft?.slides[0] : undefined;
    const firstVisual = source?.draft && isSlideStrategy(source.strategy)
      ? draftVisibleVisualIds(source.draft, source.strategy, 0).find(id => source.assets[id]) : undefined;
    const image = source?.format === "video" ? source.videoMedia?.image
      : firstVisual ? await workspaceGet<GalleryBlob>(PARTITION, assetKey(row.id, firstVisual)) : null;
    return { ...row.material, isOwner: row.ownerId === context.userId, teacherCount: await teacherCount(row.id), feedback: await galleryFeedback(row.id, feedbackCache),
      ...(firstSlide ? { previewSlide: { stage: firstSlide.stage, title: firstSlide.title, body: firstSlide.body, task: firstSlide.task } } : {}),
      ...(image ? { previewImage: await galleryBlobUrl(image) } : {}),
      ...(recommendLesson || recommendStrategy ? { matchReasons: rank(row).reasons, matchTags: rank(row).tags } : {}) };
  })),
    facets: { lessons: [...new Set(available.map(row => row.material.lessonNumber))].sort((a, b) => a - b), strategies: [...new Set(available.map(row => row.material.strategy))].sort(), grades: [...new Set(available.map(row => canonicalGrade(row.material.gradeBand)).filter(Boolean))].sort() },
    ...(!recommendedOnly && matches.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify({ fingerprint, after: orderKey(last) })).toString("base64url") } : {}) };
}
