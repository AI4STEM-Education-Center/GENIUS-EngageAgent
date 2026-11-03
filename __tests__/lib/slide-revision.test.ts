import { expect, it } from "vitest";
import { parseSlideRevision, slideRevisionOutputFormat, slideRevisionPrompt, validSlideRevisionIndex } from "@/lib/slides/slide-revision";
import { STRATEGIES } from "@/lib/slides/model";
import { slideFixture } from "../fixtures/slides";
import { sixStepDraft } from "../fixtures/analogy-six-step";

it.each(STRATEGIES)("validates only the selected %s page and returns no other content", strategy => {
  const draft = slideFixture(strategy);
  const index = draft.slides.length - 1;
  const slide = { ...draft.slides[index], task: "Write one scientific question you still want to investigate.", teacherNotes: ["Allow time to write independently.", "Collect the questions to plan the next investigation."] };
  const original = structuredClone(draft);
  expect(parseSlideRevision({ slide }, draft, strategy, index, 3)).toEqual(slide);
  expect(draft).toEqual(original);
  const schema = slideRevisionOutputFormat(draft, strategy, index).json_schema.schema as { properties: Record<string, unknown> };
  expect(Object.keys(schema.properties)).toEqual(["slide"]);
  const prompt = slideRevisionPrompt({ lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Notice deformation" }, strategy, draft, index, "Shorten the final task");
  expect(prompt.system).toContain("Revise exactly ONE selected classroom slide");
  expect(prompt.system).not.toContain("Return the complete draft");
  expect(JSON.parse(prompt.user)).toMatchObject({ selectedSlideNumber: index + 1, teacherRequest: "Shorten the final task", selectedSlide: draft.slides[index] });
});

it("requires an empty final body for the six-step method and keeps its stage fixed", () => {
  const draft = sixStepDraft(); const index = draft.slides.length - 1;
  const slide = { ...draft.slides[index], body: "", teacherNotes: ["Collect the learner's own question.", "Use the question to plan the next lesson."] };
  expect(parseSlideRevision({ slide }, draft, "analogy", index, 8)).toEqual(slide);
  expect(() => parseSlideRevision({ slide: { ...slide, body: "Here is the answer." } }, draft, "analogy", index, 8)).toThrow();
  expect(() => parseSlideRevision({ slide: { ...slide, stage: "mapping" } }, draft, "analogy", index, 8)).toThrow();
});

it("rejects invalid indexes, whole-deck outputs, extra fields and oversized selected text", () => {
  const draft = slideFixture("cognitive conflict"); const index = 4;
  const slide = { ...draft.slides[index], teacherNotes: ["Wait for the learner to write.", "Collect the learner's question."] };
  for (const value of [-1, 5, 0.5, "4", null, undefined]) expect(validSlideRevisionIndex(draft, value)).toBe(false);
  for (const value of [draft, { slide, visuals: [] }, { slide: { ...slide, imageIds: [] } }, { slide: { ...slide, task: "word ".repeat(25).trim() } }, { slide: { ...slide, teacherNotes: ["a"] } }]) {
    expect(() => parseSlideRevision(value, draft, "cognitive conflict", index, 3)).toThrow();
  }
  draft.slides[0].title = "An unrelated teacher edit that exceeds the new generation title word limit but remains editable";
  expect(parseSlideRevision({ slide }, draft, "cognitive conflict", index, 3)).toEqual(slide);
});
