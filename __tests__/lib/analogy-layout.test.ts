// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SlidePreview from "@/app/components/SlidePreview";
import { ANALOGY_PLAN_FIELDS } from "@/lib/slides/analogy";
import { buildPresentationBytes } from "@/lib/slides/export";
import { layoutErrors, slideElements, type MeasureText } from "@/lib/slides/layout";
import { SLIDE_CONTRACT_VERSION } from "@/lib/slides/model";
import { hasTeacherDecision, imageCheckKey, imageMatchesPlan, preservedAssets, qualityErrors, textCheckKey } from "@/lib/slides/quality";
import { analogyPlanFixture } from "../fixtures/analogy";
import { deckFixture } from "../fixtures/slides";

const measure: MeasureText = (text, element) => text.length * element.fontSize * .53;
const plannedDeck = () => {
  const deck = deckFixture("analogy");
  deck.draft.analogyPlan = analogyPlanFixture();
  // Keep the existing fixture's independently tested text and images; these
  // tests exercise the new scaffold's rendering and review dependencies.
  deck.checks = { text: { key: textCheckKey(deck), issues: [] }, images: Object.fromEntries(deck.draft.visuals.map(visual => [visual.id, {
    key: imageCheckKey(deck, visual.id), imageData: deck.assets[visual.id].data, issues: [],
  }])) };
  return deck;
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const context = { font: "", measureText: (text: string) => ({ width: text.length * Number(context.font.match(/(\d+)px/u)?.[1] ?? 24) * .53 }) };
    return context as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("student analogy scaffold", () => {
  it("opens with both named situations, the target banner and the stable picture pair without the mapping answer", () => {
    const deck = plannedDeck();
    const { container, rerender } = render(createElement(SlidePreview, { deck, index: 0 }));
    const openingText = [...container.querySelectorAll("tspan")].map(node => node.textContent).join(" ");
    expect(openingText).toContain("Today we investigate: Energy stores and transfers");
    expect(openingText).toContain(deck.draft.slides[0].body);
    expect(openingText).toContain("Familiar situation");
    expect(openingText).toContain("Science situation");
    expect(openingText).toContain(deck.draft.visuals[0].caption);
    expect(openingText).toContain(deck.draft.visuals[1].caption);
    expect(openingText).not.toContain(deck.draft.analogyPlan!.mappingHint);
    expect(openingText).not.toContain(deck.draft.analogyPlan!.responseStarter);
    const pair = slideElements(deck, 0).filter(element => element.kind === "image").map(({ id, data }) => ({ id, data }));
    expect(pair.map(element => element.id)).toEqual(["image-analogue", "image-target"]);
    for (const index of [1, 3]) {
      expect(slideElements(deck, index).filter(element => element.kind === "image").map(({ id, data }) => ({ id, data }))).toEqual(pair);
    }
    for (const [index, count] of [2, 2, 2, 2, 0].entries()) {
      rerender(createElement(SlidePreview, { deck, index }));
      expect(container.querySelectorAll("image")).toHaveLength(count);
    }
    expect(layoutErrors(deck, measure)).toEqual([]);
  });

  it("renders the hint and incomplete response as native text only on the mapping page", () => {
    const deck = plannedDeck();
    const plan = deck.draft.analogyPlan!;
    const { container, rerender } = render(createElement(SlidePreview, { deck, index: 1 }));
    const visibleText = [...container.querySelectorAll("tspan")].map(node => node.textContent).join(" ");
    expect(visibleText).toContain(plan.mappingHint);
    expect(visibleText).toContain(plan.responseStarter);
    expect(visibleText).toContain("Familiar situation");
    expect(visibleText).toContain("Science situation");
    expect(container.querySelectorAll("image")).toHaveLength(2);
    expect(layoutErrors(deck, measure)).toEqual([]);
    for (const field of ANALOGY_PLAN_FIELDS.filter(field => !["mappingHint", "responseStarter", "depth", "boundaryDecision"].includes(field))) {
      expect(visibleText).not.toContain(plan[field]);
    }
    for (const index of [0, 2, 3, 4]) {
      rerender(createElement(SlidePreview, { deck, index }));
      const text = [...container.querySelectorAll("tspan")].map(node => node.textContent).join(" ");
      expect(text).not.toContain(plan.mappingHint);
      expect(text).not.toContain(plan.responseStarter);
    }
    expect(slideElements(deck, 0)).toContainEqual(expect.objectContaining({ id: "learning-target", kind: "text" }));
  });

  it("exports the same scaffold as editable PowerPoint text with private design only in notes", async () => {
    const deck = plannedDeck();
    const plan = deck.draft.analogyPlan!;
    const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    const nativeText = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/gu)].map(match => match[1]).join(" ");
    expect(nativeText).toContain(plan.mappingHint);
    expect(nativeText).toContain(plan.responseStarter);
    expect(nativeText).toContain("Familiar situation");
    expect(nativeText).toContain("Science situation");
    expect(xml.match(/<p:pic>/gu)).toHaveLength(2);
    for (let page = 1; page <= 5; page++) {
      const pageXml = await zip.file(`ppt/slides/slide${page}.xml`)!.async("string");
      expect(pageXml.match(/<p:pic>/gu) ?? []).toHaveLength([2, 2, 2, 2, 0][page - 1]);
      expect(pageXml).not.toContain(plan.sharedRelation);
      expect(pageXml).not.toContain(plan.predictionSupport);
      expect(pageXml).not.toContain("Analogy teaching design");
    }
    const openingXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(openingXml).toContain("Today we investigate: Energy stores and transfers");
    expect(openingXml).toContain("Familiar situation");
    expect(openingXml).toContain("Science situation");
    expect(openingXml).not.toContain(plan.mappingHint);
    expect(openingXml).not.toContain(plan.responseStarter);
    const notes = await zip.file("ppt/notesSlides/notesSlide2.xml")!.async("string");
    expect(notes).toContain("Analogy teaching design (private)");
    expect(notes).toContain(plan.sharedRelation);
    expect(Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path))).toHaveLength(5);
  });

  it.each(["mappingHint", "responseStarter", "sharedRelation"] as const)("invalidates text and mapping-pair checks when %s changes while retaining usable bitmaps", field => {
    const deck = plannedDeck();
    const changed = { ...deck, draft: { ...deck.draft, analogyPlan: { ...deck.draft.analogyPlan!, [field]: `${deck.draft.analogyPlan![field]} Revised` } } };
    expect(textCheckKey(changed)).not.toBe(textCheckKey(deck));
    expect(imageCheckKey(changed, "target")).not.toBe(imageCheckKey(deck, "target"));
    expect(qualityErrors(changed)).toContain("Text: quality check pending after generation or edits.");
    expect(qualityErrors(changed)).toContain("Image target: visual check pending after generation or edits.");
    expect(preservedAssets(deck, changed.draft)).toEqual(deck.assets);
  });

  it("invalidates the target comparison when its familiar picture or plan changes", () => {
    const deck = plannedDeck();
    const changedImage = { ...deck, assets: { ...deck.assets, analogue: { ...deck.assets.analogue, data: "data:image/png;base64,AAAA" } } };
    expect(imageCheckKey(changedImage, "target")).not.toBe(imageCheckKey(deck, "target"));
    expect(imageMatchesPlan(changedImage, "target")).toBe(true);
    expect(qualityErrors(changedImage)).toContain("Image target: visual check pending after generation or edits.");
    const changedPlan = { ...deck, draft: { ...deck.draft, visuals: deck.draft.visuals.map(visual => visual.id === "analogue" ? { ...visual, prompt: `${visual.prompt} Move the tray.` } : visual) } };
    expect(imageCheckKey(changedPlan, "target")).not.toBe(imageCheckKey(deck, "target"));
    expect(qualityErrors(changedPlan)).toContain("Image target: visual check pending after generation or edits.");
  });

  it("keeps legacy target checks independent of a mapping pair", () => {
    const deck = deckFixture("analogy");
    delete deck.draft.analogyPlan;
    const changedImage = { ...deck, assets: { ...deck.assets, analogue: { ...deck.assets.analogue, data: "data:image/png;base64,AAAA" } } };
    expect(imageCheckKey(changedImage, "target")).toBe(imageCheckKey(deck, "target"));
    expect(slideElements(deck, 1).some(element => element.id === "mapping-hint")).toBe(false);
  });

  it("keeps legacy drafts readable with paired media but rejects their pre-opening reviews and teacher acceptance", () => {
    const deck = deckFixture("analogy");
    delete deck.draft.analogyPlan;
    deck.draft.slides[0].body = "Notice nine counters that can move between two trays.";
    const oldKey = (current: string) => {
      const snapshot = JSON.parse(current);
      snapshot[0] = SLIDE_CONTRACT_VERSION;
      return JSON.stringify(snapshot);
    };
    deck.checks = { text: { key: oldKey(textCheckKey(deck)), issues: [] }, images: Object.fromEntries(deck.draft.visuals.map(visual => [visual.id, {
      key: oldKey(imageCheckKey(deck, visual.id)), imageData: deck.assets[visual.id].data, issues: [],
    }])) };
    deck.teacherDecision = { reason: "Previously reviewed this familiar-only opening.", draftKey: deck.checks.text!.key, checks: deck.checks, assets: deck.assets };
    expect(slideElements(deck, 0).filter(element => element.kind === "image").map(element => element.id)).toEqual(["image-analogue", "image-target"]);
    expect(layoutErrors(deck, measure)).toEqual([]);
    expect(qualityErrors(deck)).toEqual(expect.arrayContaining([
      "Text: quality check pending after generation or edits.",
      "Image target: visual check pending after generation or edits.",
    ]));
    expect(hasTeacherDecision(deck)).toBe(false);
    expect(preservedAssets(deck, deck.draft)).toEqual(deck.assets);
  });
});
