import { scopedClientAuthHeaders } from "./client-auth";
import { imageReferenceId, imageSourcePrompt } from "./slides/quality";
import { isSlideAsset, isSlideStrategy, parseDraft, type SlideAsset, type SlideDeck } from "./slides/model";
import type { ContentItem } from "./types";
import type { GalleryCopy, GalleryFacets, GalleryFilters, GalleryMaterial, GalleryMetadata, GalleryPreviewSource, GalleryProvenance, GalleryScope, SavedGalleryCopy, SavedGalleryCopySummary } from "./material-gallery";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("The material library returned incomplete data. Please retry.");
function isMaterial(value: unknown): value is GalleryMaterial {
  return record(value) && typeof value.id === "string" && !!value.id && Number.isInteger(value.revision) && Number(value.revision) > 0
    && typeof value.title === "string" && typeof value.strategy === "string" && Number.isInteger(value.lessonNumber)
    && ["slides", "video"].includes(String(value.format)) && typeof value.isOwner === "boolean"
    && ["description", "gradeBand", "experienceContext", "quizPattern", "createdAt"].every(key => typeof value[key] === "string")
    && (value.creatorName === undefined || typeof value.creatorName === "string")
    && (value.teacherCount === undefined || (Number.isSafeInteger(value.teacherCount) && Number(value.teacherCount) >= 0))
    && (value.promptTags === undefined || (record(value.promptTags) && Object.values(value.promptTags).every(v => typeof v === "string")))
    && (value.matchReasons === undefined || (Array.isArray(value.matchReasons) && value.matchReasons.every(v => typeof v === "string")))
    && (value.focus === undefined || (record(value.focus) && Array.isArray(value.focus.misconceptions) && value.focus.misconceptions.every(v => typeof v === "string")
      && Array.isArray(value.focus.coreIdeas) && value.focus.coreIdeas.every(Number.isInteger)));
}
function materialResult(data: { material: GalleryMaterial }) {
  if (!isMaterial(data.material)) throw invalid();
  return data.material;
}

