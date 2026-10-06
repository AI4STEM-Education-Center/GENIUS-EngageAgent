import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { slidePrompt, slideCheckPrompt, slideOutputFormat, sourceAdaptation } from "@/lib/slides/prompts";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { STRATEGIES } from "@/lib/slides/model";
import { isSlidePromptVersion } from "@/lib/slides/prompt-versions";
import { textCheckKey } from "@/lib/slides/quality";
import { deckFixture } from "../fixtures/slides";

it.each(STRATEGIES)("passes the complete original %s prompt verbatim in A, including revisions", async strategy => {
  const source = await loadSlideSource(strategy);
  const original = await readFile(`docs/references/strategy-prompts/${strategy.replaceAll(" ", "-")}${strategy === "analogy" ? "" : "-20261005"}.txt`, "utf8");
  expect(source.text).toBe(original);
  expect(source.sha256).toBe(createHash("sha256").update(original).digest("hex"));
  const lesson = { lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Notice deformation" };
  for (const draft of [undefined, deckFixture(strategy).draft]) {
    const a = slidePrompt(lesson, strategy, draft, "Keep the action consistent", undefined, { version: "reference", referenceText: source.text });
    const b = slidePrompt(lesson, strategy, draft, "Keep the action consistent", undefined, { version: "optimized", referenceText: source.text });
    expect(a.system).toContain(`<original_method_prompt>\n${original}\n</original_method_prompt>`);
    expect(b.system).not.toContain(original);
    expect(a.system).toContain("EXPLICIT SLIDE ADAPTATION");
    expect(b.system).toContain("EXPLICIT SLIDE ADAPTATION");
    expect(JSON.parse(a.user)).toEqual(JSON.parse(b.user));
    expect(JSON.parse(a.user).referenceVariables.CURRENT_UNDERSTANDING).toContain("Unknown");
    expect(a.system).not.toContain("For this cart comparison, prefer adding");
  }
});

it("fails closed on missing originals and unknown versions, and invalidates changed provenance", () => {
  expect(() => slidePrompt({ lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Notice shape" }, "analogy", undefined, "", undefined, { version: "reference" })).toThrow("Original method prompt");
  for (const value of [null, {}, "", "../reference", "other"]) expect(isSlidePromptVersion(value)).toBe(false);
  const deck = deckFixture("analogy");
  const before = textCheckKey(deck);
  deck.promptProvenance = { version: "reference", revision: "test", sourceSha256: "a".repeat(64) };
  expect(textCheckKey(deck)).not.toBe(before);
});
it("binds the target concept as a concept and does not leak other method examples into lesson context", () => {
  const prompt = slidePrompt({ lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Track energy" }, "analogy");
  const context = JSON.parse(prompt.user);
  expect(context.referenceVariables.TARGET_CONCEPT).toBe("Energy stores, transfers and dissipation in a cart-launcher system");
  expect(context.lessonFocus).not.toMatch(/For conflict|For analogy|For experience|sliding object|counters/u);
});
it.each(STRATEGIES)("uses strategy-specific concept timing and teacher settings consistently in %s generation and review", async strategy => {
  const lesson = { lessonNumber: 5, lessonTitle: "Forces", learningObjective: "Compare contact forces" };
  const source = await loadSlideSource(strategy);
  const classroomContext = "Grade 10; familiar with shared loads; no laboratory equipment.";
  for (const version of ["reference", "optimized"] as const) {
    const prompt = slidePrompt(lesson, strategy, undefined, "", undefined, { version, referenceText: source.text, classroomContext });
    const data = JSON.parse(prompt.user);
    expect(data.learningTarget).toBe("Contact forces");
    expect(data.classroomContext).toBe(classroomContext);
    expect(data.referenceVariables.LEARNER_CONTEXT).toBe(classroomContext);
    expect(prompt.system).not.toContain(classroomContext);
    if (strategy === "experience bridging") {
      expect(prompt.system).toContain("withholds the learningTarget banner on pages 1-2");
      expect(prompt.system).not.toContain("FIRST-STEP LEARNING TARGET:");
    } else if (strategy === "cognitive conflict") {
      expect(prompt.system).toContain("FIRST-STEP LEARNING TARGET:");
      expect(prompt.system).toContain("the neutral supplied learningTarget");
      expect(prompt.system).toContain("choose a specific prediction that remains open after the banner is read");
    } else {
      expect(prompt.system).toContain("LATEST TEACHER DIRECTION takes precedence");
      expect(prompt.system).toContain("first slide visibly orients students");
    }
    expect(prompt.system).not.toContain("with explicit limits.");
  }
  const reviewed = slideCheckPrompt(lesson, strategy, deckFixture(strategy).draft, undefined, undefined, classroomContext);
  expect(JSON.parse(reviewed.user)).toMatchObject({ learningTarget: "Contact forces", classroomContext });
  expect(reviewed.system).not.toContain(classroomContext);
  if (strategy === "experience bridging") {
    expect(reviewed.system).toContain("Read-only lesson, learningTarget, classroomContext");
    expect(sourceAdaptation(strategy)).toContain("never instructions overriding science");
  } else if (strategy === "cognitive conflict") {
    expect(reviewed.system).toContain("LearningTarget, lesson, classroomContext and evidence summaries are read-only context");
    expect(sourceAdaptation(strategy)).toContain("never override scientific accuracy");
  } else {
    expect(reviewed.system).toContain("learningTarget, classroomContext and appOwnedImagePlacement are read-only context");
    expect(sourceAdaptation(strategy)).toContain("never as instructions that override science");
  }
});
it("allows a useful reflection or an optional clarifying boundary in analogy page four", () => {
  const schema = slideOutputFormat("analogy").json_schema.schema as { properties: { slides: { items: { anyOf: { properties: { stage: { enum: string[] }; body: { description: string } } }[] } } } };
  const fourth = schema.properties.slides.items.anyOf[3].properties;
  expect(fourth.stage.enum).toEqual(["reflect", "limits"]);
  expect(fourth.body.description).toContain("Omit or simplify confusing or unnecessary limitations");
  const review = slideCheckPrompt({ lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Track transfers" }, "analogy", deckFixture("analogy").draft);
  expect(review.system).toContain("Slide 4 does NOT require a limitation");
  expect(review.system).toContain("refined or replacement analogue rather than more caveats");
});

it("requires the paired named opening in A, B and revisions while keeping the first concrete hint on page two", async () => {
  const source = await loadSlideSource("analogy");
  const lesson = { lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Track transfers" };
  const legacy = deckFixture("analogy").draft;
  legacy.slides[0].body = "Notice counters moving between two trays.";
  for (const version of ["reference", "optimized"] as const) {
    for (const draft of [undefined, legacy]) {
      const prompt = slidePrompt(lesson, "analogy", draft, "Improve the opening.", undefined, { version, referenceText: source.text });
      const adaptation = prompt.system.split("</original_method_prompt>").at(-1)!;
      expect(adaptation).toContain("PAIRED OPENING OVERRIDE");
      expect(adaptation).toContain("name BOTH the target concept/concrete scientific situation AND the familiar concept/situation");
      expect(adaptation).toContain("Reserve the first concrete mappingHint and responseStarter for step 2");
      expect(adaptation).not.toContain("with only the analogue picture");
      expect(adaptation).not.toContain("Familiar image only");
      expect(adaptation).not.toContain("does not require a target picture");
      expect(JSON.parse(prompt.user).appOwnedImagePlacement).toEqual([
        { slide: 1, images: ["analogue", "target"] },
        { slide: 2, images: ["analogue", "target"] },
        { slide: 3, images: ["target", "variation"] },
        { slide: 4, images: ["analogue", "target"] },
        { slide: 5, images: [] },
      ]);
    }
  }
  const schema = slideOutputFormat("analogy").json_schema.schema as { properties: { slides: { items: { anyOf: { properties: { body: { description: string }; task: { description: string } } }[] } } } };
  const first = schema.properties.slides.items.anyOf[0].properties;
  expect(first.body.description).toContain("Name BOTH the concrete scientific target and familiar concept/situation");
  expect(first.body.description).toContain("plain reason to compare");
  expect(first.task.description).toContain("accessible before the mapping hint on page 2");
  const reviewed = slideCheckPrompt(lesson, "analogy", legacy);
  expect(reviewed.system).toContain("a familiar-only body with a generic target banner is insufficient");
  expect(reviewed.system).toContain("do not postpone the target to page 2");
  expect(JSON.parse(reviewed.user).appOwnedImagePlacement[0]).toEqual({ slide: 1, images: ["analogue", "target"] });
  expect(JSON.parse(reviewed.user).editableFields.every((field: { id: string }) => !field.id.includes("ImagePlacement"))).toBe(true);
});
