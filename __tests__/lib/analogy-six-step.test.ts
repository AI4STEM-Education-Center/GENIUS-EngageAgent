import { expect, it } from "vitest";
import JSZip from "jszip";
import { analogyMappingIndex, analogyStages, analogyVisualIds, resolveAnalogyMethod } from "@/lib/slides/analogy-methods";
import { analogyPlanErrors, analogyPlanSchemaFor } from "@/lib/slides/analogy";
import { draftErrors, methodStages, stageOptions, visibleVisualIds } from "@/lib/slides/model";
import { slideElements, layoutErrors, type MeasureText } from "@/lib/slides/layout";
import { buildPresentationBytes } from "@/lib/slides/export";
import { hasTeacherDecision, imageCheckKey, imageContext, imageMatchesPlan, imageSourcePrompt, qualityErrors, textCheckKey } from "@/lib/slides/quality";
import { reviewFields } from "@/lib/slides/review";
import { slideCheckPrompt, slideImagePrompt, slideOutputFormat, slidePrompt } from "@/lib/slides/prompts";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { SIX_STEP_DESIGN_RULES, SIX_STEP_REVIEW_RULES } from "@/lib/slides/analogy-pedagogy";
import { analogyPromptRevision } from "@/lib/slides/prompt-versions";
import { analogyMethodDraft } from "../fixtures/analogy-methods";
import { sixStepDeck, sixStepDraft } from "../fixtures/analogy-six-step";

const measure: MeasureText = (text, element) => text.length * element.fontSize * .53;
const lesson = { lessonNumber: 5, lessonTitle: "Contact forces", learningObjective: "Trace how a load reaches its supports" };
const stages = (includeLimits: boolean) => ["phenomenon", "target", "analogue", "mapping", "apply", ...(includeLimits ? ["limits"] : []), "question"];
const visibility = (includeLimits: boolean) => [["phenomenon"], ["target"], ["analogue"], ["analogue", "target"], ["analogue", "target"], ...(includeLimits ? [["analogue", "target"]] : []), []];
type SixStepSchema = { properties: {
  analogyPlan: { required: string[]; properties: Record<string, unknown> };
  slides: { minItems: number; maxItems: number; items: { anyOf: { properties: { stage: { enum: string[] }; body: { description: string }; task: { description: string } } }[] } };
  visuals: { minItems: number; maxItems: number; items: { anyOf: { properties: { id: { enum: string[] } } }[] } };
} };

it.each([false, true])("binds six-step optional limits=%s to an exact six/seven-page sequence", includeLimits => {
  const draft = sixStepDraft(includeLimits);
  expect(draftErrors(draft, "analogy")).toEqual([]);
  expect(analogyStages("six-step", includeLimits)).toEqual(stages(includeLimits));
  expect(methodStages("analogy", "six-step", includeLimits)).toEqual(stages(includeLimits));
  expect(analogyMappingIndex("six-step")).toBe(3);
  expect(analogyVisualIds("six-step")).toEqual(["phenomenon", "target", "analogue"]);
  expect(draft.slides.map((_, i) => visibleVisualIds("analogy", i, "six-step", includeLimits))).toEqual(visibility(includeLimits));
  expect(draft.slides.map((_, i) => stageOptions("analogy", i, "six-step", includeLimits))).toEqual(stages(includeLimits).map(stage => [stage]));
});

it("rejects count/boundary disagreements, missing steps and reordered steps instead of quietly shrinking the story", () => {
  const included = sixStepDraft(true);
  included.analogyPlan!.boundaryDecision = "omit";
  const omitted = sixStepDraft();
  omitted.analogyPlan!.boundaryDecision = "include";
  const missingApply = sixStepDraft();
  missingApply.slides.splice(4, 1);
  const earlyMapping = sixStepDraft();
  [earlyMapping.slides[1], earlyMapping.slides[3]] = [earlyMapping.slides[3], earlyMapping.slides[1]];
  for (const draft of [included, omitted, missingApply, earlyMapping]) expect(draftErrors(draft, "analogy").length).toBeGreaterThan(0);
  const badStage = sixStepDraft();
  badStage.slides[4].stage = "reflect";
  expect(draftErrors(badStage, "analogy").join("\n")).toContain("Slide 5.stage");
});

