import { scopedClientAuthHeaders } from "../client-auth";
import type { SlideDeck } from "./model";
import { isPublishedSlideReference, projectPublishedSlides, publishedSlideManifestKey } from "./publication";

export async function slideImageDigest(data: string): Promise<string> {
  const encoded = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(data)?.[1];
  if (!encoded) throw new Error("Generate a valid slide image before publishing.");
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

// Checks, model metadata and teacher-only notes cannot change the version that
// students see. Use the actual published projection plus exact image bytes.
export function slidePublicationContentKey(deck: SlideDeck): string {
  try {
    return JSON.stringify([deck.id, publishedSlideManifestKey(projectPublishedSlides(deck)), deck.draft.visuals.map(({ id }) => {
      const asset = deck.assets[id];
      return [id, asset?.data, asset?.width, asset?.height];
    })]);
  } catch { return ""; }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Reconcile a restored browser draft with the currently published server copy.
 * No upload or model request is made, and replaced/unpublished copies do not match. */
export async function isSlideDeckPublished(deck: SlideDeck, scope: { classId: string; assignmentId: string }, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(`/api/slides/publication?${new URLSearchParams({ ...scope, deckId: deck.id })}`, {
    headers: scopedClientAuthHeaders(scope), signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: "no-store",
  });
  const data: unknown = await response.json();
  signal.throwIfAborted();
  if (!response.ok || !record(data)) throw new Error("Unable to verify the published version. Your draft is retained; sending it again is safe.");
  if (data.published === false) return false;
  if (data.published !== true || !isPublishedSlideReference(data.slides) || !record(data.assets)
    || data.contentItemId !== `slides-${deck.id}` || data.slides.lessonNumber !== deck.lessonNumber
    || data.slides.slideCount !== deck.draft.slides.length) throw new Error("The publication status could not be verified.");
  if (publishedSlideManifestKey(data.manifest) !== publishedSlideManifestKey(projectPublishedSlides(deck))) return false;
  const publishedAssets = data.assets;
  if (Object.keys(publishedAssets).length !== deck.draft.visuals.length) return false;
  const matches = await Promise.all(deck.draft.visuals.map(async ({ id }) => {
    const asset = deck.assets[id], published = publishedAssets[id];
    if (!asset || !record(published) || asset.width !== published.width || asset.height !== published.height
      || typeof published.digest !== "string" || !/^[a-f0-9]{64}$/u.test(published.digest)) return false;
    return await slideImageDigest(asset.data) === published.digest;
  }));
  signal.throwIfAborted();
  return matches.every(Boolean);
}
