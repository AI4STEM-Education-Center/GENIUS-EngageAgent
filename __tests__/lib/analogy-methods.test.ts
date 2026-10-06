import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { ANALOGY_METHODS, analogyMappingIndex, analogyStages, analogyVisualIds, analogyVisibleVisualIds, isAnalogyMethod, resolveAnalogyMethod } from "@/lib/slides/analogy-methods";
import { analogyPlanErrors, analogyPlanSchemaFor } from "@/lib/slides/analogy";
import { draftErrors, methodStages, methodVisualIds, stageOptions, visibleVisualIds } from "@/lib/slides/model";
import { buildPresentationBytes } from "@/lib/slides/export";
import { layoutErrors, slideElements, type MeasureText } from "@/lib/slides/layout";
import { hasTeacherDecision, imageCheckKey, imageContext, qualityErrors, textCheckKey } from "@/lib/slides/quality";
import { reviewFields } from "@/lib/slides/review";
import { slideCheckPrompt, slideOutputFormat, slidePrompt, sourceAdaptation } from "@/lib/slides/prompts";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { analogyMethodDeck, analogyMethodDraft } from "../fixtures/analogy-methods";
import { slideFixture } from "../fixtures/slides";

const measure: MeasureText = (text, element) => text.length * element.fontSize * .53;
const lesson = { lessonNumber: 5, lessonTitle: "Contact forces", learningObjective: "Compare how supports carry a load" };
const referenceImages = [["analogue", "target"], ["analogue"], ["analogue", "target"], ["analogue", "target"], []];
const predictionImages = [["analogue", "target"], ["analogue", "target"], ["target", "variation"], ["analogue", "target"], []];
const predictionFields = ["changedInput", "fixedConditions", "predictionFocus", "predictionSupport"];
const legacyMethods = ["reference-story", "predict-transfer"] as const;
type AnalogyOutputSchema = {
  properties: {
    analogyPlan: { required: string[] };
    slides: { items: { anyOf: { properties: { stage: { enum: string[] }; body: { description: string }; task: { description: string } } }[] } };
    visuals: { minItems: number; items: { anyOf: { properties: { id: { enum: string[] } } }[] } };
  };
};

describe("separate analogy story contracts", () => {
  it("keeps legacy drafts on compare-and-predict and gives reference stories their original five purposes", () => {
    expect(resolveAnalogyMethod()).toBe("predict-transfer");
    expect(analogyStages()).toEqual(["analogue", "mapping", "predict", "reflect", "question"]);
    expect(analogyStages("reference-story")).toEqual(["target", "analogue", "mapping", "reflect", "question"]);
    expect(analogyVisualIds()).toEqual(["analogue", "target", "variation"]);
    expect(analogyVisualIds("reference-story")).toEqual(["analogue", "target"]);
    expect(draftErrors(slideFixture("analogy"), "analogy")).toEqual([]);
    expect(analogyMappingIndex()).toBe(1);
    expect(analogyMappingIndex("reference-story")).toBe(2);
  });

  it.each(legacyMethods)("binds %s stages, visuals, validation and reveal order to one contract", method => {
    const draft = analogyMethodDraft(method);
    const expectedImages = method === "reference-story" ? referenceImages : predictionImages;
    expect(draftErrors(draft, "analogy")).toEqual([]);
    expect(methodStages("analogy", method)).toEqual(draft.slides.map(slide => slide.stage));
    expect(methodVisualIds("analogy", method)).toEqual(draft.visuals.map(visual => visual.id));
    expect(Array.from({ length: 5 }, (_, index) => visibleVisualIds("analogy", index, method))).toEqual(expectedImages);
    expect(Array.from({ length: 5 }, (_, index) => analogyVisibleVisualIds(method, index))).toEqual(expectedImages);
    expect(stageOptions("analogy", 3, method)).toEqual(["reflect", "limits"]);
    draft.slides[3].stage = "limits";
    draft.analogyPlan!.boundaryDecision = "include";
    expect(draftErrors(draft, "analogy")).toEqual([]);
  });

  it("rejects unknown, cross-strategy and mixed-method drafts", () => {
    for (const value of [null, {}, "", "reference", "../reference-story"]) expect(isAnalogyMethod(value)).toBe(false);
    for (const value of ANALOGY_METHODS) expect(isAnalogyMethod(value)).toBe(true);
    expect(draftErrors({ ...analogyMethodDraft(), analogyMethod: "unknown" }, "analogy").join("\n")).toContain("Deck.analogyMethod");
    expect(draftErrors({ ...slideFixture("experience bridging"), analogyMethod: "reference-story" }, "experience bridging").join("\n")).toContain("Deck.analogyMethod");
    const mixed = analogyMethodDraft("predict-transfer");
    mixed.analogyMethod = "reference-story";
    const errors = draftErrors(mixed, "analogy").join("\n");
    expect(errors).toContain("Slide 1.stage: expected target");
    expect(errors).toContain("Slide 3.stage: expected mapping");
    expect(errors).toContain("2 image plan(s) required");
    expect(errors).toContain("Analogy plan: unexpected field");
  });

  it("does not change other strategies when an analogy method is supplied", () => {
    for (const strategy of ["cognitive conflict", "experience bridging"] as const) {
      expect(methodStages(strategy, "reference-story")).toEqual(methodStages(strategy));
      expect(methodVisualIds(strategy, "reference-story")).toEqual(methodVisualIds(strategy));
      for (let i = 0; i < 5; i++) expect(visibleVisualIds(strategy, i, "reference-story")).toEqual(visibleVisualIds(strategy, i));
    }
  });

  it("makes reference planning independent of a two-condition prediction while preserving a concrete learner foothold", () => {
    const schema = analogyPlanSchemaFor("reference-story");
    const plan = analogyMethodDraft().analogyPlan!;
    expect(analogyPlanErrors(plan, "reference-story")).toEqual([]);
    for (const field of predictionFields) {
      expect(schema.required).not.toContain(field);
      expect(schema.properties).not.toHaveProperty(field);
      expect(analogyPlanErrors({ ...plan, [field]: "An unnecessary comparison" }, "reference-story")).toContain("Analogy plan: unexpected field.");
      expect(analogyPlanSchemaFor().required).toContain(field);
    }
    expect(schema.required).toEqual(expect.arrayContaining(["providedMapping", "openMapping", "mappingHint", "responseStarter", "boundaryDecision"]));
    expect(schema.properties.mappingHint.description).toContain("step 3");
    expect(analogyPlanSchemaFor().properties.mappingHint.description).toContain("step 2");
  });
});

