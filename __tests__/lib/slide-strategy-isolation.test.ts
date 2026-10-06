import { expect, it } from "vitest";
import { slideCheckPrompt, slideOutputFormat, slidePrompt, sourceAdaptation } from "@/lib/slides/prompts";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { visibleVisualIds } from "@/lib/slides/model";
import { slideFixture } from "../fixtures/slides";

const strategies = ["cognitive conflict", "experience bridging"] as const;
const versions = ["reference", "optimized"] as const;
const lesson = { lessonNumber: 3, lessonTitle: "Contact and deformation", learningObjective: "Notice temporary deformation during contact" };
const classroomContext = "Grade 9; some learners have never caught a ball; allow a related memory or imagined experience.";
const sourceHashes = {
  "cognitive conflict": "1e1e65e6e541f902f7a5073c8056ec35ce8363740ecfa3c2be87c95662557479",
  "experience bridging": "dc9f279f8bb84c464deed9e522ba0e85f7fe1fa45f60bd0610f3384ab5770b46",
};
const effective = (system: string) => system.split("</original_method_prompt>").at(-1)!;
const targetBlocks = (system: string) => system.split("FIRST-STEP LEARNING TARGET:").length - 1;
const expectPrivateBridge = (text: string) => {
  // The clause must place the spoken transition itself in private guidance,
  // rather than merely mentioning notes elsewhere in the same long prompt.
  expect(text).toMatch(/(?:bridge|transition)[^.\n]{0,160}(?:private|teacherNotes)|(?:private|teacherNotes)[^.\n]{0,160}(?:bridge|transition)/iu);
};
const expectNoPairedAnalogyRequirement = (text: string) => {
  expect(text).not.toContain("Page 2 continues that same pair");
  expect(text).not.toContain("For analogy, BOTH the concrete target and familiar concept/situation");
  expect(text).not.toContain("PAIRED OPENING OVERRIDE");
  expect(text).not.toMatch(/(?:page|slide) 1[^.\n]{0,120}(?:both stable pictures|both the familiar analogue and scientific target)/iu);
};
type StageSchema = { properties: { stage: { enum: string[] }; body: { description: string }; task: { description: string } } };
const schemaStages = (strategy: typeof strategies[number]) =>
  (slideOutputFormat(strategy).json_schema.schema as { properties: { slides: { items: { anyOf: StageSchema[] } } } }).properties.slides.items.anyOf;

it.each(strategies)("uses the updated October5 %s source verbatim", async strategy => {
  const source = await loadSlideSource(strategy);
  expect(source.sha256).toBe(sourceHashes[strategy]);
  const a = slidePrompt(lesson, strategy, undefined, "", undefined, { version: "reference", referenceText: source.text });
  expect(a.system).toContain(`<original_method_prompt>\n${source.text}\n</original_method_prompt>`);
});

it.each(strategies.flatMap(strategy => versions.map(version => ({ strategy, version }))))(
  "$strategy $version isolates the selected strategy in generation and revision",
  async ({ strategy, version }) => {
    const source = await loadSlideSource(strategy);
    for (const draft of [undefined, slideFixture(strategy)]) {
      const prompt = slidePrompt(lesson, strategy, draft, draft ? "Clarify the student task while preserving the scenario." : "", undefined,
        { version, referenceText: source.text, classroomContext });
      const instructions = effective(prompt.system);
      expectNoPairedAnalogyRequirement(instructions);
      expect(targetBlocks(prompt.system)).toBe(strategy === "experience bridging" ? 0 : 1);
      expectPrivateBridge(instructions);
      expect(instructions).toMatch(/recap/iu);
      expect(instructions).not.toMatch(/body contains only a short unresolved-observation recap and lesson bridge/iu);
      expect(instructions).not.toMatch(/body is only a short recap\/lesson bridge/iu);
      expect(instructions).not.toMatch(/slide 5\.body[^.\n]{0,100}bridges to the next lesson/iu);
      const data = JSON.parse(prompt.user);
      expect(data.strategy).toBe(strategy);
      expect(data.classroomContext).toBe(classroomContext);
    }
  },
);

