import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPresentationBytes } from "@/lib/slides/export";
import { exportErrors, slideElements, type MeasureText } from "@/lib/slides/layout";
import { draftErrors, draftVisibleVisualIds, methodVisualIds, parseDraft, type SlideDeck } from "@/lib/slides/model";
import { imageCheckKey, imageContext, imageMatchesPlan, imageReferenceId, imageSourcePrompt, preservedAssets, teachingErrors } from "@/lib/slides/quality";
import { sixStepDeck } from "../fixtures/analogy-six-step";
import { deckFixture, tinyImage } from "../fixtures/slides";

const measure: MeasureText = (text, element) => text.length * element.fontSize * .53;

function illustratedConflict(): SlideDeck {
  // Keep the shared evidence-only fixture available to exercise saved decks.
  const deck = deckFixture("cognitive conflict");
  deck.draft.visuals.unshift({
    id: "phenomenon",
    prompt: "One neutral starting setup: a round red ball rests on a table while a palm hovers above it, before contact. No flattening, release sequence, outcome inset, text or arrows.",
    caption: "A hand ready to press a soft ball",
    alt: "A round ball rests on a table with a palm held above it before contact.",
  });
  deck.draft.slides[0].title = "A soft ball meets a hand";
  deck.draft.slides[0].body = "Look at the ball and hand before contact.";
  deck.draft.slides[0].task = "What might change when the palm presses the ball?";
  deck.assets.phenomenon = { data: tinyImage, width: 1536, height: 1024, sourcePrompt: imageSourcePrompt(deck.draft, "phenomenon") };
  deck.assets.evidence = { ...deck.assets.evidence, sourcePrompt: imageSourcePrompt(deck.draft, "evidence"), referenceData: tinyImage };
  delete deck.checks;
  return deck;
}

