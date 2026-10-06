import { expect, it } from "vitest";
import JSZip from "jszip";
import { buildPresentationBytes } from "@/lib/slides/export";
import { draftErrors, parseDraft, type SlideStrategy } from "@/lib/slides/model";
import { slideElements, layoutErrors, type MeasureText } from "@/lib/slides/layout";
import { imageCheckKey, qualityErrors, teachingErrors, textCheckKey } from "@/lib/slides/quality";
import { slideCheckPrompt, slideImagePrompt, slideOutputFormat, slidePrompt } from "@/lib/slides/prompts";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { deckFixture, slideFixture } from "../fixtures/slides";

const measure: MeasureText = (text, element) => text.length * element.fontSize * .53;
const lesson = { lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Recognize temporary deformation" };
const methods = ["cognitive conflict", "experience bridging"] as const;

it.each(methods)("keeps sparse %s fields valid while retaining required learner tasks and private-note bounds", strategy => {
  const draft = slideFixture(strategy);
  draft.slides[2].body = "";
  draft.visuals[0].caption = "";
  draft.slides[2].teacherNotes = ["Purpose: recognize a specific change.", "Ask about the change in the contact area. A student may recall a dent and a return to the earlier shape. If stuck, ask what happened when the hand moved away, and accept a different remembered result. Use that evidence to distinguish a possible explanation from what was actually noticed; leave the cause for further investigation."];
  expect(draftErrors(draft, strategy)).toEqual([]);
  expect(layoutErrors({ ...deckFixture(strategy), draft }, measure)).toEqual([]);
  draft.slides[2].teacherNotes[1] = "a".repeat(901);
  expect(draftErrors(draft, strategy).join()).toContain("teacherNotes");
  draft.slides[2].task = "";
  expect(draftErrors(draft, strategy).join()).toContain("Slide 3.task");
  const legacy = slideFixture("analogy");
  legacy.slides[0].body = "";
  expect(draftErrors(legacy, "analogy").join()).toContain("Slide 1.body");
});

it.each(methods)("keeps old %s recap editable while requiring it to move to private notes", strategy => {
  const deck = deckFixture(strategy);
  const oldRecap = "Next, we will investigate the cause of this change.";
  deck.draft.slides.at(-1)!.body = oldRecap;
  expect(parseDraft(deck.draft, strategy, true)).toBe(deck.draft);
  expect(teachingErrors(deck.draft).join()).toContain("leave this empty");
  expect(slideElements(deck, deck.draft.slides.length - 1).filter(e => e.kind === "text").map(e => e.text).join()).not.toContain(oldRecap);
});

it.each(methods)("rejects concrete teacher-language leaks in %s without blocking student directions or private support", strategy => {
  const draft = slideFixture(strategy);
  draft.slides[0].teacherNotes = ["Ask students to recall contact; next, we will investigate the cause."];
  draft.slides[0].task = "Write one detail from a moment when you touched something soft.";
  expect(teachingErrors(draft)).toEqual([]);
  for (const field of ["title", "body", "task"] as const) {
    const leaked = slideFixture(strategy);
    leaked.slides[0][field] = "Ask students to recall a familiar occasion.";
    expect(teachingErrors(leaked).join()).toContain(`Slide 1.${field}: move teacher/writer directions`);
  }
  draft.visuals[0].caption = "Teacher should elicit observations.";
  expect(teachingErrors(draft).join()).toContain("move teacher/writer directions");
  draft.slides[0].title = "Present a Familiar Phenomenon";
  expect(teachingErrors(draft).join()).toContain("natural title");
  draft.slides[0].body = "Today we investigate: Shape changes.";
  expect(teachingErrors(draft).join()).toContain("remove the repeated learning-target banner");
  draft.slides[0].title = "1. A Ball on a Table";
  expect(teachingErrors(draft).join()).toContain("remove the numbered prefix");
});

it.each([
  ["cognitive conflict", false],
  ["experience bridging", false],
  ["experience bridging", true],
] as const)("exports %s with optional connection=%s and teacher explanations only in speaker notes", async (strategy, connect) => {
  const deck = deckFixture(strategy);
  if (strategy === "experience bridging" && !connect) deck.draft.slides.splice(3, 1);
  const privateAnswer = "PRIVATE CAUSE: the material stores energy while changing shape.";
  const privateBridge = "PRIVATE BRIDGE: collect the questions before investigating the cause.";
  deck.draft.slides[2].teacherNotes = [privateAnswer, "Ask about the remembered or illustrated difference without giving its cause."];
  deck.draft.slides.at(-1)!.teacherNotes = ["Recall the unresolved change without resolving it.", privateBridge];
  deck.checks!.text!.key = textCheckKey(deck);
  const visual = deck.draft.visuals[0].id;
  deck.checks!.images[visual].key = imageCheckKey(deck, visual);
  expect(qualityErrors(deck)).toEqual([]);
  expect(layoutErrors(deck, measure)).toEqual([]);
  const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
  const count = strategy === "experience bridging" && !connect ? 4 : 5;
  expect(Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path))).toHaveLength(count);
  for (let page = 1; page <= count; page++) {
    const xml = await zip.file(`ppt/slides/slide${page}.xml`)!.async("string");
    expect(xml).not.toContain(privateAnswer);
    expect(xml).not.toContain(privateBridge);
    if (strategy === "experience bridging" && page < 3) expect(xml).not.toMatch(/Today we investigate|deformation/iu);
    if (strategy === "cognitive conflict" && page < 3) expect(xml).not.toContain("<p:pic>");
  }
  const last = slideElements(deck, count - 1);
  expect(last.map(e => e.id)).not.toContain("body");
  expect(last).toContainEqual(expect.objectContaining({ id: "task", frame: expect.objectContaining({ top: 232 }) }));
  expect(await zip.file(`ppt/slides/slide${count}.xml`)!.async("string")).toContain("MY QUESTION");
  expect(await zip.file("ppt/notesSlides/notesSlide3.xml")!.async("string")).toContain(privateAnswer);
  expect(await zip.file(`ppt/notesSlides/notesSlide${count}.xml`)!.async("string")).toContain(privateBridge);
});

