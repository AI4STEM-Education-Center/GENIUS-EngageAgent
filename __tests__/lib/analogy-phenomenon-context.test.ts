import { expect, it } from "vitest";
import { analogyPlanErrors, analogyPlanSchemaFor } from "@/lib/slides/analogy";
import { slideElements } from "@/lib/slides/layout";
import { draftErrors, SIX_STEP_REVIEW_CONTRACT_VERSION } from "@/lib/slides/model";
import { analogyPromptRevision } from "@/lib/slides/prompt-versions";
import { slideCheckPrompt, slideImagePrompt, slideOutputFormat, slidePrompt } from "@/lib/slides/prompts";
import { hasTeacherDecision, imageCheckKey, imageMatchesPlan, preservedAssets, qualityErrors, textCheckKey } from "@/lib/slides/quality";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { sixStepDeck, sixStepDraft } from "../fixtures/analogy-six-step";

const lesson = { lessonNumber: 5, lessonTitle: "Contact forces", learningObjective: "Trace how a load reaches its supports" };
const classroomContext = "Grade 9. Students have never visited a footbridge, but have carried a board together. Introduce the bridge's deck and supports plainly.";
const obsoleteRequirements = /authentic everyday (?:event|instance|target)|outside a specially constructed classroom demonstration|never a specially constructed classroom demonstration|students could encounter in daily life/iu;

function unfamiliarTargetDraft() {
  const draft = sixStepDraft();
  draft.analogyPlan!.targetPhenomenon = "A loaded footbridge over a ravine remains still.";
  draft.analogyPlan!.authenticityRationale = "A real bridge carries loads through its deck to supports. This illustrates the lesson's contact-force relationship. Explain the deck and supports because these learners have never visited a bridge.";
  draft.analogyPlan!.familiarExperience = "These learners have carried a board together and can recall how the board and hands support a load.";
  return draft;
}

it.each(["reference", "optimized"] as const)("uses the lesson-context clarification in the effective %s generation prompt", async version => {
  const source = await loadSlideSource("analogy", "six-step");
  const prompt = slidePrompt(lesson, "analogy", undefined, "", undefined, {
    version, referenceText: source.text, analogyMethod: "six-step", classroomContext,
  });
  // Version A retains the historical source; only its later adaptation is current policy.
  const effective = prompt.system.split("</original_method_prompt>").at(-1)!;
  expect(effective).not.toMatch(obsoleteRequirements);
  expect(effective).toMatch(/authentic|real-world/iu);
  expect(effective).toMatch(/specific lesson|lesson.*relationship/iu);
  expect(effective).toMatch(/(?:need not|not required|does not require|not necessarily|may be unfamiliar|can be unfamiliar)/iu);
  expect(effective).toContain("STEP 3 analogue");
  expect(effective).toContain("familiar source ON ITS OWN");
  expect(effective).toContain("No supplied correspondence or target explanation");
  if (version === "optimized") expect(prompt.system.match(/SAMANEH SIX-STEP ANALOGY DESIGN/gu)).toHaveLength(1);
  expect(JSON.parse(prompt.user).classroomContext).toBe(classroomContext);
  expect(prompt.system).not.toContain(classroomContext);
  expect(JSON.parse(prompt.user).appOwnedImagePlacement.slice(0, 4)).toEqual([
    { slide: 1, images: ["phenomenon"] }, { slide: 2, images: ["target"] },
    { slide: 3, images: ["analogue"] }, { slide: 4, images: ["analogue", "target"] },
  ]);
  if (version === "reference") {
    expect(prompt.system).toContain(source.text);
    expect(source.sha256).toBe("de82d621fd91cd2d9c3919d19acf762191ffdeef7af28d2cc78ad106246fbb6b");
  }
});