async function json<T>(scope: GalleryScope, fields: Record<string, unknown>, method: "GET" | "POST", signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 55_000);
  const query = new URLSearchParams(Object.entries({ ...scope, ...fields }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  try {
    const response = await fetch(`/api/material-gallery${method === "GET" ? `?${query}` : ""}`, {
      method, headers: { ...scopedClientAuthHeaders(scope), ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify({ ...scope, ...fields }) } : {}), signal: controller.signal, cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : `The material library could not complete this request (HTTP ${response.status}).`);
    if (!data || typeof data !== "object") throw new Error("The material library returned an unreadable response. Please retry.");
    return data as T;
  } catch (error) {
    signal?.throwIfAborted();
    if (controller.signal.aborted) throw new Error("The material library took too long to respond. Your current material is unchanged.");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
async function checksum(data: string) {
  const base64 = data.split(",")[1];
  if (!base64) throw new Error("A slide image is missing. Generate every image before sharing.");
  const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function shareSlideMaterial(scope: GalleryScope, deck: SlideDeck, metadata: GalleryMetadata, signal?: AbortSignal): Promise<GalleryMaterial> {
  const assets = Object.fromEntries(await Promise.all(deck.draft.visuals.map(async visual => {
    const asset = deck.assets[visual.id];
    if (!asset) throw new Error("Generate every slide image before sharing this material.");
    return [visual.id, { width: asset.width, height: asset.height, digest: await checksum(asset.data) }];
  })));
  const { id } = await json<{ id: string }>(scope, { action: "start-share", lessonNumber: deck.lessonNumber, strategy: deck.strategy,
    materialId: deck.id, draft: deck.draft, assets, metadata, ...(deck.gallerySource ? { copyId: deck.id } : {}) }, "POST", signal);
  if (typeof id !== "string" || !id) throw invalid();
  for (const visual of deck.draft.visuals) {
    const { data, width, height } = deck.assets[visual.id];
    await json(scope, { action: "upload-asset", id, visualId: visual.id, asset: { data, width, height } }, "POST", signal);
  }
  return materialResult(await json<{ material: GalleryMaterial }>(scope, { action: "commit-share", id }, "POST", signal));
}
export async function shareVideoMaterial(scope: GalleryScope, item: ContentItem, lessonNumber: number, metadata: GalleryMetadata, signal?: AbortSignal): Promise<GalleryMaterial> {
  return materialResult(await json<{ material: GalleryMaterial }>(scope, { action: "share-video", item, lessonNumber, metadata }, "POST", signal));
}
export async function listMaterialGallery(scope: GalleryScope, filters: GalleryFilters = {}, signal?: AbortSignal) {
  const data = await json<{ items: GalleryMaterial[]; nextCursor?: string; facets?: GalleryFacets }>(scope, filters, "GET", signal);
  if (!Array.isArray(data.items) || !data.items.every(isMaterial) || (data.nextCursor !== undefined && typeof data.nextCursor !== "string")) throw invalid();
  if (data.facets !== undefined && (!record(data.facets) || !Array.isArray(data.facets.lessons) || !data.facets.lessons.every(n => Number.isSafeInteger(n) && n > 0)
    || !Array.isArray(data.facets.strategies) || !data.facets.strategies.every(s => typeof s === "string"))) throw invalid();
  return data;
}
export async function galleryCopyAttribution(scope: GalleryScope, copyId: string, signal?: AbortSignal) {
  const value = await json<Pick<GalleryMaterial, "creatorName" | "teacherCount" | "promptTags">>(scope, { action: "copy-attribution", copyId }, "GET", signal);
  if (!Number.isSafeInteger(value.teacherCount) || Number(value.teacherCount) < 0
    || (value.creatorName !== undefined && typeof value.creatorName !== "string")
    || (value.promptTags !== undefined && (!record(value.promptTags) || !Object.values(value.promptTags).every(v => typeof v === "string")))) throw invalid();
  return value;
}
export async function previewGalleryMaterial(scope: GalleryScope, id: string, signal?: AbortSignal) {
  const data = await json<GalleryPreviewSource>(scope, { id }, "GET", signal);
  if (!isMaterial(data.material) || data.material.id !== id) throw invalid();
  if (data.material.format === "slides") {
    if (!isSlideStrategy(data.strategy) || !Array.isArray(data.visualIds) || !data.visualIds.every(v => typeof v === "string")) throw invalid();
    try { parseDraft(data.draft, data.strategy, true); } catch { throw invalid(); }
  } else if (!record(data.item) || typeof data.item.body !== "string" || typeof data.item.title !== "string" || !record(data.media) || typeof data.media.video !== "string") throw invalid();
  return data;
}
async function loadAssets(scope: GalleryScope, ids: string[], fields: { id?: string; copyId?: string }, signal?: AbortSignal) {
  const assets: Record<string, SlideAsset> = {};
  // Keep one image per bounded response, including in hosted environments.
  for (const visualId of ids) {
    const result = await json<{ asset: SlideAsset }>(scope, { action: "asset", ...fields, visualId }, "GET", signal);
    if (!isSlideAsset(result.asset)) throw invalid();
    assets[visualId] = result.asset;
  }
  return assets;
}
function imageProvenance(deck: SlideDeck) {
  for (const visual of deck.draft.visuals) {
    const asset = deck.assets[visual.id];
    if (!asset) continue;
    asset.sourcePrompt = imageSourcePrompt(deck.draft, visual.id);
    const reference = imageReferenceId(deck.draft, visual.id);
    if (reference && deck.assets[reference]) asset.referenceData = deck.assets[reference].data;
  }
  return deck;
}
export async function previewGallerySlideDeck(scope: GalleryScope, id: string, signal?: AbortSignal): Promise<SlideDeck> {
  const source = await previewGalleryMaterial(scope, id, signal);
  if (source.material.format !== "slides" || !source.draft || !source.visualIds || !isSlideStrategy(source.strategy)) throw new Error("Choose a slide deck to preview.");
  return imageProvenance({ id: `preview-${id}`, lessonNumber: source.lessonNumber, strategy: source.strategy,
    draft: source.draft, assets: await loadAssets(scope, source.visualIds, { id }, signal) });
}
export async function copyGalleryMaterial(scope: GalleryScope, id: string, mode: "use" | "adapt" = "use", signal?: AbortSignal): Promise<GalleryCopy> {
  const copy = await json<GalleryCopy & { copyId: string; visualIds?: string[] }>(scope, { action: "copy", id, mode }, "POST", signal);
  if (!record(copy.source) || copy.source.templateId !== id || copy.source.mode !== mode || typeof copy.source.title !== "string" || !Number.isInteger(copy.source.revision)) throw invalid();
  if (copy.format === "video") {
    if (!record(copy.item) || typeof copy.item.id !== "string" || typeof copy.item.body !== "string" || !record(copy.media) || typeof copy.media.video !== "string") throw invalid();
    return { format: "video", item: copy.item, media: copy.media, source: copy.source };
  }
  if (copy.format !== "slides" || typeof copy.copyId !== "string" || !record(copy.deck) || copy.deck.id !== copy.copyId || !isSlideStrategy(copy.deck.strategy)
    || !Array.isArray(copy.visualIds) || !copy.visualIds.every(value => typeof value === "string")) throw invalid();
  try { parseDraft(copy.deck.draft, copy.deck.strategy, true); } catch { throw invalid(); }
  const deck = imageProvenance({ ...copy.deck, assets: await loadAssets(scope, copy.visualIds || [], { copyId: copy.copyId }, signal) }) as SlideDeck & { gallerySource: GalleryProvenance };
  return { format: "slides", deck, source: copy.source };
}
export async function refreshGalleryCopyMedia(scope: GalleryScope, contentItemId: string, signal?: AbortSignal): Promise<{ video: string; image?: string }> {
  const copyId = /^gallery-copy-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(contentItemId)?.[1];
  if (!copyId) throw new Error("Choose a copied video material.");
  const data = await json<{ media: { video: string; image?: string } }>(scope, { action: "copy-media", copyId }, "GET", signal);
  if (!record(data.media) || typeof data.media.video !== "string" || !data.media.video
    || (data.media.image !== undefined && (typeof data.media.image !== "string" || !data.media.image))) throw invalid();
  return data.media;
}
export async function unshareGalleryMaterial(scope: GalleryScope, id: string, signal?: AbortSignal) {
  const result = await json<{ removed: boolean }>(scope, { action: "unshare", id }, "POST", signal);
  if (result.removed !== true) throw invalid();
}

const validSource = (value: unknown): value is GalleryProvenance => record(value) && typeof value.templateId === "string" && !!value.templateId
  && Number.isSafeInteger(value.revision) && Number(value.revision) > 0 && typeof value.title === "string" && ["use", "adapt"].includes(String(value.mode));
const validSavedSummary = (value: unknown): value is SavedGalleryCopySummary => record(value) && typeof value.copyId === "string" && !!value.copyId
  && Number.isSafeInteger(value.revision) && Number(value.revision) > 0 && typeof value.savedAt === "string" && typeof value.title === "string"
  && ["slides", "video"].includes(String(value.format)) && Number.isInteger(value.lessonNumber) && typeof value.strategy === "string" && validSource(value.source);

export async function listSavedGalleryCopies(scope: GalleryScope, signal?: AbortSignal): Promise<{ items: SavedGalleryCopySummary[] }> {
  const result = await json<{ items: SavedGalleryCopySummary[] }>(scope, { action: "saved-copies" }, "GET", signal);
  if (!Array.isArray(result.items) || !result.items.every(validSavedSummary)) throw invalid();
  return result;
}

export async function saveGalleryCopy(scope: GalleryScope, copy: GalleryCopy, expectedRevision: number, signal?: AbortSignal): Promise<SavedGalleryCopySummary> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Provide the last saved revision.");
  const copyId = copy.format === "slides" ? copy.deck.id : copy.item.id.replace(/^gallery-copy-/u, "");
  let fields: Record<string, unknown>;
  if (copy.format === "slides") {
    const { id, lessonNumber, strategy, draft, focus, gallerySource, classroomContext } = copy.deck;
    const assets = Object.fromEntries(await Promise.all(draft.visuals.map(async visual => {
      const asset = copy.deck.assets[visual.id];
      if (!asset) throw new Error("Include every current slide image before saving this copy.");
      return [visual.id, { width: asset.width, height: asset.height, digest: await checksum(asset.data),
        ...(asset.sourcePrompt === undefined ? {} : { sourcePrompt: asset.sourcePrompt }),
        ...(asset.referenceData ? { referenceDigest: await checksum(asset.referenceData) } : {}) }];
    })));
    fields = { deck: { id, lessonNumber, strategy, draft, focus, gallerySource, classroomContext }, assets };
  } else fields = { item: copy.item };
  const started = await json<{ saveId: string }>(scope, { action: "start-save", copyId, expectedRevision, ...fields }, "POST", signal);
  if (typeof started.saveId !== "string" || !started.saveId) throw invalid();
  if (copy.format === "slides") {
    for (const visual of copy.deck.draft.visuals) {
      const { data, width, height } = copy.deck.assets[visual.id];
      await json(scope, { action: "upload-copy-asset", copyId, saveId: started.saveId, visualId: visual.id, asset: { data, width, height } }, "POST", signal);
    }
  }
  const result = await json<{ saved: SavedGalleryCopySummary }>(scope, { action: "commit-save", copyId, saveId: started.saveId }, "POST", signal);
  if (!validSavedSummary(result.saved) || result.saved.copyId !== copyId || result.saved.revision !== expectedRevision + 1) throw invalid();
  return result.saved;
}

export async function loadSavedGalleryCopy(scope: GalleryScope, copyId: string, signal?: AbortSignal): Promise<SavedGalleryCopy> {
  const result = await json<SavedGalleryCopy & { visualIds?: string[] }>(scope, { action: "saved-copy", copyId }, "GET", signal);
  if (!record(result.copy) || !validSource(result.copy.source) || !Number.isSafeInteger(result.revision) || result.revision < 1 || typeof result.savedAt !== "string") throw invalid();
  const copy = result.copy;
  if (copy.format === "video") {
    if (!record(copy.item) || copy.item.id !== `gallery-copy-${copyId}` || typeof copy.item.body !== "string" || !record(copy.media) || typeof copy.media.video !== "string") throw invalid();
  } else if (copy.format === "slides") {
    if (!record(copy.deck) || copy.deck.id !== copyId || !isSlideStrategy(copy.deck.strategy) || !Array.isArray(result.visualIds) || !result.visualIds.every(v => typeof v === "string")) throw invalid();
    try { parseDraft(copy.deck.draft, copy.deck.strategy, true); } catch { throw invalid(); }
    const references: Record<string, string> = {}, assets: Record<string, SlideAsset> = {};
    for (const visualId of result.visualIds) {
      const saved = await json<{ asset: SlideAsset; referenceDigest?: string }>(scope, { action: "saved-asset", copyId, revision: result.revision, visualId }, "GET", signal);
      if (!isSlideAsset(saved.asset) || (saved.asset.sourcePrompt !== undefined && typeof saved.asset.sourcePrompt !== "string")
        || (saved.referenceDigest !== undefined && typeof saved.referenceDigest !== "string")) throw invalid();
      assets[visualId] = saved.asset;
      if (saved.referenceDigest) references[visualId] = saved.referenceDigest;
    }
    const byDigest = Object.fromEntries(await Promise.all(Object.values(assets).map(async asset => [await checksum(asset.data), asset.data])));
    for (const [id, referenceDigest] of Object.entries(references)) {
      if (byDigest[referenceDigest]) assets[id].referenceData = byDigest[referenceDigest];
    }
    copy.deck.assets = assets;
  } else throw invalid();
  return { copy, revision: result.revision, savedAt: result.savedAt };
}
