import { expect, it } from "vitest";
import JSZip from "jszip";
import { buildPresentationBytes } from "@/lib/slides/export";
import { layoutErrors, slideElements, type MeasureText } from "@/lib/slides/layout";
import { draftErrors, parseDraft, SLIDE_CONTRACT_VERSION } from "@/lib/slides/model";
import { slideCheckPrompt, slideOutputFormat, slidePrompt } from "@/lib/slides/prompts";
import { imageCheckKey, qualityErrors, teachingErrors, textCheckKey } from "@/lib/slides/quality";
import { parseTextFindings, reviewFields } from "@/lib/slides/review";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { deckFixture, slideFixture } from "../fixtures/slides";

const measure: MeasureText = (text, element) => text.length * element.fontSize * .53;
const lesson = { lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Recognize temporary deformation" };

it("omits optional experience connection without losing final inquiry, preview numbering or editable export", async () => {
  const deck = deckFixture("experience bridging");
  deck.draft.slides.splice(3, 1);
  deck.checks!.text!.key = textCheckKey(deck);
  deck.checks!.images.experience.key = imageCheckKey(deck, "experience");
  expect(parseDraft(deck.draft, deck.strategy).slides.map(slide => slide.stage)).toEqual(["experience", "notice", "name", "question"]);
  expect(layoutErrors(deck, measure)).toEqual([]);
  expect(qualityErrors(deck)).toEqual([]);
  expect(slideElements(deck, 3)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "step-number", text: "4" }),
    expect.objectContaining({ id: "question-card" }),
  ]));
  const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
  expect(Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path))).toHaveLength(4);
  for (const page of [1, 2]) {
    const studentXml = await zip.file(`ppt/slides/slide${page}.xml`)!.async("string");
    expect(studentXml).not.toMatch(/Today we investigate|deformation|elastic/iu);
  }
  expect(await zip.file("ppt/slides/slide3.xml")!.async("string")).toContain("Today we investigate: Deformation during contact");
  expect(await zip.file("ppt/slides/slide4.xml")!.async("string")).toContain("MY QUESTION");
  const notes = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
  expect(notes).toContain("before naming the scientific concept on page 3");
  expect(notes).not.toContain("Every opening names the learning target");
});

it("accepts only the two valid experience sequences, including editable revision input", () => {
  const complete = slideFixture("experience bridging");
  expect(draftErrors(complete, "experience bridging")).toEqual([]);
  const omittedCore = slideFixture("experience bridging");
  omittedCore.slides.splice(1, 1);
  expect(draftErrors(omittedCore, "experience bridging", true).join()).toContain("Slide 2.stage: expected notice");
  const misplaced = slideFixture("experience bridging");
  [misplaced.slides[3], misplaced.slides[4]] = [misplaced.slides[4], misplaced.slides[3]];
  expect(draftErrors(misplaced, "experience bridging").join()).toContain("Slide 4.stage: expected connect");
  const shortConflict = slideFixture("cognitive conflict");
  shortConflict.slides.splice(3, 1);
  expect(draftErrors(shortConflict, "cognitive conflict").join()).toContain("exactly five slides");
  const schema = slideOutputFormat("experience bridging").json_schema.schema as { properties: { slides: { minItems: number; maxItems: number } } };
  expect(schema.properties.slides).toMatchObject({ minItems: 4, maxItems: 5 });
});

it("blocks literal scientific naming in every early student surface while preserving private teacher guidance", () => {
  const mutate = [
    (draft: ReturnType<typeof slideFixture>) => { draft.title = "Explore deformation"; },
    ...[0, 1].flatMap(index => (["title", "body", "task"] as const).map(field => (draft: ReturnType<typeof slideFixture>) => { draft.slides[index][field] = "Notice deformation here"; })),
    ...(["caption", "alt"] as const).map(field => (draft: ReturnType<typeof slideFixture>) => { draft.visuals[0][field] = "Deformation under a hand"; }),
  ];
  for (const edit of mutate) {
    const draft = slideFixture("experience bridging"); edit(draft);
    expect(teachingErrors(draft, 3).join()).toContain("introduce the scientific concept name only on slide 3");
  }
  const permitted = slideFixture("experience bridging");
  permitted.slides[0].teacherNotes = ["The target is elastic deformation; defer the scientific name until page 3."];
  expect(teachingErrors(permitted, 3)).toEqual([]);
  expect(teachingErrors(slideFixture("cognitive conflict"), 3)).toEqual([]);
});