it("requires a supported application while leaving condition-change prediction fields out of six-step planning", () => {
  const schema = analogyPlanSchemaFor("six-step");
  const plan = sixStepDraft().analogyPlan!;
  expect(schema.required).toEqual(expect.arrayContaining(["applicationMode", "applicationSupport", "mappingHint", "responseStarter"]));
  expect(analogyPlanErrors(plan, "six-step")).toEqual([]);
  expect(analogyPlanErrors({ ...plan, applicationMode: "predict" }, "six-step")).toEqual([]);
  for (const patch of [{ applicationMode: "compare" }, { applicationSupport: "" }, { applicationMode: undefined }]) expect(analogyPlanErrors({ ...plan, ...patch }, "six-step").length).toBeGreaterThan(0);
  for (const field of ["changedInput", "fixedConditions", "predictionFocus", "predictionSupport"]) {
    expect(schema.required).not.toContain(field);
    expect(schema.properties).not.toHaveProperty(field);
  }
  expect(schema.properties.mappingHint).toMatchObject({ enum: [""] });
  for (const method of ["reference-story", "predict-transfer"] as const) {
    expect(analogyPlanSchemaFor(method).properties).not.toHaveProperty("applicationMode");
    expect(analogyPlanErrors({ ...analogyMethodDraft(method).analogyPlan, applicationMode: "explain", applicationSupport: "Use the mapping." }, method)).toContain("Analogy plan: unexpected field.");
  }
});

it("keeps both earlier stories at five pages and keeps untagged drafts on their old method", () => {
  expect(resolveAnalogyMethod()).toBe("predict-transfer");
  for (const method of ["reference-story", "predict-transfer"] as const) {
    expect(analogyStages(method, true)).toHaveLength(5);
    expect(draftErrors(analogyMethodDraft(method), "analogy")).toEqual([]);
  }
});

it("offers a six-to-seven-page schema with three role-specific image plans and no model-selected method", () => {
  const schema = slideOutputFormat("analogy", "six-step").json_schema.schema as SixStepSchema;
  expect(schema.properties).not.toHaveProperty("analogyMethod");
  expect(schema.properties.slides.minItems).toBe(6);
  expect(schema.properties.slides.maxItems).toBe(7);
  expect(schema.properties.visuals.minItems).toBe(3);
  expect(schema.properties.visuals.maxItems).toBe(3);
  expect(schema.properties.visuals.items.anyOf.map(item => item.properties.id.enum[0])).toEqual(["phenomenon", "target", "analogue"]);
  expect(new Set(schema.properties.slides.items.anyOf.flatMap(item => item.properties.stage.enum))).toEqual(new Set(stages(true)));
  expect(schema.properties.analogyPlan.required).toContain("applicationSupport");
});

it.each(["reference", "optimized"] as const)("removes paired-opening/five-page requirements from six-step %s generation and review", async version => {
  const source = await loadSlideSource("analogy", "six-step");
  const prompt = slidePrompt(lesson, "analogy", undefined, "", undefined, { version, referenceText: source.text, analogyMethod: "six-step" });
  const effective = prompt.system.split("</original_method_prompt>").at(-1)!;
  expect(effective).not.toMatch(/Produce exactly FIVE|Use exactly five pages|FIRST page names BOTH|first page.*BOTH stable pictures/iu);
  expect(effective).toMatch(/six|6/iu);
  expect(effective).toMatch(/seven|7/iu);
  expect(effective).toMatch(/(?:step|page) 4/iu);
  expect(effective).toMatch(/explain|explanation/iu);
  expect(effective).toMatch(/predict/iu);
  const data = JSON.parse(prompt.user);
  expect(data.appOwnedImagePlacement.slice(0, 4)).toEqual(visibility(false).slice(0,4).map((images, i) => ({ slide: i+1, images })));
  const check = slideCheckPrompt(lesson, "analogy", sixStepDraft());
  expect(JSON.parse(check.user).appOwnedImagePlacement).toEqual(visibility(false).map((images, i) => ({ slide: i+1, images })));
  expect(check.system).not.toContain("slide 1 BOTH named concepts/situations + BOTH stable pictures");
  expect(check.system).not.toContain("Slide 3 MUST change one visible input");
  expect(check.system).toMatch(/(?:step|page|slide) 4/iu);
  if (version === "reference") expect(prompt.system).toContain(source.text);
});

