import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { localMaterialStorageEnabled, localMaterialUrl, storeLocalMaterial } from "../local-material-storage";
import { workspaceGet, workspacePut } from "../workspace-store";
import { listPublishedContent, upsertContentPublish } from "../nosql";
import { authorizeSlideAccess, authorizeSlides, requestDraft, slideContext, SlideRequestError } from "./server";
import { isPublishedSlideManifest, isPublishedSlideReference, isSlidePublicationId, projectPublishedSlides,
  type PublishedSlideManifest, type PublishedSlideResponse, type SlideAssetDimensions } from "./publication";

export const MAX_SLIDE_PUBLICATION_BYTES = 4_400_000;
export const SLIDE_PUBLICATION_STAGE_SECONDS = 30 * 60;
type Context = { classId: string; assignmentId: string };
type Publication = Context & { id: string; ownerId: string; deckId: string; manifest: PublishedSlideManifest; dimensions: SlideAssetDimensions;
  state: "staging" | "ready" | "published"; createdAt: string; expiresAt?: number };
type StoredAsset = { publicationId: string; visualId: string; ownerId: string; key: string; digest: string; mime: string; width: number; height: number };
const partition = (classId: string) => `WORKSPACE#${classId}`;
const publicationKey = (id: string) => `SLIDE_PUBLICATION#${id}`;
const assetKey = (id: string, visualId: string) => `SLIDE_PUBLICATION_ASSET#${id}#${visualId}`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const dimension = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 4096;
const safeKeys = (body: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new SlideRequestError("Unexpected slide-publication field.");
};

function storage() {
  const bucket = process.env.ENGAGE_S3_BUCKET?.trim();
  if (!bucket) throw new SlideRequestError("Slide publishing needs the project's private image storage. Your draft is unchanged.", 503);
  const client = new S3Client({ region: process.env.ENGAGE_AWS_REGION || process.env.AWS_REGION || "us-east-2", maxAttempts: 1,
    ...(process.env.ENGAGE_AWS_ACCESS_KEY_ID && process.env.ENGAGE_AWS_SECRET_ACCESS_KEY ? { credentials: {
      accessKeyId: process.env.ENGAGE_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.ENGAGE_AWS_SECRET_ACCESS_KEY,
    } } : {}) });
  return { bucket, client };
}

async function ownedPublication(context: Context, id: unknown, ownerId: string) {
  if (!isSlidePublicationId(id)) throw new SlideRequestError("Choose a valid slide publication.");
  const value = await workspaceGet<Publication>(partition(context.classId), publicationKey(id));
  if (!value || value.ownerId !== ownerId || value.classId !== context.classId || value.assignmentId !== context.assignmentId) throw new SlideRequestError("Slide publication not found.", 404);
  if (value.state === "staging" && (!value.expiresAt || value.expiresAt <= Math.floor(Date.now() / 1000))) throw new SlideRequestError("This unpublished slide upload expired. Publish the current draft again.", 410);
  return value;
}

function reference(publication: Publication) {
  return { publicationId: publication.id, slideCount: publication.manifest.pages.length, lessonNumber: publication.manifest.lessonNumber };
}
function committed(publication: Publication) { return { publicationId: publication.id, contentItemId: `slides-${publication.deckId}`, slides: reference(publication) }; }

async function currentlyPublished(publication: Publication) {
  const items = await listPublishedContent(publication.classId, publication.assignmentId);
  return items.some(item => {
    // The existing DynamoDB adapter exposes its physical partition key in class_id;
    // local storage exposes the logical ID. Both must still match this exact class.
    if (!item.published || ![publication.classId, `CLASS#${publication.classId}`].includes(item.class_id)
      || item.assignment_id !== publication.assignmentId || item.content_item_id !== `slides-${publication.deckId}`) return false;
    try {
      const content = JSON.parse(item.content_json);
      return content.type === "Slides" && isPublishedSlideReference(content.slides) && content.slides.publicationId === publication.id
        && content.slides.slideCount === publication.manifest.pages.length && content.slides.lessonNumber === publication.manifest.lessonNumber;
    } catch { return false; }
  });
}

