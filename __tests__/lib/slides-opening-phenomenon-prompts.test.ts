import { expect, it } from "vitest";
import { slideCheckPrompt, slideImagePrompt, slideOutputFormat, slidePrompt, sourceAdaptation } from "@/lib/slides/prompts";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { cognitiveConflictOpeningDraft, slideFixture } from "../fixtures/slides";
import { sixStepDraft } from "../fixtures/analogy-six-step";

const lesson = { lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Recognize temporary deformation" };
const strategies = ["analogy", "cognitive conflict", "experience bridging"] as const;
type SchemaVariant = { properties: Record<string, { description: string; enum?: string[] }> };
function schemaParts(strategy: typeof strategies[number], method?: "six-step" | "reference-story" | "predict-transfer") {
  return (slideOutputFormat(strategy, method).json_schema.schema as { properties: {
    slides: { minItems: number; maxItems: number; items: { anyOf: SchemaVariant[] } };
    visuals: { minItems: number; maxItems: number; items: { anyOf: SchemaVariant[] } };
  } }).properties;
}

it.each(strategies)("keeps a lesson-aligned first-page phenomenon in both %s generation versions", async strategy => {
  const method = strategy === "analogy" ? "six-step" : undefined;
  const source = await loadSlideSource(strategy, method);
  for (const version of ["reference", "optimized"] as const) {
    const prompt = slidePrompt(lesson, strategy, undefined, "", undefined, { version, referenceText: source.text, analogyMethod: method });
    const effective = prompt.system.split("</original_method_prompt>").at(-1)!;
    expect(effective).toContain("Page 1 must include a concrete, lesson-aligned illustration");
    expect(effective).toContain("a decorative topic picture, title card or abstract concept icon is not sufficient");
    expect(effective).toContain("Preserve the selected strategy's order and concept-reveal timing");
    if (strategy === "cognitive conflict") {
      expect(JSON.parse(prompt.user).orderedImages).toEqual(["phenomenon", "evidence"]);
      expect(JSON.parse(prompt.user).appOwnedImagePlacement.map((page: { images: string[] }) => page.images)).toEqual([
        ["phenomenon"], ["phenomenon"], ["evidence"], ["evidence"], [],
      ]);
      expect(effective).toContain("Page 1 uses the picture to establish the situation");
      expect(effective).toContain("Page 5 is text-only");
      expect(effective).not.toMatch(/first two slides have NO image|one evidence-image generation plan|One image plan: evidence/iu);
    } else if (strategy === "experience bridging") {
      expect(effective).toContain("Do NOT name the scientific concept anywhere student-facing before the name stage on page 3");
      expect(effective).toContain("related personal experience or an accessible imagined instance");
      expect(effective).toContain("FOUR pages");
    } else {
      expect(effective).toMatch(/analogue.*(?:first appears|introduced separately|introduced alone).*page 3/iu);
      expect(effective).toMatch(/same[^.\n]{0,70}event/iu);
    }
  }
});

it("puts the setup/result distinction beside the actual generated fields without adding stages", () => {
  const schema = schemaParts("cognitive conflict");
  expect([schema.slides.minItems, schema.slides.maxItems]).toEqual([5, 5]);
  expect([schema.visuals.minItems, schema.visuals.maxItems]).toEqual([2, 2]);
  expect(schema.visuals.items.anyOf.map(image => image.properties.id.enum)).toEqual([["phenomenon"], ["evidence"]]);
  expect(schema.slides.items.anyOf[0].properties.body.description).toContain("concrete illustrated phenomenon setup");
  expect(schema.slides.items.anyOf[1].properties.body.description).toContain("SAME phenomenon setup picture");
  const [setup, evidence] = schema.visuals.items.anyOf;
  expect(setup.properties.prompt.description).toContain("never the result");
  expect(setup.properties.caption.description).toContain("no tested result or scientific explanation before the prediction");
  expect(setup.properties.alt.description).toContain("describe setup only, never its tested result");
  expect(evidence.properties.prompt.description).toContain("Continue the SAME phenomenon setup");
  expect(evidence.properties.prompt.description).toContain("reveal its outcome only on pages 3-4");
});

it("generates and reviews the setup separately from the later result and compares actual continuation images", () => {
  const draft = cognitiveConflictOpeningDraft();
  const setup = slideImagePrompt(draft, "cognitive conflict", "phenomenon");
  expect(setup).toContain("OPENING PHENOMENON SETUP");
  expect(setup).toContain("Never depict the tested result");
  expect(setup).not.toContain("Show the actual distinguishing feature clearly");
  expect(setup).not.toContain("Do not merely move an unchanged circle");
  expect(setup).not.toContain("A recovered ball is round");
  const setupReview = slideCheckPrompt(lesson, "cognitive conflict", draft, "phenomenon");
  expect(setupReview.system).toContain("There is ONE picture");
  expect(setupReview.system).toContain("Do NOT request the later distinguishing outcome");
  expect(JSON.parse(setupReview.user).slides.map((slide: { number: number }) => slide.number)).toEqual([1, 2]);
  const result = slideImagePrompt(draft, "cognitive conflict", "evidence");
  expect(result).toContain("CONTINUE THE ATTACHED PHENOMENON SETUP IMAGE");
  expect(result).toContain("Do not merely move an unchanged circle");
  expect(result).toContain("A recovered ball is round");
  expect(result).toContain(draft.visuals[0].prompt);
  const resultReview = slideCheckPrompt(lesson, "cognitive conflict", draft, "evidence");
  expect(resultReview.system).toContain("PHENOMENON SETUP first, the subsequent EVIDENCE second");
  expect(JSON.parse(resultReview.user).imageOrder).toEqual(["phenomenon", "evidence"]);
  expect(JSON.parse(resultReview.user).phenomenon).toEqual(draft.visuals[0]);
  expect(JSON.parse(resultReview.user).slides.map((slide: { number: number }) => slide.number)).toEqual([3, 4]);
});

it("reviews saved evidence-only conflict decks using their real media instead of demanding a migration", () => {
  const draft = slideFixture("cognitive conflict");
  const text = slideCheckPrompt(lesson, "cognitive conflict", draft);
  // The route prepends the current source adaptation. The final review instruction
  // explicitly overrides its new-generation media rule for this existing draft.
  const wrapped = `${sourceAdaptation("cognitive conflict")}\n${text.system}`;
  expect(wrapped.lastIndexOf("LEGACY MEDIA TIMING OVERRIDE")).toBeGreaterThan(wrapped.indexOf("ILLUSTRATED OPENING PHENOMENON"));
  expect(text.system).toContain("do not demand a missing opening image");
  expect(text.system).not.toContain("Two image plans in order: phenomenon, evidence");
  expect(JSON.parse(text.user).appOwnedImagePlacement.map((slide: { images: string[] }) => slide.images)).toEqual([[], [], ["evidence"], ["evidence"], []]);
  const image = slideCheckPrompt(lesson, "cognitive conflict", draft, "evidence");
  expect(image.system).toContain("There is ONE picture");
  expect(image.system).not.toContain("PHENOMENON SETUP first");
  expect(JSON.parse(image.user)).not.toHaveProperty("phenomenon");
  expect(slideImagePrompt(draft, "cognitive conflict", "evidence")).not.toContain("CONTINUE THE ATTACHED PHENOMENON SETUP IMAGE");
});

it("preserves analogy's six-step reveal and experience-first naming while improving their actual opening picture", () => {
  const analogy = sixStepDraft();
  const phenomenon = slideImagePrompt(analogy, "analogy", "phenomenon");
  expect(phenomenon).toContain("concrete authentic real-world TARGET phenomenon students will explain");
  expect(phenomenon).toContain("not the familiar analogue");
  expect(slideCheckPrompt(lesson, "analogy", analogy).system).toContain("not a decorative topic image or abstract concept icon");
  const experience = slideFixture("experience bridging");
  expect(slideImagePrompt(experience, "experience bridging", "experience")).toContain("without naming the scientific concept");
  expect(slideCheckPrompt(lesson, "experience bridging", experience).system).toContain("not an unrelated decorative activity or an abstract concept icon");
  const schema = schemaParts("experience bridging");
  expect([schema.slides.minItems, schema.slides.maxItems]).toEqual([4, 5]);
  expect(schema.visuals.items.anyOf[0].properties.prompt.description).toContain("concept is not named until page 3");
});

it.each(["reference-story", "predict-transfer"] as const)("preserves the %s paired opening while grounding its target image in the phenomenon", method => {
  const prompt = slidePrompt(lesson, "analogy", undefined, "", undefined, { analogyMethod: method });
  expect(JSON.parse(prompt.user).appOwnedImagePlacement[0].images).toEqual(["analogue", "target"]);
  const schema = schemaParts("analogy", method);
  expect([schema.slides.minItems, schema.slides.maxItems]).toEqual([5, 5]);
  const target = schema.visuals.items.anyOf.find(image => image.properties.id.enum?.[0] === "target")!;
  expect(target.properties.prompt.description).toContain("concrete lesson-aligned");
  expect(target.properties.prompt.description).toContain("investigate and explain");
});