it.each([false, true])("exposes only the visible science/familiar scenes to review when limits=%s", includeLimits => {
  const draft = sixStepDraft(includeLimits);
  expect(imageContext(draft, "analogy", "phenomenon").slides.map(slide => slide.number)).toEqual([1]);
  expect(imageContext(draft, "analogy", "target").slides.map(slide => slide.number)).toEqual([2,4,5,...(includeLimits ? [6] : [])]);
  expect(imageContext(draft, "analogy", "analogue").slides.map(slide => slide.number)).toEqual([3,4,5,...(includeLimits ? [6] : [])]);
  const textReview = JSON.parse(slideCheckPrompt(lesson, "analogy", draft).user);
  expect(textReview.appOwnedImagePlacement[0].images).toEqual(["phenomenon"]);
  expect(textReview.appOwnedImagePlacement[1].images).toEqual(["target"]);
  expect(textReview.appOwnedImagePlacement.at(-1).images).toEqual([]);
  const targetReview = JSON.parse(slideCheckPrompt(lesson, "analogy", draft, "target").user);
  expect(targetReview.mappingSlide).toEqual(draft.slides[3]);
  const fields = reviewFields(draft);
  expect(fields.find(field => field.id === "analogy-plan-mappingHint")?.label).toContain("private planning");
  expect(fields.some(field => field.id === "analogy-plan-applicationSupport")).toBe(true);
});

it("gives the reviewer the exact open mapping and every visible support needed to notice a paraphrased answer", () => {
  const draft = sixStepDraft();
  draft.analogyPlan!.openMapping = "Students infer that the bridge deck corresponds to the board carrying the load.";
  draft.slides[3].body = "The bridge deck does the job of the board that carries the bag.";
  draft.slides[3].task = "Which part of the bridge could correspond to the board?";
  draft.visuals[1].caption = "The deck carries the bag";
  const context = JSON.parse(slideCheckPrompt(lesson, "analogy", draft).user);
  expect(context.analogyPlan.openMapping).toBe(draft.analogyPlan!.openMapping);
  expect(context.studentFacingSlides[3]).toMatchObject({ body: draft.slides[3].body, task: draft.slides[3].task });
  expect(context.visuals.find((visual: { id: string }) => visual.id === "target").caption).toBe(draft.visuals[1].caption);
  expect(context.studentFacingMappingScaffold).toEqual({ starter: draft.analogyPlan!.responseStarter });
  const fields = new Map(context.editableFields.map((field: { id: string; text: string }) => [field.id, field.text]));
  expect(fields.get("slide-4-body")).toBe(draft.slides[3].body);
  expect(fields.get("image-target-caption")).toBe(draft.visuals[1].caption);
  expect(fields.get("analogy-plan-mappingHint")).toBe(draft.analogyPlan!.mappingHint);
  expect(fields.get("analogy-plan-responseStarter")).toBe(draft.analogyPlan!.responseStarter);
});