function imageSize(bytes: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === "image/png") {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
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
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return null;
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

async function startPublication(context: Context, body: Record<string, unknown>, ownerId: string) {
  safeKeys(body, ["classId", "assignmentId", "operation", "deckId", "lessonNumber", "strategy", "draft", "assets"]);
  if (typeof body.deckId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/u.test(body.deckId)) throw new SlideRequestError("Choose a valid slide draft.");
  const { strategy } = slideContext(body);
  const draft = requestDraft(body.draft, strategy);
  if (!record(body.assets) || Object.keys(body.assets).length !== draft.visuals.length) throw new SlideRequestError("Provide dimensions for every current slide image.", 422);
  const dimensions: SlideAssetDimensions = {};
  for (const visual of draft.visuals) {
    const asset = body.assets[visual.id];
    if (!record(asset) || Object.keys(asset).some(key => !["width", "height"].includes(key)) || !dimension(asset.width) || !dimension(asset.height)) throw new SlideRequestError(`Generate the current ${visual.id} image before publishing.`, 422);
    dimensions[visual.id] = { width: asset.width, height: asset.height };
  }
  let manifest: PublishedSlideManifest;
  try { manifest = projectPublishedSlides({ id: body.deckId, lessonNumber: Number(body.lessonNumber), strategy, draft,
    assets: Object.fromEntries(Object.entries(dimensions).map(([id, size]) => [id, { ...size, data: "" }])) }); }
  catch (error) { throw new SlideRequestError(error instanceof Error ? error.message : "Check the current slides before publishing.", 422); }
  // Fail before creating a staging ticket if durable image storage is absent.
  if (!localMaterialStorageEnabled()) { const { client } = storage(); client.destroy(); }
  const id = randomUUID();
  const publication: Publication = { classId: context.classId, assignmentId: context.assignmentId, id, deckId: body.deckId, ownerId, manifest, dimensions, state: "staging", createdAt: new Date().toISOString(), expiresAt: Math.floor(Date.now() / 1000) + SLIDE_PUBLICATION_STAGE_SECONDS };
  await workspacePut([{ partition: partition(context.classId), key: publicationKey(id), value: publication, createOnly: true, expiresAt: publication.expiresAt }]);
  return { publicationId: id };
}

async function storeAsset(request: Request, context: Context, body: Record<string, unknown>, ownerId: string) {
  safeKeys(body, ["classId", "assignmentId", "operation", "publicationId", "visualId", "asset"]);
  const publication = await ownedPublication(context, body.publicationId, ownerId);
  if (publication.state !== "staging") throw new SlideRequestError("Published images cannot be replaced. Publish the revised draft again.", 409);
  if (typeof body.visualId !== "string" || !Object.hasOwn(publication.dimensions, body.visualId)) throw new SlideRequestError("Choose an image in this slide draft.");
  const asset = body.asset;
  if (!record(asset)) throw new SlideRequestError("Provide the current slide image.", 422);
  safeKeys(asset, ["data", "width", "height"]);
  const size = publication.dimensions[body.visualId];
  if (asset.width !== size.width || asset.height !== size.height || typeof asset.data !== "string" || asset.data.length > MAX_SLIDE_PUBLICATION_BYTES - 1000) throw new SlideRequestError("The slide image or its dimensions changed. Publish the current draft again.", 422);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(asset.data);
  if (!match) throw new SlideRequestError("Publish a generated JPEG, PNG or WebP image.", 422);
  const bytes = Buffer.from(match[2], "base64");
  const actual = imageSize(bytes, match[1]);
  if (bytes.toString("base64") !== match[2] || !actual || actual.width !== size.width || actual.height !== size.height) throw new SlideRequestError("The slide image is invalid or its dimensions do not match. Regenerate it before publishing.", 422);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const key = assetKey(publication.id, body.visualId);
  const existing = await workspaceGet<StoredAsset>(partition(context.classId), key);
  if (existing) {
    if (existing.digest !== digest || existing.ownerId !== ownerId) throw new SlideRequestError("This upload already contains a different image. Publish the revised draft again.", 409);
    return { publicationId: publication.id, visualId: body.visualId };
  }
  const scope = createHash("sha256").update(JSON.stringify([context.classId, context.assignmentId])).digest("hex");
  const saved: StoredAsset = { publicationId: publication.id, visualId: body.visualId, ownerId, digest, mime: match[1], ...size,
    key: `slide-publications/${scope}/${publication.id}/${body.visualId}-${digest}.${match[1].slice(6)}` };
  const backend = localMaterialStorageEnabled() ? null : storage();
  try {
    if (backend) await backend.client.send(new PutObjectCommand({ Bucket: backend.bucket, Key: saved.key, Body: bytes, ContentType: saved.mime, ContentLength: bytes.length, CacheControl: "private, no-store" }),
      { abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });
    else { request.signal.throwIfAborted(); await storeLocalMaterial(saved.key, bytes); }
    try { await workspacePut([{ partition: partition(context.classId), key, value: saved, createOnly: true, expiresAt: publication.expiresAt }]); }
    catch (error) {
      // Simultaneous retries of identical bytes are safe; different uploads cannot overwrite an accepted image.
      const accepted = await workspaceGet<StoredAsset>(partition(context.classId), key);
      if (!accepted || accepted.digest !== digest || accepted.ownerId !== ownerId) throw error;
    }
  } finally { backend?.client.destroy(); }
  return { publicationId: publication.id, visualId: body.visualId };
}

async function publicationAssets(publication: Publication) {
  const assets = await Promise.all(Object.keys(publication.dimensions).map(id => workspaceGet<StoredAsset>(partition(publication.classId), assetKey(publication.id, id))));
  if (assets.some((asset, index) => !asset || asset.ownerId !== publication.ownerId || asset.publicationId !== publication.id || asset.visualId !== Object.keys(publication.dimensions)[index])) throw new SlideRequestError("Upload every current slide image before publishing.", 422);
  return assets as StoredAsset[];
}

async function commitPublication(context: Context, body: Record<string, unknown>, ownerId: string) {
  safeKeys(body, ["classId", "assignmentId", "operation", "publicationId"]);
  const publication = await ownedPublication(context, body.publicationId, ownerId);
  if (publication.state === "published") {
    if (!await currentlyPublished(publication)) throw new SlideRequestError("This publication has been replaced. Publish the current draft again.", 409);
    return committed(publication);
  }
  const assets = await publicationAssets(publication);
  const durable = { ...publication };
  delete durable.expiresAt;
  // Promote the manifest and all asset pointers atomically before exposing a content reference.
  // This removes staging TTLs and makes an interrupted final write safe to retry/read.
  const ready: Publication = { ...durable, state: "ready" };
  await workspacePut([{ partition: partition(context.classId), key: publicationKey(publication.id), value: ready },
    ...assets.map(asset => ({ partition: partition(context.classId), key: assetKey(publication.id, asset.visualId), value: asset }))]);
  const item = { id: `slides-${publication.deckId}`, type: "Slides", title: publication.manifest.title, body: "", strategy: publication.manifest.strategy, slides: reference(publication) };
  await upsertContentPublish({ class_id: context.classId, assignment_id: context.assignmentId, content_item_id: item.id, content_json: JSON.stringify(item),
    published: true, published_at: new Date().toISOString(), published_by: ownerId });
  await workspacePut([{ partition: partition(context.classId), key: publicationKey(publication.id), value: { ...durable, state: "published" } }]);
  return committed(publication);
}

export async function writeSlidePublication(request: Request, body: Record<string, unknown>) {
  const context = await authorizeSlides(request, body);
  if (body.operation === "start") return startPublication(context, body, context.userId);
  if (body.operation === "asset") return storeAsset(request, context, body, context.userId);
  if (body.operation === "commit") return commitPublication(context, body, context.userId);
  throw new SlideRequestError("Choose a slide publication operation.");
}

export async function readSlidePublication(request: Request): Promise<PublishedSlideResponse> {
  const query = new URL(request.url).searchParams;
  const classId = query.get("classId"), assignmentId = query.get("assignmentId"), id = query.get("publicationId");
  const context = await authorizeSlideAccess(request, { classId, assignmentId }, "read");
  if (!isSlidePublicationId(id)) throw new SlideRequestError("Open slides from a published class activity.");
  const publication = await workspaceGet<Publication>(partition(context.classId), publicationKey(id));
  if (!publication || publication.classId !== classId || publication.assignmentId !== assignmentId || !["ready", "published"].includes(publication.state)
    || !isPublishedSlideManifest(publication.manifest) || !await currentlyPublished(publication)) throw new SlideRequestError("These slides are not currently published in this task.", 404);
  const stored = await publicationAssets(publication);
  if (localMaterialStorageEnabled()) {
    const assets = Object.fromEntries(await Promise.all(stored.map(async asset => [asset.visualId,
      { url: await localMaterialUrl(asset.key, asset.mime), width: asset.width, height: asset.height }])));
    return { publicationId: publication.id, manifest: publication.manifest, assets };
  }
  const { client, bucket } = storage();
  try {
    const assets = Object.fromEntries(await Promise.all(stored.map(async asset => {
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: asset.key, ResponseContentType: asset.mime, ResponseCacheControl: "private, no-store" }), { expiresIn: 600 });
      if (new URL(url).protocol !== "https:") throw new Error("Invalid slide asset URL");
      return [asset.visualId, { url, width: asset.width, height: asset.height }];
    })));
    return { publicationId: publication.id, manifest: publication.manifest, assets };
  } finally { client.destroy(); }
}