it("requires lesson-fit planning without turning everyday experience into a schema prerequisite", () => {
  const schema = analogyPlanSchemaFor("six-step");
  expect(schema.required).toEqual(expect.arrayContaining(["targetPhenomenon", "authenticityRationale", "familiarExperience"]));
  const targetDescriptions = [schema.properties.targetPhenomenon.description, schema.properties.authenticityRationale.description].join("\n");
  expect(targetDescriptions).not.toMatch(obsoleteRequirements);
  expect(targetDescriptions).toMatch(/real-world/iu);
  expect(targetDescriptions).toMatch(/lesson/iu);
  expect(schema.properties.familiarExperience.description).toMatch(/familiar experience/iu);
  const draft = unfamiliarTargetDraft();
  expect(analogyPlanErrors(draft.analogyPlan, "six-step")).toEqual([]);
  expect(draftErrors(draft, "analogy")).toEqual([]);
  // Check the schema actually sent to the model, not only its helper definition.
  expect(JSON.stringify(slideOutputFormat("analogy", "six-step"))).not.toMatch(obsoleteRequirements);
  const energyPrompt = JSON.parse(slidePrompt({ lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Model stored energy and transfers" }, "analogy", undefined, "", undefined, { analogyMethod: "six-step" }).user);
  expect(energyPrompt.referenceVariables.TARGET_CONCEPT).not.toContain("everyday");
  expect(energyPrompt.lessonFocus).not.toMatch(obsoleteRequirements);
  expect(energyPrompt.lessonFocus).toContain("Do not substitute a braking/dissipation story");
});

it("reviews an unfamiliar authentic target for lesson fit while keeping its rationale and answers private", () => {
  const draft = unfamiliarTargetDraft();
  const prompt = slideCheckPrompt(lesson, "analogy", draft, undefined, undefined, classroomContext);
  const context = JSON.parse(prompt.user);
  expect(prompt.system).not.toMatch(obsoleteRequirements);
  expect(prompt.system).toMatch(/lesson/iu);
  expect(prompt.system).toMatch(/unfamiliar|everyday/iu);
  expect(context.analogyPlan.authenticityRationale).toBe(draft.analogyPlan!.authenticityRationale);
  expect(context.classroomContext).toBe(classroomContext);
  expect(context.studentFacingMappingScaffold).not.toHaveProperty("hint");
  expect(context.privateTeacherNotes).toHaveLength(6);
  expect(context.studentFacingSlides[3].body).toBe("");
  const deck = { ...sixStepDeck(), draft };
  const studentText = draft.slides.flatMap((_, index) => slideElements(deck, index).filter(element => element.kind === "text").map(element => element.text)).join("\n");
  expect(studentText).not.toContain(draft.analogyPlan!.authenticityRationale);
  expect(studentText).not.toContain(draft.analogyPlan!.providedMapping);
});

it.each(["phenomenon", "target"])("does not instruct %s image generation or review to reject scenes for classroom location or learner unfamiliarity", visualId => {
  const draft = unfamiliarTargetDraft();
  const imagePrompt = slideImagePrompt(draft, "analogy", visualId);
  const reviewPrompt = slideCheckPrompt(lesson, "analogy", draft, visualId, undefined, classroomContext);
  expect(imagePrompt).not.toMatch(obsoleteRequirements);
  expect(imagePrompt).toContain("FAITHFUL HARDWARE");
  expect(imagePrompt).toContain("Do not expose or invent hidden mechanisms");
  expect(imagePrompt).toContain(draft.visuals.find(visual => visual.id === visualId)!.prompt);
  expect(reviewPrompt.system).not.toMatch(obsoleteRequirements);
  expect(reviewPrompt.system).toContain("SCIENTIFIC TARGET ISOLATION");
  const context = JSON.parse(reviewPrompt.user);
  expect(context.classroomContext).toBe(classroomContext);
  expect(context.visual.id).toBe(visualId);
  if (visualId === "target") {
    expect(reviewPrompt.system).toContain("THREE pictures");
    expect(context.phenomenon).toEqual(draft.visuals[0]);
    expect(context.studentScaffold).not.toHaveProperty("hint");
  }
});

it("keeps target hardware guidance out of the familiar analogue's image contract", () => {
  expect(slideImagePrompt(unfamiliarTargetDraft(), "analogy", "analogue")).not.toContain("FAITHFUL HARDWARE");
});

it("allows a bounded three-part private rationale without expanding other plan fields", () => {
  const draft = unfamiliarTargetDraft();
  draft.analogyPlan!.authenticityRationale = "a".repeat(600);
  expect(analogyPlanErrors(draft.analogyPlan, "six-step")).toEqual([]);
  expect(analogyPlanSchemaFor("six-step").properties.authenticityRationale.maxLength).toBe(600);
  draft.analogyPlan!.authenticityRationale += "a";
  expect(analogyPlanErrors(draft.analogyPlan, "six-step")).toContain("Analogy plan.authenticityRationale: enter 1-600 characters of plain text.");
  draft.analogyPlan!.authenticityRationale = "A real event fits the lesson and needs a brief introduction.";
  draft.analogyPlan!.targetPhenomenon = "a".repeat(401);
  expect(analogyPlanErrors(draft.analogyPlan, "six-step")).toContain("Analogy plan.targetPhenomenon: enter 1-400 characters of plain text.");
});

it("invalidates v6 reviews and teacher acceptance while retaining usable legacy images", () => {
  expect(analogyPromptRevision("six-step")).toBe("analogy-six-step-20261003-v7:six-step");
  expect(SIX_STEP_REVIEW_CONTRACT_VERSION).toBe("analogy-lesson-context-20261003");
  const deck = sixStepDeck();
  const oldKey = (key: string) => {
    const snapshot = JSON.parse(key);
    snapshot[0] = "analogy-teacher-led-20261002";
    return JSON.stringify(snapshot);
  };
  expect(qualityErrors(deck)).toEqual([]);
  deck.checks!.text!.key = oldKey(textCheckKey(deck));
  for (const visual of deck.draft.visuals) deck.checks!.images[visual.id].key = oldKey(imageCheckKey(deck, visual.id));
  deck.teacherDecision = { reason: "Teacher reviewed the earlier generated draft.", draftKey: deck.checks!.text!.key, checks: deck.checks!, assets: deck.assets };
  expect(hasTeacherDecision(deck)).toBe(false);
  const errors = qualityErrors(deck);
  expect(errors).toContain("Text: quality check pending after generation or edits.");
  for (const visual of deck.draft.visuals) {
    expect(errors).toContain(`Image ${visual.id}: visual check pending after generation or edits.`);
    expect(imageMatchesPlan(deck, visual.id)).toBe(true);
  }
  expect(preservedAssets(deck, deck.draft)).toEqual(deck.assets);
  expect(draftErrors(deck.draft, "analogy")).toEqual([]);
});