it.each(["reference", "optimized"] as const)("keeps %s creation and revision on the same answer-leakage and task-specific boundary rules", async version => {
  const source = await loadSlideSource("analogy", "six-step");
  for (const review of [undefined, sixStepDraft(true)]) {
    const prompt = slidePrompt(lesson, "analogy", review, "Keep a useful inference open for the learner.", undefined, { version, referenceText: source.text, analogyMethod: "six-step" });
    expect(prompt.system).toContain(SIX_STEP_DESIGN_RULES);
  }
  expect(slideCheckPrompt(lesson, "analogy", sixStepDraft(true)).system).toContain(SIX_STEP_REVIEW_RULES);
  for (const rules of [SIX_STEP_DESIGN_RULES, SIX_STEP_REVIEW_RULES]) {
    expect(rules).toMatch(/teacher-led/iu);
    expect(rules).toMatch(/paraphras/iu);
    expect(rules).toMatch(/body/iu);
    expect(rules).toMatch(/caption/iu);
    expect(rules).toContain("mappingHint");
    expect(rules).toContain("responseStarter");
    expect(rules).toMatch(/PRIVATE/iu);
    expect(rules).toMatch(/omit|without limits/iu);
    expect(rules).toMatch(/(?:task-specific|this (?:actual )?(?:task|mapping)|actual task)/iu);
    expect(rules).toMatch(/physical objects[\s\S]{0,120}insufficient/iu);
  }
});

it("versions the six-step pedagogy correction without changing either legacy prompt revision", () => {
  expect(analogyPromptRevision("six-step")).toBe("analogy-six-step-20261003-v7:six-step");
  expect(analogyPromptRevision("reference-story")).toBe("analogy-six-step-20261001-v4:reference-story");
  expect(analogyPromptRevision("predict-transfer")).toBe("analogy-six-step-20261001-v4:predict-transfer");
  expect(analogyPromptRevision()).toBe("analogy-six-step-20261001-v4:predict-transfer");
});

it("keeps exact-answer and concrete-boundary requirements in the six-step planning schema", () => {
  const fields = analogyPlanSchemaFor("six-step").properties;
  expect(fields.openMapping.description).toMatch(/ALL proposed correspondences and explanations/iu);
  for (const field of ["body", "captions", "responseStarter"]) expect(fields.openMapping.description).toContain(field);
  expect(fields.openMapping.description).toMatch(/verbally in teacherNotes/iu);
  expect(fields.boundaryDecision.description).toMatch(/Default to omit/iu);
  expect(fields.boundaryReason.description).toMatch(/task-specific trigger/iu);
});

it("checks transfer identity in six-step familiar generation and paired review without changing earlier methods", () => {
  const draft = sixStepDraft();
  const analoguePrompt = slideImagePrompt(draft, "analogy", "analogue");
  expect(analoguePrompt).toContain("TRANSFER IDENTITY:");
  expect(analoguePrompt).toMatch(/color\/material transformation or sorting cues/iu);
  expect(analoguePrompt).toMatch(/unless that is the intended relation/iu);
  for (const id of ["analogue", "target"]) {
    const review = slideCheckPrompt(lesson, "analogy", draft, id).system;
    expect(review).toContain("TRANSFER IDENTITY:");
    expect(review).toMatch(/preserve identity and appearance/iu);
    expect(review).toMatch(/contradicts the intended transfer relation/iu);
  }
  expect(slideCheckPrompt(lesson, "analogy", draft, "phenomenon").system).not.toContain("TRANSFER IDENTITY:");
  for (const method of ["reference-story", "predict-transfer"] as const) {
    const legacy = analogyMethodDraft(method);
    expect(slideImagePrompt(legacy, "analogy", "analogue")).not.toContain("TRANSFER IDENTITY:");
    for (const id of ["analogue", "target"]) expect(slideCheckPrompt(lesson, "analogy", legacy, id).system).not.toContain("TRANSFER IDENTITY:");
  }
});

it.each([false, true])("lays out limits=%s with hidden early analogue, scaffold only on four and question card only on the last page", includeLimits => {
  const deck = sixStepDeck(includeLimits);
  expect(layoutErrors(deck, measure)).toEqual([]);
  for (const [index, images] of visibility(includeLimits).entries()) {
    const elements = slideElements(deck, index);
    expect(elements.filter(element => element.kind === "image").map(element => element.id)).toEqual(images.map(id => `image-${id}`));
    expect(elements.some(element => element.id === "mapping-hint")).toBe(false);
    expect(elements.some(element => element.kind === "text" && element.text.includes(deck.draft.analogyPlan!.responseStarter))).toBe(index === 3);
    expect(elements.some(element => element.id === "question-card")).toBe(index === deck.draft.slides.length-1);
    expect(elements.some(element => element.kind === "text" && element.text.includes(deck.draft.analogyPlan!.applicationSupport!))).toBe(false);
  }
  expect(slideElements(deck, 0).some(element => element.id === "learning-target")).toBe(true);
});

