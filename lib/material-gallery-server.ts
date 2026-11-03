import { createHash, randomUUID } from "node:crypto";
import { workspaceGet, workspacePut, workspaceQuery } from "./workspace-store";
import { authorizeSlides, requestDraft, slideContext, SlideRequestError, type AuthorizedSlideContext } from "./slides/server";
import { getLesson } from "./quiz-data";
import { resolveStrategyFocus } from "./strategy-focus";
import { getMedia } from "./nosql";
import { parseMaterialActivity } from "./material-activities";
import { isSlideAsset, type SlideDraft } from "./slides/model";
import type { ContentItem, TextMode } from "./types";
import type { GalleryFilters, GalleryFocus, GalleryMaterial, GalleryMetadata, GalleryProvenance, GalleryScope } from "./material-gallery";
import { assertGalleryStorage, copyGalleryBlob, duplicateGalleryBlob, galleryBlobUrl, readGalleryBlob, storeGalleryBlob, type GalleryBlob } from "./material-gallery-storage";

const PARTITION = "MATERIAL_GALLERY#v1";
const MAX_SOURCE_BYTES = 180_000;
const MAX_IMAGE_BYTES = 4_350_000;
const STAGING_SECONDS = 30 * 60;
type AssetDescription = { width: number; height: number; digest: string };
type Source = {
  id: string; revision: 1; ownerId: string; createdAt: string; expiresAt: number;
  metadata: Omit<GalleryMetadata, "sharingConfirmed">;
  lessonNumber: number; strategy: string; format: "slides" | "video";
  draft?: SlideDraft; item?: ContentItem; assets: Record<string, AssetDescription>;
  videoMedia?: { video: GalleryBlob; image?: GalleryBlob };
  derivedFrom?: Pick<GalleryProvenance, "templateId" | "revision" | "title">;
};
type Copy = { id: string; ownerId: string; classId: string; assignmentId: string; templateId: string; source: GalleryProvenance; createdAt: string };
type Shared = { id: string; ownerId: string; material: Omit<GalleryMaterial, "isOwner"> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const sourceKey = (id: string) => `SOURCE#${id}`;
const assetKey = (id: string, visualId: string) => `ASSET#${id}#${visualId}`;
const copyPartition = (scope: GalleryScope) => `GALLERY_COPIES#${createHash("sha256").update(JSON.stringify([scope.classId, scope.assignmentId])).digest("hex")}`;
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const idValue = (value: unknown) => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new SlideRequestError("Choose a valid Gallery material.");
  return value;
};
function text(value: unknown, label: string, max: number, optional = true) {
  if (value === undefined && optional) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) throw new SlideRequestError(`${label} must be ${optional ? "at most" : "1–"}${max} characters of plain text.`);
  return value.trim();
}
function metadata(value: unknown, lessonNumber: number, strategy: string): Source["metadata"] {
  if (!record(value) || value.sharingConfirmed !== true) throw new SlideRequestError("Review the shared content and confirm that class details have been removed.", 422);
  if (Object.keys(value).some(key => !["title", "description", "gradeBand", "experienceContext", "quizPattern", "focus", "sharingConfirmed"].includes(key))) throw new SlideRequestError("Unexpected sharing metadata.");
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
    gradeBand: text(value.gradeBand, "Grade band", 80), experienceContext: text(value.experienceContext, "Experience context", 200),
    quizPattern: text(value.quizPattern, "Quiz pattern", 200), ...(focus ? { focus } : {}) };
}
function materialSummary(source: Source): Omit<GalleryMaterial, "isOwner"> {
  return { id: source.id, revision: source.revision, title: source.metadata.title,
    description: source.metadata.description || "", gradeBand: source.metadata.gradeBand || "", experienceContext: source.metadata.experienceContext || "",
    quizPattern: source.metadata.quizPattern || "", ...(source.metadata.focus ? { focus: source.metadata.focus } : {}),
    lessonNumber: source.lessonNumber, strategy: source.strategy, format: source.format, createdAt: source.createdAt,
    ...(source.draft ? { slideCount: source.draft.slides.length } : {}), ...(source.derivedFrom ? { derivedFrom: source.derivedFrom } : {}) };
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

async function startShare(body: Record<string, unknown>, context: AuthorizedSlideContext) {
  const { strategy } = slideContext(body);
  const draft = requestDraft(body.draft, strategy, true);
  const assets = parseAssetDescriptions(body.assets, draft);
  const parent = body.copyId === undefined ? undefined : await copiedSource(context, body.copyId);
  const derivedFrom = parent ? { templateId: parent.source.id, revision: parent.source.revision, title: parent.source.metadata.title } : undefined;
  const source: Source = boundedSource({ id: randomUUID(), revision: 1, ownerId: context.userId, createdAt: new Date().toISOString(), expiresAt: Math.floor(Date.now() / 1000) + STAGING_SECONDS,
    metadata: metadata(body.metadata, Number(body.lessonNumber), strategy), format: "slides", lessonNumber: Number(body.lessonNumber), strategy,
    draft, assets, ...(derivedFrom ? { derivedFrom } : {}) });
  assertGalleryStorage();
  await workspacePut([{ partition: PARTITION, key: sourceKey(source.id), value: source, createOnly: true, expiresAt: source.expiresAt }]);
  return { id: source.id };
}
async function uploadAsset(body: Record<string, unknown>, context: AuthorizedSlideContext) {
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
async function commitShare(body: Record<string, unknown>, context: AuthorizedSlideContext) {
  const source = await ownedSource(body.id, context.userId);
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
  return { material: publicMaterial(source, context.userId) };
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
async function savedVideoMedia(context: AuthorizedSlideContext, item: ContentItem, id: string, kind: "video" | "image") {
  const record = await getMedia(context.classId, context.assignmentId, "cohort", item.id, kind);
  if (!record) {
    const copyId = /^gallery-copy-([a-f0-9-]{36})$/iu.exec(item.id)?.[1];
    if (copyId) {
      const { source } = await copiedSource(context, copyId);
      const saved = source.videoMedia?.[kind];
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
async function shareVideo(body: Record<string, unknown>, context: AuthorizedSlideContext) {
  if (!Number.isInteger(body.lessonNumber) || !getLesson(Number(body.lessonNumber))) throw new SlideRequestError("Choose a valid lesson.", 422);
  const item = videoItem(body.item, Number(body.lessonNumber));
  const meta = metadata(body.metadata, Number(body.lessonNumber), item.strategy);
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
  const derivedFrom = parent ? { templateId: parent.source.id, revision: parent.source.revision, title: parent.source.metadata.title } : undefined;
  const video = await savedVideoMedia(context, item, id, "video");
  const image = await savedVideoMedia(context, item, id, "image");
  const source: Source = boundedSource({ id, revision: 1, ownerId: context.userId, createdAt: new Date().toISOString(), expiresAt: Math.floor(Date.now() / 1000) + STAGING_SECONDS,
    metadata: meta, format: "video", lessonNumber: Number(body.lessonNumber), strategy: item.strategy,
    // The originating class/task/content identifiers never enter the shared template.
    item: { ...item, id: `gallery-${id}` }, assets: {}, videoMedia: { video: video!, ...(image ? { image } : {}) }, ...(derivedFrom ? { derivedFrom } : {}) });
  await workspacePut([{ partition: PARTITION, key: sourceKey(id), value: source, createOnly: true, expiresAt: source.expiresAt }]);
  return commitShare({ id }, context);
}
async function copiedSource(context: AuthorizedSlideContext, copyId: unknown) {
  const copy = await workspaceGet<Copy>(copyPartition(context), `COPY#${idValue(copyId)}`);
  if (!copy || copy.ownerId !== context.userId || copy.classId !== context.classId || copy.assignmentId !== context.assignmentId) throw new SlideRequestError("Copied material not found.", 404);
  const source = await workspaceGet<Source>(PARTITION, sourceKey(copy.templateId));
  if (!source) throw new SlideRequestError("Copied material not found.", 404);
  return { copy, source };
}
async function copyMaterial(body: Record<string, unknown>, context: AuthorizedSlideContext) {
  if (body.mode !== "use" && body.mode !== "adapt") throw new SlideRequestError("Choose use or adapt.");
  const source = await sharedSource(body.id);
  const copy: Copy = { id: randomUUID(), ownerId: context.userId, classId: context.classId, assignmentId: context.assignmentId, templateId: source.id,
    source: { templateId: source.id, revision: source.revision, title: source.metadata.title, mode: body.mode }, createdAt: new Date().toISOString() };
  await workspacePut([{ partition: copyPartition(context), key: `COPY#${copy.id}`, value: copy, createOnly: true }]);
  if (source.format === "slides") return { format: "slides", copyId: copy.id, source: copy.source,
    deck: { id: copy.id, lessonNumber: source.lessonNumber, strategy: source.strategy, draft: source.draft, assets: {}, gallerySource: copy.source,
      ...(source.metadata.focus ? { focus: source.metadata.focus } : {}) }, visualIds: Object.keys(source.assets) };
  return { format: "video", copyId: copy.id, source: copy.source, item: { ...source.item, id: `gallery-copy-${copy.id}`, lessonNumber: source.lessonNumber,
    ...(source.metadata.focus ? { focus: source.metadata.focus } : {}), gallerySource: copy.source }, media: await videoUrls(source) };
}
async function videoUrls(source: Source) {
  if (!source.videoMedia) throw new SlideRequestError("Saved video is missing.", 503);
  return { video: await galleryBlobUrl(source.videoMedia.video), ...(source.videoMedia.image ? { image: await galleryBlobUrl(source.videoMedia.image) } : {}) };
}

/** A copied draft is private to its teacher/task even before student publication. */
async function copyVideoMedia(context: AuthorizedSlideContext, copyId: unknown) {
  const { copy, source } = await copiedSource(context, copyId);
  if (source.format !== "video") throw new SlideRequestError("Choose a copied video material.", 422);
  const contentItemId = `gallery-copy-${copy.id}`;
  const [fallback, image, video] = await Promise.all([
    videoUrls(source),
    getMedia(context.classId, context.assignmentId, "cohort", contentItemId, "image"),
    getMedia(context.classId, context.assignmentId, "cohort", contentItemId, "video"),
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
  const source = await workspaceGet<Source>(PARTITION, sourceKey(copy.templateId));
  return source?.format === "video" ? videoUrls(source) : undefined;
}

export async function galleryPost(request: Request, body: Record<string, unknown>) {
  const context = await authorizeSlides(request, body);
  switch (body.action) {
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
  const context = await authorizeSlides(request, Object.fromEntries(params));
  if (params.get("action") === "copy-media") return copyVideoMedia(context, params.get("copyId"));
  if (params.get("action") === "asset") {
    const { source } = params.has("copyId") ? await copiedSource(context, params.get("copyId")) : { source: await sharedSource(params.get("id")) };
    const visualId = params.get("visualId");
    if (!visualId || !Object.hasOwn(source.assets, visualId)) throw new SlideRequestError("Gallery image not found.", 404);
    const asset = await workspaceGet<GalleryBlob>(PARTITION, assetKey(source.id, visualId));
    if (!asset) throw new SlideRequestError("Gallery image not found.", 404);
    const bytes = await readGalleryBlob(asset);
    if (bytes.length > MAX_IMAGE_BYTES || digest(bytes) !== asset.digest) throw new SlideRequestError("The saved image could not be verified. Please try another material.", 503);
    return { asset: { data: `data:${asset.mime};base64,${bytes.toString("base64")}`, width: asset.width, height: asset.height } };
  }
  if (params.has("id")) {
    const source = await sharedSource(params.get("id"));
    return { material: publicMaterial(source, context.userId), ...(source.format === "slides" ? { draft: source.draft, visualIds: Object.keys(source.assets) } : { item: source.item, media: await videoUrls(source) }),
      lessonNumber: source.lessonNumber, strategy: source.strategy };
  }
  const filters: GalleryFilters = {};
  if (params.has("lessonNumber")) {
    const n = Number(params.get("lessonNumber")); if (!Number.isInteger(n) || !getLesson(n)) throw new SlideRequestError("Choose a valid lesson."); filters.lessonNumber = n;
  }
  if (params.has("strategy")) filters.strategy = text(params.get("strategy"), "Strategy", 80, false);
  if (params.has("format")) { if (!["slides", "video"].includes(params.get("format")!)) throw new SlideRequestError("Choose slides or video."); filters.format = params.get("format") as "slides" | "video"; }
  const search = text(params.get("search") ?? undefined, "Search", 200).toLocaleLowerCase();
  const limit = params.has("limit") ? Number(params.get("limit")) : 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > 60) throw new SlideRequestError("Page size must be between 1 and 60.");
  const fingerprint = digest(JSON.stringify([filters, search, params.get("mine") === "true", context.userId]));
  let after = "";
  if (params.has("cursor")) {
    try { const c = JSON.parse(Buffer.from(params.get("cursor")!, "base64url").toString()); if (!record(c) || c.fingerprint !== fingerprint || typeof c.after !== "string" || c.after.length > 90) throw new Error(); after = c.after; }
    catch { throw new SlideRequestError("The Gallery page changed. Refresh the list."); }
  }
  const [shared, withdrawals] = await Promise.all([workspaceQuery<Shared>(PARTITION, "SHARED#"), workspaceQuery<{ id: string }>(PARTITION, "WITHDRAWN#")]);
  const withdrawn = new Set(withdrawals.map(row => row.id));
  const matches = shared.filter(row => !withdrawn.has(row.id) && (params.get("mine") !== "true" || row.ownerId === context.userId)
    && (!filters.lessonNumber || row.material.lessonNumber === filters.lessonNumber) && (!filters.strategy || row.material.strategy === filters.strategy)
    && (!filters.format || row.material.format === filters.format) && (!search || [row.material.title, row.material.description, row.material.experienceContext, row.material.gradeBand, row.material.strategy].join(" ").toLocaleLowerCase().includes(search)))
    .sort((a, b) => `${b.material.createdAt}|${b.id}`.localeCompare(`${a.material.createdAt}|${a.id}`))
    .filter(row => !after || `${row.material.createdAt}|${row.id}` < after);
  const page = matches.slice(0, limit); const last = page.at(-1);
  return { items: page.map(row => ({ ...row.material, isOwner: row.ownerId === context.userId })),
    ...(matches.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify({ fingerprint, after: `${last.material.createdAt}|${last.id}` })).toString("base64url") } : {}) };
}
