import { describe, expect, it } from "vitest";
import { projectPublishedSlides, isPublishedSlideManifest, isPublishedSlideReference, isPublishedSlideResponse } from "@/lib/slides/publication";
import { slideElements } from "@/lib/slides/layout";
import { deckFixture } from "../fixtures/slides";
import { sixStepDeck } from "../fixtures/analogy-six-step";

const publicationId = "11111111-1111-4111-8111-111111111111";
describe("student-only slide publication projection", () => {
  it.each(["analogy", "cognitive conflict", "experience bridging"] as const)("preserves the actual native %s student layout and reveal order", strategy => {
    const deck = strategy === "analogy" ? sixStepDeck() : deckFixture(strategy);
    const manifest = projectPublishedSlides(deck);
    expect(isPublishedSlideManifest(manifest)).toBe(true);
    expect(manifest.pages).toHaveLength(deck.draft.slides.length);
    for (const [index, page] of manifest.pages.entries()) {
      const expected = slideElements(deck, index).map(element => {
        if (element.kind === "text") return element;
        const { data: _data, ...image } = element;
        void _data;
        return { ...image, assetId: element.id.replace(/^image-/u, "") };
      });
      expect(page.elements).toEqual(expected);
    }
    if (strategy === "cognitive conflict") expect(manifest.pages.slice(0, 2).flatMap(page => page.elements).every(element => element.kind !== "image")).toBe(true);
    if (strategy === "analogy") expect(manifest.pages[0].elements.filter(element => element.kind === "image").map(element => element.assetId)).toEqual(["phenomenon"]);
  });
  it("never serializes private draft, notes, plans, context, asset data or checks", () => {
    const deck = sixStepDeck();
    deck.classroomContext = "PRIVATE_CONTEXT";
    deck.draft.slides[0].teacherNotes = ["PRIVATE_NOTES"];
    deck.draft.visuals[0].prompt = "PRIVATE_IMAGE_PROMPT";
    deck.draft.analogyPlan!.targetDifficulty = "PRIVATE_PLANNING";
    const serialized = JSON.stringify(projectPublishedSlides(deck));
    expect(serialized).not.toMatch(/PRIVATE_|teacherNotes|analogyPlan|classroomContext|checks|sourcePrompt|referenceData|data:image|renderedLines/u);
    expect(serialized).toContain(deck.draft.analogyPlan!.responseStarter);
  });
  it("rejects invalid stages, overlong draft text and student-facing production directions", () => {
    const wrong = deckFixture("cognitive conflict"); wrong.draft.slides[0].stage = "question";
    expect(() => projectPublishedSlides(wrong)).toThrow();
    const long = deckFixture("experience bridging"); long.draft.slides[0].body = "x".repeat(261);
    expect(() => projectPublishedSlides(long)).toThrow();
    const instructions = deckFixture("experience bridging"); instructions.draft.slides[0].body = "Teacher should tell students the answer.";
    expect(() => projectPublishedSlides(instructions)).toThrow();
  });
  it("accepts four-page experience bridging and optional seven-page analogy", () => {
    const experience = deckFixture("experience bridging"); experience.draft.slides.splice(3, 1);
    expect(projectPublishedSlides(experience).pages).toHaveLength(4);
    expect(projectPublishedSlides(sixStepDeck(true)).pages).toHaveLength(7);
  });
});

it("strictly validates safe publication references", () => {
  const valid = { publicationId, slideCount: 5, lessonNumber: 3 };
  expect(isPublishedSlideReference(valid)).toBe(true);
  for (const bad of [{ ...valid, publicationId: "private-response-id" }, { ...valid, slideCount: 8 }, { ...valid, lessonNumber: 0 }, { ...valid, draft: {} }]) expect(isPublishedSlideReference(bad)).toBe(false);
});

it("validates reader responses without accepting private extras, embedded image data or unsafe URLs", () => {
  const manifest = projectPublishedSlides(deckFixture("cognitive conflict"));
  const valid = { publicationId, manifest, assets: { evidence: { url: "https://files.example.test/evidence", width: 1536, height: 1024 } } };
  expect(isPublishedSlideResponse(valid)).toBe(true);
  expect(isPublishedSlideResponse({ ...valid, draft: {} })).toBe(false);
  expect(isPublishedSlideResponse({ ...valid, assets: {} })).toBe(false);
  expect(isPublishedSlideResponse({ ...valid, assets: { evidence: { ...valid.assets.evidence, url: "javascript:alert(1)" } } })).toBe(false);
  const withPrivate = structuredClone(manifest) as unknown as Record<string, unknown>; withPrivate.teacherNotes = [];
  expect(isPublishedSlideManifest(withPrivate)).toBe(false);
  const embedded = structuredClone(manifest);
  const image = embedded.pages.flatMap(page => page.elements).find(element => element.kind === "image")!;
  Object.assign(image, { data: "data:image/png;base64,private" });
  expect(isPublishedSlideManifest(embedded)).toBe(false);
});