it.each(methods)("aligns %s A/B generation, revision, schema and semantic review without importing analogy stages", async strategy => {
  const source = await loadSlideSource(strategy);
  for (const version of ["reference", "optimized"] as const) {
    for (const draft of [undefined, slideFixture(strategy)]) {
      const prompt = slidePrompt(lesson, strategy, draft, "Keep inquiry open", undefined, { version, referenceText: source.text });
      expect(prompt.system).toContain("The FINAL body MUST be empty");
      expect(prompt.system).toContain("150 words/900 characters");
      expect(prompt.system).toContain("non-leading follow-up");
      expect(prompt.system).toContain("not a fully written question to copy");
      expect(prompt.system).not.toContain("load_paths_analogy_soc.pptx");
      expect(prompt.system).not.toContain("PAIRED OPENING OVERRIDE");
      expect(prompt.system).not.toContain("final body briefly recalls");
      if (strategy === "cognitive conflict") {
        expect(prompt.system).toContain("matching prediction");
        expect(prompt.system).toContain("proposed model -> what it predicts for THIS event -> the visible result");
        expect(prompt.system).toContain("why that initial expectation is plausible for the given age/context");
      } else {
        expect(prompt.system).toContain("Do not manufacture a surprise");
        expect(prompt.system).toContain("Carry that alternative through EVERY later stage");
        expect(prompt.system).toContain("conditional recognition");
        expect(prompt.system).toContain("brief plain-language foothold");
      }
    }
  }
  const check = slideCheckPrompt(lesson, strategy, slideFixture(strategy));
  expect(check.system).toContain("The final body is empty");
  expect(check.system).toContain("Necessary evidence is allowed");
  expect(check.system).toContain("exact quote");
  const schema = slideOutputFormat(strategy).json_schema.schema as { properties: { slides: { items: { anyOf: { properties: { stage: { enum: string[] }; body: { enum?: string[]; pattern: string }; teacherNotes: { items: { maxLength: number } } } }[] } } } };
  const stages = schema.properties.slides.items.anyOf;
  expect(stages.find(stage => stage.properties.stage.enum[0] === "question")!.properties.body.enum).toEqual([""]);
  expect(stages.every(stage => new RegExp(stage.properties.body.pattern).test(""))).toBe(true);
  expect(stages.every(stage => stage.properties.teacherNotes.items.maxLength === 900)).toBe(true);
});

it.each(methods)("permits familiar lesson-eight contexts in %s without imposing the cart apparatus", strategy => {
  const data = JSON.parse(slidePrompt({ lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Stored energy and transfer" }, strategy as SlideStrategy).user);
  expect(data.lessonFocus).toContain("not a required learner experience");
  expect(data.referenceVariables.TARGET_CONCEPT).toContain("familiar real-world event");
});

it("checks the conflict image against the actual prior prediction and invalidates approval if that comparison changes", () => {
  const deck = deckFixture("cognitive conflict");
  const priorKey = imageCheckKey(deck, "evidence");
  const task = "Write a prediction of the ball's shape after the palm is lifted, with one reason.";
  deck.draft.slides[1].task = task;
  expect(imageCheckKey(deck, "evidence")).not.toBe(priorKey);
  const context = JSON.parse(slideCheckPrompt(lesson, deck.strategy, deck.draft, "evidence").user);
  expect(context.predictionContext[1].task).toBe(task);
  expect(context.predictionContext.every((page: Record<string, unknown>) => !("teacherNotes" in page))).toBe(true);
  expect(context.slides.map((page: { number: number }) => page.number)).toEqual([3, 4]);
  expect(slideImagePrompt(deck.draft, deck.strategy, "evidence")).toContain(task);
});

it("preserves controlled-condition evidence instead of forcing every conflict into two or three time panels", () => {
  const draft = slideFixture("cognitive conflict");
  draft.visuals[0].prompt = "Two rows show two trials of the same spring toy. Each row has the initial spring setting and the same ball at maximum height. Four planned states total, with stable scale and base reference.";
  draft.slides[1].task = "Write a prediction comparing maximum ball height after the two spring settings, with one reason.";
  const picture = slideImagePrompt(draft, "cognitive conflict", "evidence");
  expect(picture).toContain(draft.visuals[0].prompt);
  expect(picture).toContain("ordered moments OR controlled conditions");
  expect(picture).toContain("retain those distinct states instead of dropping evidence to fit a count");
  expect(picture).toContain("Never add duplicate same-state sketches");
  expect(picture).not.toContain("planned 2-3 time panels");
  const review = slideCheckPrompt(lesson, "cognitive conflict", draft, "evidence").system;
  expect(review).toContain("Ordered moments and controlled-condition comparisons are both valid");
  expect(review).toContain("not a required time-panel count");
  const generated = slidePrompt(lesson, "cognitive conflict").system;
  expect(generated).toContain("initial setting and the same later outcome for each trial");
  expect(generated).not.toMatch(/(?:2-3|two or three) (?:time panels|ordered moments)/iu);
  const schema = slideOutputFormat("cognitive conflict").json_schema.schema as { properties: { visuals: { items: { anyOf: { properties: { prompt: { description: string } } }[] } } } };
  expect(schema.properties.visuals.items.anyOf[0].properties.prompt.description).toContain("ordered moments OR controlled conditions");
});
