import type { SlideDeck } from "./model";
import { scopedClientAuthHeaders } from "../client-auth";
import { isPublishedSlideReference, isSlidePublicationId, type PublishedSlideReference } from "./publication";

const REQUEST_TIMEOUT_MS = 25_000;
// Match the publication endpoint's raw JSON cap, including context and asset metadata.
const MAX_PUBLICATION_REQUEST_BYTES = 4_400_000;
const PUBLICATION_ID_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";
const endpoint = "/api/slides/publication";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export type SlidePublicationResult = { publicationId: string; contentItemId: string; slides: PublishedSlideReference };

async function post(body: object, signal: AbortSignal, headers: Record<string, string>): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, { method: "POST", headers,
      body: JSON.stringify(body), signal: controller.signal, cache: "no-store" });
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new Error("The publishing response was incomplete. Your draft is retained; try sending it again."); }
    signal.throwIfAborted();
    if (!response.ok) throw new Error(record(data) && typeof data.error === "string" ? data.error
      : "Unable to send these slides. Your draft is retained; try again.");
    if (!record(data)) throw new Error("The publishing response was incomplete. Your draft is retained; try again.");
    return data;
  } catch (error) {
    signal.throwIfAborted();
    if (timedOut) throw new Error("Publishing timed out. Your draft is retained; try sending it again.");
    throw error instanceof Error ? error : new Error("Unable to send these slides. Your draft is retained; try again.");
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
}

/** Upload a snapshot one image at a time. It becomes visible only after commit.
 * Mutations are never retried automatically; a manual retry keeps the deck ID. */
export async function publishSlideDeck(deck: SlideDeck, scope: { classId: string; assignmentId: string }, signal: AbortSignal,
  onProgress?: (message: string) => void): Promise<SlidePublicationResult> {
  signal.throwIfAborted();
  if (!scope.classId || !scope.assignmentId) throw new Error("Open a class task before sending slides.");
  const headers = { "Content-Type": "application/json", ...scopedClientAuthHeaders(scope) };
  const visuals = deck.draft.visuals;
  if (!visuals.length || visuals.some(visual => !deck.assets[visual.id]?.data)) {
    throw new Error("Finish generating every slide image before sending slides.");
  }
  for (const visual of visuals) {
    const { data, width, height } = deck.assets[visual.id];
    const requestBytes = new TextEncoder().encode(JSON.stringify({ ...scope, operation: "asset", publicationId: PUBLICATION_ID_PLACEHOLDER,
      visualId: visual.id, asset: { data, width, height } })).byteLength;
    if (requestBytes > MAX_PUBLICATION_REQUEST_BYTES) {
      throw new Error(`The ${visual.id} image is too large for online publishing. Regenerate this image, then try sending again. Your draft is unchanged.`);
    }
  }
  const assets = Object.fromEntries(visuals.map(({ id }) => {
    const { width, height } = deck.assets[id];
    return [id, { width, height }];
  }));
  onProgress?.("Preparing slides for students...");
  const started = await post({ ...scope, operation: "start", deckId: deck.id, lessonNumber: deck.lessonNumber,
    strategy: deck.strategy, draft: deck.draft, assets }, signal, headers);
  if (!isSlidePublicationId(started.publicationId)) throw new Error("The server did not prepare a slide publication. Please try again.");
  const id = started.publicationId;
  for (const [index, visual] of visuals.entries()) {
    onProgress?.(`Uploading slide image ${index + 1} of ${visuals.length}...`);
    const { data, width, height } = deck.assets[visual.id];
    const uploaded = await post({ ...scope, operation: "asset", publicationId: id, visualId: visual.id,
      asset: { data, width, height } }, signal, headers);
    if (uploaded.publicationId !== id || uploaded.visualId !== visual.id) {
      throw new Error("A slide image could not be confirmed. Your draft is retained; try sending it again.");
    }
  }
  onProgress?.("Making the slides available to students...");
  const result = await post({ ...scope, operation: "commit", publicationId: id }, signal, headers);
  if (result.publicationId !== id || result.contentItemId !== `slides-${deck.id}` || !isPublishedSlideReference(result.slides)
    || result.slides.publicationId !== id || result.slides.lessonNumber !== deck.lessonNumber || result.slides.slideCount !== deck.draft.slides.length) {
    throw new Error("The server did not confirm the published slides. Your draft is retained; try sending it again.");
  }
  return { publicationId: id, contentItemId: result.contentItemId, slides: result.slides };
}