it.each(["reference", "optimized"] as const)("keeps %s generation, revision and review aligned to delayed naming and cautious context", async version => {
  const source = await loadSlideSource("experience bridging");
  for (const draft of [undefined, slideFixture("experience bridging")]) {
    const prompt = slidePrompt(lesson, "experience bridging", draft, "Preserve student recall", undefined, { version, referenceText: source.text });
    expect(prompt.system).toContain("Unknown survey results stay unknown");
    expect(prompt.system).toContain("FOUR pages [experience, notice, name, question]");
    expect(prompt.system).not.toContain("FIRST-STEP LEARNING TARGET:");
    expect(prompt.system).not.toContain("EVERY strategy");
    const data = JSON.parse(prompt.user);
    expect(data.orderedStages).toEqual(["experience", "notice", "name", "question"]);
    expect(data.optionalConnectionStage.orderedStagesWhenIncluded).toEqual(["experience", "notice", "name", "connect", "question"]);
    expect(data.learningTargetDisplayStage).toBe("name");
  }
  const review = slideCheckPrompt(lesson, "experience bridging", slideFixture("experience bridging"));
  expect(review.system).toContain("Do not demand earlier target naming");
  expect(review.system).toContain("same conceptual domain");
  expect(review.system).not.toContain("first page is REQUIRED");
  const imageReview = slideCheckPrompt(lesson, "experience bridging", slideFixture("experience bridging"), "experience");
  expect(imageReview.system).toContain("report embedded concept names");
});

it("lets semantic review cite the deck title instead of returning an ungrounded finding", () => {
  const draft = slideFixture("experience bridging");
  draft.title = "Discover elastic deformation";
  expect(reviewFields(draft)).toContainEqual({ id: "deck-title", label: "Deck title", text: draft.title });
  const check = slideCheckPrompt(lesson, "experience bridging", draft);
  expect(JSON.parse(check.user).deckTitle).toBe(draft.title);
  expect(parseTextFindings([{ field: "deck-title", quote: "elastic deformation", problem: "Names the concept before recall.", correction: "Use a literal experience title." }], draft)[0]).toContain("Deck title");
});

it("requires a concrete conflict outcome rather than empty labels or output placeholders", () => {
  for (const result of ["", "...", "[specific result]", "See the image", "The observation"]) {
    const draft = slideFixture("cognitive conflict");
    draft.slides[3].body = `Your prediction: revisit your idea. What we observed in the activity: ${result}`;
    expect(teachingErrors(draft).join()).toContain("state the concrete illustrated outcome");
  }
  expect(teachingErrors(slideFixture("cognitive conflict"))).toEqual([]);
});

it.each(["cognitive conflict", "experience bridging"] as const)("invalidates old %s text/image approvals and teacher decisions under the new contract", strategy => {
  const deck = deckFixture(strategy);
  expect(SLIDE_CONTRACT_VERSION).toBe("student-inquiry-strategies-20261005-v5");
  deck.checks!.text!.key = deck.checks!.text!.key.replace(SLIDE_CONTRACT_VERSION, "student-facing-strategies-20261005-v4");
  const imageId = deck.draft.visuals[0].id;
  deck.checks!.images[imageId].key = deck.checks!.images[imageId].key.replace(SLIDE_CONTRACT_VERSION, "student-facing-strategies-20261005-v4");
  deck.teacherDecision = { reason: "Accepted the older sequence", draftKey: deck.checks!.text!.key, checks: deck.checks!, assets: deck.assets };
  expect(qualityErrors(deck)).toEqual(expect.arrayContaining([
    "Text: quality check pending after generation or edits.",
    `Image ${imageId}: visual check pending after generation or edits.`,
  ]));
});