describe("illustrated phenomenon openings", () => {
  it.each([
    ["analogy", sixStepDeck, "phenomenon"],
    ["cognitive conflict", illustratedConflict, "phenomenon"],
    ["experience bridging", () => deckFixture("experience bridging"), "experience"],
  ] as const)("renders and exports a visible opening event for %s", async (_strategy, makeDeck, visualId) => {
    const deck = makeDeck();
    expect(draftErrors(deck.draft, deck.strategy)).toEqual([]);
    expect(exportErrors(deck, measure)).toEqual([]);
    const images = slideElements(deck, 0).filter(element => element.kind === "image");
    expect(images).toEqual([expect.objectContaining({ id: `image-${visualId}`, data: deck.assets[visualId].data })]);
    expect(images[0].frame.width).toBeGreaterThan(0);
    expect(images[0].frame.height).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
    const opening = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(opening).toContain("<p:pic>");
    expect(opening).not.toContain("Allow time for students");
  });

  it("keeps the conflict setup visible through prediction and reveals the result only afterwards", async () => {
    const deck = illustratedConflict();
    expect(methodVisualIds(deck.strategy)).toEqual(["phenomenon", "evidence"]);
    expect(deck.draft.slides.map((_, index) => draftVisibleVisualIds(deck.draft, deck.strategy, index))).toEqual([
      ["phenomenon"], ["phenomenon"], ["evidence"], ["evidence"], [],
    ]);
    const evidence = deck.draft.visuals[1];
    for (let index = 0; index < 2; index++) {
      const elements = slideElements(deck, index);
      expect(elements.map(element => element.id)).not.toContain("image-evidence");
      expect(JSON.stringify(elements)).not.toContain(evidence.caption);
      expect(JSON.stringify(elements)).not.toContain(evidence.alt);
    }
    expect(imageContext(deck.draft, deck.strategy, "phenomenon").slides.map(slide => slide.number)).toEqual([1, 2]);
    expect(imageContext(deck.draft, deck.strategy, "evidence").slides.map(slide => slide.number)).toEqual([3, 4]);
    expect(JSON.stringify(imageContext(deck.draft, deck.strategy, "phenomenon"))).not.toContain(evidence.prompt);
    expect(teachingErrors(deck.draft, deck.lessonNumber)).toEqual([]);
    const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
    for (const page of [1, 2]) {
      const xml = await zip.file(`ppt/slides/slide${page}.xml`)!.async("string");
      expect(xml.match(/<p:pic>/gu)).toHaveLength(1);
      expect(xml).toContain(deck.draft.visuals[0].alt);
      expect(xml).not.toContain(evidence.alt);
    }
    for (const page of [3, 4]) {
      const xml = await zip.file(`ppt/slides/slide${page}.xml`)!.async("string");
      expect(xml.match(/<p:pic>/gu)).toHaveLength(1);
      expect(xml).toContain(evidence.alt);
      expect(xml).not.toContain(deck.draft.visuals[0].alt);
    }
    expect(await zip.file("ppt/slides/slide5.xml")!.async("string")).not.toContain("<p:pic>");
  });

  it("preserves readable, editable and exportable evidence-only conflict decks", async () => {
    const deck = deckFixture("cognitive conflict");
    expect(parseDraft(deck.draft, deck.strategy)).toBe(deck.draft);
    expect(parseDraft(deck.draft, deck.strategy, true)).toBe(deck.draft);
    expect(exportErrors(deck, measure)).toEqual([]);
    expect(deck.draft.slides.map((_, index) => draftVisibleVisualIds(deck.draft, deck.strategy, index))).toEqual([
      [], [], ["evidence"], ["evidence"], [],
    ]);
    expect(imageReferenceId(deck.draft, "evidence")).toBeUndefined();
    expect(imageMatchesPlan(deck, "evidence")).toBe(true);
    const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
    for (const page of [1, 2, 5]) expect(await zip.file(`ppt/slides/slide${page}.xml`)!.async("string")).not.toContain("<p:pic>");
    for (const page of [3, 4]) expect(await zip.file(`ppt/slides/slide${page}.xml`)!.async("string")).toContain("<p:pic>");
  });

  it("does not accept incomplete or reordered current conflict image plans as legacy", () => {
    const deck = illustratedConflict();
    deck.draft.visuals.pop();
    expect(draftErrors(deck.draft, deck.strategy).join()).toContain("2 image plan(s) required");
    const reversed = illustratedConflict();
    reversed.draft.visuals.reverse();
    expect(draftErrors(reversed.draft, reversed.strategy).join()).toContain("Image 1.id: expected phenomenon");
    const missingAsset = illustratedConflict();
    delete missingAsset.assets.phenomenon;
    expect(exportErrors(missingAsset, measure)).toContain("Image phenomenon: generate an image before downloading.");
  });

  it("fits the required prediction and observation labels with a concise real-model comparison", () => {
    const deck = illustratedConflict();
    deck.draft.slides[3].body = "Your prediction: revisit your written idea.\nWhat we observed in the activity: the illustrated ball flattened during contact and was round afterward.";
    expect(draftErrors(deck.draft, deck.strategy)).toEqual([]);
    expect(exportErrors(deck, measure)).toEqual([]);
    const elements = slideElements(deck, 3);
    const body = elements.find(element => element.id === "body")!;
    const task = elements.find(element => element.id === "task")!;
    expect(body.frame.top + body.frame.height).toBeLessThan(task.frame.top);
  });

  it("invalidates result images and reviews when their starting scene changes", () => {
    const deck = illustratedConflict();
    expect(imageReferenceId(deck.draft, "evidence")).toBe("phenomenon");
    expect(imageMatchesPlan(deck, "evidence")).toBe(true);
    expect(imageContext(deck.draft, deck.strategy, "evidence").phenomenon).toEqual(deck.draft.visuals[0]);
    const originalKey = imageCheckKey(deck, "evidence");
    const originalSource = imageSourcePrompt(deck.draft, "evidence");

    const changedPixels = structuredClone(deck);
    changedPixels.assets.phenomenon.data = "data:image/png;base64,iVBORw0KGgo=";
    expect(imageCheckKey(changedPixels, "evidence")).not.toBe(originalKey);
    expect(imageMatchesPlan(changedPixels, "evidence")).toBe(false);
    expect(preservedAssets(changedPixels, changedPixels.draft)).not.toHaveProperty("evidence");

    const changedPlan = structuredClone(deck.draft);
    changedPlan.visuals[0].prompt += " Use a blue ball.";
    expect(imageSourcePrompt(changedPlan, "evidence")).not.toBe(originalSource);
    expect(imageCheckKey({ ...deck, draft: changedPlan }, "evidence")).not.toBe(originalKey);
    expect(preservedAssets(deck, changedPlan)).toEqual({});

    const changedCaption = structuredClone(deck.draft);
    changedCaption.visuals[0].caption = "A palm above the ball before contact";
    expect(imageCheckKey({ ...deck, draft: changedCaption }, "evidence")).not.toBe(originalKey);
    expect(preservedAssets(deck, changedCaption)).toEqual(deck.assets);
  });

  it("permits references to the illustrated setup while retaining absent-media checks on old decks", () => {
    const current = illustratedConflict();
    current.draft.slides[1].body = "Look at the starting setup before recording your prediction.";
    expect(teachingErrors(current.draft, current.lessonNumber)).toEqual([]);
    const legacy = deckFixture("cognitive conflict");
    legacy.draft.slides[0].body = current.draft.slides[0].body;
    expect(teachingErrors(legacy.draft).join()).toContain("Slide 1.body: describe or imagine the setup");
  });
});
