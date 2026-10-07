import { slideElements, type Frame, type ImageElement, type TextElement } from "./layout";
import { isSlideStrategy, parseDraft, type SlideDeck, type SlideStrategy } from "./model";

export type PublishedSlideReference = { publicationId: string; slideCount: number; lessonNumber: number };
export type PublicSlideElement = Omit<TextElement, "renderedLines"> | (Omit<ImageElement, "data"> & { assetId: string });
export type PublishedSlidePage = { stage: string; title: string; elements: PublicSlideElement[] };
export type PublishedSlideManifest = { version: 1; title: string; lessonNumber: number; strategy: SlideStrategy; pages: PublishedSlidePage[] };
export type StudentSlideManifest = PublishedSlideManifest;
export type PublishedSlideResponse = { publicationId: string; manifest: PublishedSlideManifest; assets: Record<string, { url: string; width: number; height: number }> };
export type SlideAssetDimensions = Record<string, { width: number; height: number }>;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const string = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;
const dimension = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 4096;
export const isSlidePublicationId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
const lesson = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 8;
const assetId = (value: unknown): value is string => typeof value === "string" && /^(?:phenomenon|target|analogue|variation|evidence|experience)$/u.test(value);

export function isPublishedSlideReference(value: unknown): value is PublishedSlideReference {
  return record(value) && keys(value, ["publicationId", "slideCount", "lessonNumber"]) && isSlidePublicationId(value.publicationId)
    && Number.isInteger(value.slideCount) && Number(value.slideCount) >= 4 && Number(value.slideCount) <= 7 && lesson(value.lessonNumber);
}

function isFrame(value: unknown): value is Frame {
  return record(value) && keys(value, ["left", "top", "width", "height"])
    && [value.left, value.top, value.width, value.height].every(number => typeof number === "number" && Number.isFinite(number))
    && Number(value.left) >= 0 && Number(value.top) >= 0 && Number(value.width) > 0 && Number(value.height) > 0
    && Number(value.left) + Number(value.width) <= 1280.01 && Number(value.top) + Number(value.height) <= 720.01;
}

function isElement(value: unknown): value is PublicSlideElement {
  if (!record(value) || !string(value.id, 80) || !isFrame(value.frame)) return false;
  if (value.kind === "image") return keys(value, ["id", "kind", "frame", "fit", "alt", "assetId"])
    && value.fit === "contain" && string(value.alt, 640) && assetId(value.assetId);
  return value.kind === "text" && keys(value, ["id", "kind", "role", "text", "fontSize", "bold", "color", "frame", "autoFit"])
    && ["title", "body", "caption"].includes(String(value.role)) && string(value.text, 2400)
    && typeof value.fontSize === "number" && value.fontSize >= 16 && value.fontSize <= 64 && typeof value.bold === "boolean"
    && typeof value.color === "string" && /^[0-9a-f]{6}$/iu.test(value.color) && value.autoFit === "none";
}

function validStages(strategy: SlideStrategy, stages: string[]) {
  const sequence = stages.join(",");
  if (strategy === "cognitive conflict") return sequence === "phenomenon,prediction,discrepant,compare,question";
  if (strategy === "experience bridging") return ["experience,notice,name,question", "experience,notice,name,connect,question"].includes(sequence);
  return ["phenomenon,target,analogue,mapping,apply,question", "phenomenon,target,analogue,mapping,apply,limits,question",
    "target,analogue,mapping,reflect,question", "target,analogue,mapping,limits,question",
    "analogue,mapping,predict,reflect,question", "analogue,mapping,predict,limits,question"].includes(sequence);
}

export function isPublishedSlideManifest(value: unknown): value is PublishedSlideManifest {
  if (!record(value) || !keys(value, ["version", "title", "lessonNumber", "strategy", "pages"]) || value.version !== 1 || !string(value.title, 80)
    || !lesson(value.lessonNumber) || !isSlideStrategy(value.strategy) || !Array.isArray(value.pages) || value.pages.length < 4 || value.pages.length > 7) return false;
  if (!value.pages.every(page => record(page) && keys(page, ["stage", "title", "elements"]) && string(page.stage, 24) && string(page.title, 64)
    && Array.isArray(page.elements) && page.elements.length >= 1 && page.elements.length <= 18 && page.elements.every(isElement)
    && new Set(page.elements.map(element => element.id)).size === page.elements.length)) return false;
  return validStages(value.strategy, value.pages.map(page => page.stage));
}

export function isPublishedSlideResponse(value: unknown): value is PublishedSlideResponse {
  if (!record(value) || !keys(value, ["publicationId", "manifest", "assets"]) || !isSlidePublicationId(value.publicationId)
    || !isPublishedSlideManifest(value.manifest) || !record(value.assets)) return false;
  const required = new Set(value.manifest.pages.flatMap(page => page.elements.filter(element => element.kind === "image").map(element => element.assetId)));
  if (Object.keys(value.assets).length !== required.size) return false;
  return Object.entries(value.assets).every(([id, asset]) => {
    if (!required.has(id) || !record(asset) || !keys(asset, ["url", "width", "height"]) || !dimension(asset.width) || !dimension(asset.height) || !string(asset.url, 16_384)) return false;
    try { const url = new URL(asset.url as string); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  });
}

/** Generate the published view from the same native layout as preview/export.
 * This is a whitelist projection: no original draft, prompts, checks or notes survive. */
export function projectPublishedSlides(deck: SlideDeck): PublishedSlideManifest {
  if (!lesson(deck.lessonNumber) || !isSlideStrategy(deck.strategy)) throw new Error("Select a valid slide lesson and strategy.");
  parseDraft(deck.draft, deck.strategy);
  // Pedagogical findings inform optional refinement; they do not prevent a
  // teacher from sharing a structurally valid, generated material.
  const manifest: PublishedSlideManifest = { version: 1, title: deck.draft.title, lessonNumber: deck.lessonNumber, strategy: deck.strategy,
    pages: deck.draft.slides.map((page, index) => ({ stage: page.stage, title: page.title, elements: slideElements(deck, index).map(element => {
      const frame = { left: element.frame.left, top: element.frame.top, width: element.frame.width, height: element.frame.height };
      return element.kind === "text" ? { id: element.id, kind: "text", role: element.role, text: element.text, fontSize: element.fontSize,
        bold: element.bold, color: element.color, frame, autoFit: "none" } : { id: element.id, kind: "image", frame, fit: "contain", alt: element.alt, assetId: element.id.replace(/^image-/u, "") };
    }) })) };
  if (!isPublishedSlideManifest(manifest)) throw new Error("The student slide layout is invalid. Check the current draft before publishing.");
  return manifest;
}