it("invalidates a reviewed target when its phenomenon source changes, while preserving an unrelated familiar image", () => {
  const deck = sixStepDeck();
  expect(imageMatchesPlan(deck, "target")).toBe(true);
  const originalSource = imageSourcePrompt(deck.draft, "target");
  const oldKey = imageCheckKey(deck, "target");
  deck.draft.visuals[0].prompt += " The bag is now red.";
  expect(imageSourcePrompt(deck.draft, "target")).not.toBe(originalSource);
  expect(imageMatchesPlan(deck, "target")).toBe(false);
  expect(imageMatchesPlan(deck, "analogue")).toBe(true);
  expect(imageCheckKey(deck, "target")).not.toBe(oldKey);
  const unchanged = sixStepDeck();
  unchanged.assets.phenomenon.data = "data:image/jpeg;base64,/9j/4AE=";
  expect(imageMatchesPlan(unchanged, "target")).toBe(false);
  expect(imageMatchesPlan(unchanged, "analogue")).toBe(true);
});

it("invalidates checks and teacher acceptance when a six-page draft gains its optional seventh page", () => {
  const deck = sixStepDeck();
  deck.teacherDecision = { reason: "The comparison is suitable for this class.", draftKey: textCheckKey(deck), checks: deck.checks!, assets: deck.assets };
  expect(hasTeacherDecision(deck)).toBe(true);
  const revised = { ...deck, draft: sixStepDraft(true) };
  expect(textCheckKey(revised)).not.toBe(textCheckKey(deck));
  expect(imageCheckKey(revised, "target")).not.toBe(imageCheckKey(deck, "target"));
  expect(hasTeacherDecision(revised)).toBe(false);
  expect(qualityErrors(revised).length).toBeGreaterThan(0);
});

it("requests an edit of the phenomenon only for the six-step scientific target", () => {
  const draft = sixStepDraft();
  const target = slideImagePrompt(draft, "analogy", "target");
  expect(target).toMatch(/EDIT.*(?:PHENOMENON|phenomenon)/u);
  expect(slideImagePrompt(draft, "analogy", "phenomenon")).not.toContain("EDIT THE ATTACHED BASELINE IMAGE");
  expect(slideImagePrompt(draft, "analogy", "analogue")).not.toContain("EDIT THE ATTACHED BASELINE IMAGE");
});

it.each([false, true])("exports limits=%s as a native six/seven-page package with correctly placed scaffold and notes", async includeLimits => {
  const deck = sixStepDeck(includeLimits);
  const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
  const length = includeLimits ? 7 : 6;
  expect(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name))).toHaveLength(length);
  expect(Object.keys(zip.files).filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(name))).toHaveLength(length);
  for (let index = 0; index < length; index++) {
    const xml = await zip.file(`ppt/slides/slide${index+1}.xml`)!.async("string");
    const notes = await zip.file(`ppt/notesSlides/notesSlide${index+1}.xml`)!.async("string");
    expect((xml.match(/<p:pic>/gu) ?? []).length).toBe(visibility(includeLimits)[index].length);
    expect(xml.includes("The board could correspond to...")).toBe(index === 3);
    expect(xml.includes("MY QUESTION")).toBe(index === length-1);
    expect(notes.includes("Analogy teaching design (private)")).toBe(index === 3);
    expect(notes).not.toContain("Both target and familiar situations appear on the opening page.");
    expect(xml).not.toContain("applicationSupport");
    if (index === 0) expect(xml).toContain("Contact forces");
  }
});