describe("method-specific generation and review", () => {
  it.each(legacyMethods)("uses matching %s schema stages and visual plans without model-selected routing", method => {
    const schema = slideOutputFormat("analogy", method).json_schema.schema as AnalogyOutputSchema;
    expect(schema.properties).not.toHaveProperty("analogyMethod");
    expect(schema.properties.slides.items.anyOf.map(variant => variant.properties.stage.enum[0])).toEqual(analogyStages(method));
    expect(schema.properties.visuals.minItems).toBe(analogyVisualIds(method).length);
    expect(schema.properties.visuals.items.anyOf.map(variant => variant.properties.id.enum[0])).toEqual(analogyVisualIds(method));
    expect(schema.properties.analogyPlan.required).toEqual(analogyPlanSchemaFor(method).required);
    expect(schema.properties.slides.items.anyOf[3].properties.stage.enum).toEqual(["reflect", "limits"]);
    if (method === "reference-story") {
      const thirdPage = JSON.stringify(schema.properties.slides.items.anyOf[2]);
      expect(thirdPage).not.toMatch(/SAME later outcome|two starting conditions|one visible input change/iu);
      expect(thirdPage).toMatch(/correspond|map|connection/iu);
    }
  });

  it.each(["reference", "optimized"] as const)("keeps %s prompt and critic on the reference sequence without a required prediction page", async version => {
    const source = await loadSlideSource("analogy");
    const prompt = slidePrompt(lesson, "analogy", undefined, "", undefined, { version, referenceText: source.text, analogyMethod: "reference-story" });
    const data = JSON.parse(prompt.user);
    expect(data.appOwnedImagePlacement).toEqual(referenceImages.map((images, i) => ({ slide: i + 1, images })));
    const adapted = prompt.system.split("</original_method_prompt>").at(-1)!;
    expect(adapted).not.toContain("page 3 compares two starting conditions");
    expect(adapted).not.toContain("Slide 3 MUST change one visible input");
    expect(adapted).not.toContain("Reserve the first concrete mappingHint and responseStarter for step 2");
    expect(adapted).toMatch(/(?:step|page) 3/iu);
    expect(adapted).toMatch(/(?:limitations|boundaries) are optional/iu);
    if (version === "reference") expect(prompt.system).toContain(`<original_method_prompt>\n${source.text}\n</original_method_prompt>`);
    else expect(prompt.system).not.toContain(source.text);
    const check = slideCheckPrompt(lesson, "analogy", analogyMethodDraft());
    expect(JSON.parse(check.user).appOwnedImagePlacement).toEqual(data.appOwnedImagePlacement);
    expect(check.system).not.toContain("Slide 3 MUST change one visible input");
    expect(check.system).toMatch(/(?:step|page) 3/iu);
    expect(sourceAdaptation("analogy", "reference-story")).not.toContain("page 3 compares two starting conditions");
  });

  it("reviews only fields that belong to the selected method and identifies the actual scaffold page", () => {
    for (const method of legacyMethods) {
      const fields = reviewFields(analogyMethodDraft(method));
      expect(fields.find(field => field.id === "analogy-plan-mappingHint")?.label).toContain(`student-facing step ${analogyMappingIndex(method) + 1}`);
      for (const field of predictionFields) expect(fields.some(item => item.id === `analogy-plan-${field}`)).toBe(method === "predict-transfer");
    }
  });
});