it.each(strategies)("keeps %s schema and fully assembled reviewer aligned with private teacher transitions", async strategy => {
  const source = await loadSlideSource(strategy);
  const reviewed = slideCheckPrompt(lesson, strategy, slideFixture(strategy), undefined, undefined, classroomContext);
  // These are the actual instruction-bearing pieces combined by check/route.ts;
  // its surrounding source delimiters and evaluator preamble add no target rule.
  const assembled = `${source.text}\n${sourceAdaptation(strategy, undefined, false)}\n${reviewed.system}`;
  expectNoPairedAnalogyRequirement(assembled);
  expect(targetBlocks(assembled)).toBe(strategy === "experience bridging" ? 0 : 1);
  expectPrivateBridge(reviewed.system);
  expect(reviewed.system).toMatch(/recap|recalls/iu);
  const final = schemaStages(strategy).find(stage => stage.properties.stage.enum.includes("question"))!;
  expect(final.properties.body.description).toMatch(/recap/iu);
  expectPrivateBridge(final.properties.body.description);
  expect(final.properties.task.description).toMatch(/write[\s\S]*own|write[\s\S]*original/iu);
  const data = JSON.parse(reviewed.user);
  expect(data.studentFacingSlides.every((slide: Record<string, unknown>) => !("teacherNotes" in slide))).toBe(true);
  expect(data.privateTeacherNotes[0].teacherNotes).toEqual(slideFixture(strategy).slides[0].teacherNotes);
});

it.each(versions)("preserves cognitive conflict's prediction-before-evidence contract in %s", async version => {
  const strategy = "cognitive conflict";
  const source = await loadSlideSource(strategy);
  const prompt = slidePrompt(lesson, strategy, undefined, "", undefined, { version, referenceText: source.text });
  const instructions = effective(prompt.system);
  expect(instructions).toMatch(/(?:WRITE|written)[^.\n]{0,100}prediction/iu);
  expect(instructions).toContain("first two slides have NO image, particular predicted outcome");
  expect(instructions).toContain("evidence image first appears on slide 3");
  expect(instructions).toContain("Your prediction:");
  expect(instructions).toContain("What we observed in the activity:");
  expect(instructions).toMatch(/recall the student's own idea, never invent it|Never supply the learner's prediction/iu);
  const review = slideCheckPrompt(lesson, strategy, slideFixture(strategy)).system;
  expect(review).toContain("SAME property, action, conditions and time interval");
  expect(review).toContain("A matching prediction may lead to a question");
  expect(review).toContain("If essential result information must be written, ask a further comparison or interpretation");
  expect(instructions).toContain("orient to moments without also stating the answer to a noticing task");
  const evidence = schemaStages(strategy)[2].properties.body.description;
  expect(evidence).toContain("without stating the observation requested by a noticing task");
  expect(evidence).toContain("If a necessary result is written, ask a further interpretation");
  expect(evidence).not.toContain("Describe only the inspectable unexpected result");
  const prediction = schemaStages(strategy).find(stage => stage.properties.stage.enum.includes("prediction"))!;
  expect(prediction.properties.task.description).toMatch(/WRITE a prediction[\s\S]*before seeing the result/iu);
  expect(Array.from({ length: 5 }, (_, index) => visibleVisualIds(strategy, index))).toEqual([[], [], ["evidence"], ["evidence"], []]);
});

it.each(versions)("preserves experience bridging's accessible lived-experience sequence in %s", async version => {
  const strategy = "experience bridging";
  const source = await loadSlideSource(strategy);
  const prompt = slidePrompt(lesson, strategy, undefined, "", undefined, { version, referenceText: source.text, classroomContext });
  const instructions = effective(prompt.system);
  expect(instructions).toMatch(/related personal experience or an accessible imagined instance/iu);
  expect(instructions).toMatch(/learner's lived experience IS the phenomenon/iu);
  expect(instructions).toMatch(/name as science already operating WITHIN the very experience/i);
  const review = slideCheckPrompt(lesson, strategy, slideFixture(strategy)).system;
  expect(review).toMatch(/imagining alternative IN THE OPENING BODY/iu);
  expect(review).toMatch(/SAME recall image on slides 1-2/iu);
  const schema = schemaStages(strategy);
  const first = schema.find(stage => stage.properties.stage.enum.includes("experience"))!;
  const recognition = schema.find(stage => stage.properties.stage.enum.includes("name"))!;
  expect(first.properties.body.description).toMatch(/related experience or imagining alternative/iu);
  expect(recognition.properties.body.description).toMatch(/SAME lived experience/iu);
  expect(recognition.properties.body.description).toMatch(/not a complete mechanism or separate abstract idea/iu);
  expect(Array.from({ length: 5 }, (_, index) => visibleVisualIds(strategy, index))).toEqual([["experience"], ["experience"], [], [], []]);
});