describe("actual canvas, review identity and editable native export", () => {
  it.each(legacyMethods)("renders %s images and learner scaffolds on their intended pages", method => {
    const deck = analogyMethodDeck(method);
    const expected = method === "reference-story" ? referenceImages : predictionImages;
    expect(layoutErrors(deck, measure)).toEqual([]);
    for (let index = 0; index < 5; index++) {
      const elements = slideElements(deck, index);
      expect(elements.filter(element => element.kind === "image").map(element => element.id)).toEqual(expected[index].map(id => `image-${id}`));
      const mappingPage = index === analogyMappingIndex(method);
      expect(elements.some(element => element.id === "mapping-hint")).toBe(mappingPage);
      expect(elements.some(element => element.kind === "text" && element.id === "task" && element.text.includes(deck.draft.analogyPlan!.responseStarter))).toBe(mappingPage);
      const publicText = elements.map(element => element.kind === "text" ? element.text : "").join("\n");
      expect(publicText).not.toContain(deck.draft.analogyPlan!.boundaryReason);
      expect(publicText).not.toContain(deck.draft.analogyPlan!.openMapping);
    }
    expect(slideElements(deck, 0).some(element => element.kind === "text" && element.id === "learning-target" && element.text.includes("Contact forces"))).toBe(true);
    expect(slideElements(deck, 4).some(element => element.id === "question-card")).toBe(true);
    const third = slideElements(deck, 2);
    const thirdText = third.map(element => element.kind === "text" ? element.text : "").join("\n");
    expect(thirdText).toContain(method === "reference-story" ? "Familiar situation" : "Setup A");
    expect(thirdText).toContain(method === "reference-story" ? "Science situation" : "Setup B");
  });

  it("invalidates old text/image checks and teacher approval when a valid deck changes story method", () => {
    const old = analogyMethodDeck("predict-transfer");
    old.teacherDecision = { reason: "The comparison supports the intended thinking.", draftKey: textCheckKey(old), checks: old.checks!, assets: old.assets };
    expect(hasTeacherDecision(old)).toBe(true);
    const changed = { ...old, draft: analogyMethodDraft("reference-story") };
    expect(textCheckKey(changed)).not.toBe(textCheckKey(old));
    expect(imageCheckKey(changed, "target")).not.toBe(imageCheckKey(old, "target"));
    expect(imageCheckKey(changed, "analogue")).not.toBe(imageCheckKey(old, "analogue"));
    expect(hasTeacherDecision(changed)).toBe(false);
    expect(qualityErrors(changed).length).toBeGreaterThan(0);
    expect(imageContext(changed.draft, "analogy", "target").slides.map(slide => slide.number)).toEqual([1, 3, 4]);
  });

  it.each(legacyMethods)("exports %s as five editable pages with private design only in the correct speaker note", async method => {
    const deck = analogyMethodDeck(method);
    const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
    const expected = method === "reference-story" ? [2, 1, 2, 2, 0] : [2, 2, 2, 2, 0];
    expect(Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path))).toHaveLength(5);
    expect(Object.keys(zip.files).filter(path => /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(path))).toHaveLength(5);
    for (let index = 0; index < 5; index++) {
      const xml = await zip.file(`ppt/slides/slide${index + 1}.xml`)!.async("string");
      const notes = await zip.file(`ppt/notesSlides/notesSlide${index + 1}.xml`)!.async("string");
      expect((xml.match(/<p:pic>/gu) ?? []).length).toBe(expected[index]);
      expect(xml).toContain("<a:t>");
      expect(xml).not.toContain("boundaryReason");
      expect(xml.includes("The board could correspond to...")).toBe(index === analogyMappingIndex(method));
      expect(notes.includes("Analogy teaching design (private)")).toBe(index === analogyMappingIndex(method));
      expect(notes).toContain(`Analogy story: ${method}`);
      if (index === 0) expect(xml).toContain("Contact forces");
      if (index === 4) expect(xml).toContain("MY QUESTION");
    }
  });
});
