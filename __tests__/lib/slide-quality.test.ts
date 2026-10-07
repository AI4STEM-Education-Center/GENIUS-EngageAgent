import { expect, it } from "vitest";
import JSZip from "jszip";
import { hasTeacherDecision, imageCheckKey, preservedAssets, qualityErrors, reviewFindings, teachingErrors, textCheckKey } from "@/lib/slides/quality";
import { slideImagePrompt, slideCheckPrompt } from "@/lib/slides/prompts";
import { exportErrors } from "@/lib/slides/layout";
import { buildPresentationBytes } from "@/lib/slides/export";
import { projectPublishedSlides } from "@/lib/slides/publication";
import { SLIDE_CONTRACT_VERSION } from "@/lib/slides/model";
import { deckFixture, slideFixture } from "../fixtures/slides";

it("rejects strategy labels, multi-sentence tasks and answer-copying endings by field", () => {
  const draft = slideFixture("analogy");
  draft.slides[1].title = "Analogy strategy";
  draft.slides[2].task = "Describe the cart. Explain your answer.";
  draft.slides[4].task = "Copy the correct answer.";
  draft.visuals[0].alt = "An analogy for energy.";
  expect(teachingErrors(draft)).toEqual(expect.arrayContaining([
    expect.stringContaining("Slide 2.title"), expect.stringContaining("Slide 3.task"),
    expect.stringContaining("Slide 5.task"), expect.stringContaining("Image analogue.alt"),
  ]));
});
it("allows an energy learning target while keeping the first-page counter mapping unsolved", () => {
  const draft = slideFixture("analogy");
  draft.slides[0].title = "Investigate energy transfers";
  draft.slides[0].body = "Today we investigate energy transfers; first notice counters moving between two trays.";
  expect(teachingErrors(draft)).toEqual([]);
  draft.slides[0].body = "Counters represent amounts but are not literal energy.";
  draft.visuals[0].caption = "Counters tracking energy";
  expect(teachingErrors(draft).join()).toContain("Slide 1.body");
  expect(teachingErrors(draft).join()).toContain("Image analogue.caption");
});
it("invalidates both opening picture reviews after its hook changes without changing other strategies' contract version", () => {
  const deck = deckFixture("analogy");
  deck.draft.slides[0].task = "Point to the counters you could move between the trays.";
  expect(qualityErrors(deck)).toEqual(expect.arrayContaining([
    "Text: quality check pending after generation or edits.",
    "Image analogue: visual check pending after generation or edits.",
    "Image target: visual check pending after generation or edits.",
  ]));
  expect(qualityErrors(deck).join()).not.toContain("Image variation");
  for (const strategy of ["cognitive conflict", "experience bridging"] as const) {
    const other = deckFixture(strategy);
    expect(JSON.parse(textCheckKey(other))[0]).toBe(SLIDE_CONTRACT_VERSION);
    expect(JSON.parse(imageCheckKey(other, other.draft.visuals[0].id))[0]).toBe(SLIDE_CONTRACT_VERSION);
    expect(qualityErrors(other)).toEqual([]);
  }
});
it("invalidates checks after prose, image plan or actual image changes", () => {
  const deck = deckFixture("analogy");
  expect(qualityErrors(deck)).toEqual([]);
  deck.draft.slides[2].body = "A cart touches a spring.";
  expect(qualityErrors(deck).join()).toContain("Text: quality check pending");
  expect(qualityErrors(deck).join()).toContain("Image target: visual check pending");
  expect(qualityErrors(deck).join()).not.toContain("Image analogue");
  deck.draft.visuals[1].prompt = "A new image plan.";
  expect(qualityErrors(deck).join()).toContain("regenerate the changed image plan");
  const swapped = deckFixture("analogy");
  swapped.assets.target.data = swapped.assets.target.data.replace("png", "jpeg");
  expect(qualityErrors(swapped).join()).toContain("visual check pending");
});
it("blocks direct exports with missing or stale checks, missing images and hard output-rule failures", () => {
  const deck = deckFixture("analogy");
  const measure = (text: string) => text.length;
  deck.checks = undefined;
  expect(exportErrors(deck, measure).join()).toContain("quality check pending");
  const stale = deckFixture("analogy");
  stale.checks!.images.target.key = "earlier-version";
  expect(exportErrors(stale, measure)).toContain("Image target: visual check pending after generation or edits.");
  const missing = deckFixture("analogy");
  delete missing.assets.target;
  expect(exportErrors(missing, measure).join()).toContain("Image target: generate an image before downloading.");
  const failed = deckFixture("analogy");
  failed.checks!.text!.model = "output-rules";
  failed.checks!.text!.issues = ["Required output field is invalid."];
  expect(exportErrors(failed, measure)).toContain("Required output field is invalid.");
  expect(reviewFindings(failed)).toEqual([]);
});
it.each(["analogy", "cognitive conflict", "experience bridging"] as const)("exports and projects %s with advisory text/image findings and no written teacher decision", async strategy => {
  const deck = deckFixture(strategy);
  const visualId = deck.draft.visuals[0].id;
  const findings = ["PRIVATE_REVIEW_TEXT: consider a simpler question.", "PRIVATE_REVIEW_IMAGE: inspect the contact geometry."];
  deck.checks!.text!.issues = [findings[0]];
  deck.checks!.text!.model = "test-review-model";
  deck.checks!.images[visualId].issues = [findings[1]];
  deck.checks!.images[visualId].model = "test-review-model";
  expect(deck.teacherDecision).toBeUndefined();
  expect(reviewFindings(deck)).toEqual(findings);
  expect(qualityErrors(deck)).toEqual([]);
  const measure = (text: string) => text.length;
  expect(exportErrors(deck, measure)).toEqual([]);
  const zip = await JSZip.loadAsync(await buildPresentationBytes(deck, measure));
  const pages = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path));
  expect(pages).toHaveLength(deck.draft.slides.length);
  for (const path of pages) expect(await zip.file(path)!.async("string")).not.toContain("PRIVATE_REVIEW_");
  const published = projectPublishedSlides(deck);
  expect(published.pages).toHaveLength(deck.draft.slides.length);
  expect(JSON.stringify(published)).not.toContain("PRIVATE_REVIEW_");
});
it("permits a documented teacher decision on AI findings, never on hard rules or stale checks", () => {
  const deck = deckFixture("analogy");
  deck.checks!.images.target.issues = ["Image target: possible spring ambiguity."];
  deck.teacherDecision = { reason: "I inspected the contact and coil geometry and accept this schematic.", draftKey: textCheckKey(deck), checks: deck.checks!, assets: deck.assets };
  expect(hasTeacherDecision(deck)).toBe(true);
  expect(qualityErrors(deck)).toEqual([]);
  expect(exportErrors(deck, text => text.length)).toEqual([]);
  deck.draft.slides[0].body = "Counters represent energy.";
  expect(hasTeacherDecision(deck)).toBe(false);
  expect(qualityErrors(deck).join()).toContain("save the concrete counter/energy correspondence for slide 2");
  deck.teacherDecision = { ...deck.teacherDecision, draftKey: textCheckKey(deck) };
  expect(qualityErrors(deck).join()).toContain("quality check pending");
  const other = deckFixture("analogy");
  other.teacherDecision = { reason: "A considered teacher decision.", draftKey: textCheckKey(other), checks: other.checks!, assets: other.assets };
  other.checks = { ...other.checks!, images: { ...other.checks!.images } };
  expect(hasTeacherDecision(other)).toBe(false);
});
it("preserves only unchanged image plans and rechecks changed captions or notes", () => {
  const deck = deckFixture("analogy");
  const draft = slideFixture("analogy"); draft.visuals[1].prompt += " A fixed end.";
  expect(Object.keys(preservedAssets(deck, draft))).toEqual(["analogue"]);
  expect(preservedAssets(null, draft)).toEqual({});
  const before = imageCheckKey(deck, "target");
  deck.draft.visuals[1].caption = "A compressed spring";
  expect(imageCheckKey(deck, "target")).not.toBe(before);
  expect(textCheckKey(deck)).not.toBe(deck.checks!.text!.key);
});
it("invalidates a variation when the actual baseline bitmap is replaced", () => {
  const deck = deckFixture("analogy");
  const before = imageCheckKey(deck, "variation");
  deck.assets.target.data = deck.assets.target.data.replace("png", "jpeg");
  expect(imageCheckKey(deck, "variation")).not.toBe(before);
  expect(qualityErrors(deck).join()).toContain("Image variation: regenerate");
  expect(Object.keys(preservedAssets(deck, deck.draft))).toEqual(["analogue", "target"]);
});
it("keeps semantic sequencing review separate from deterministic keyword checks", () => {
  for (const strategy of ["analogy", "cognitive conflict", "experience bridging"] as const) {
    const draft = slideFixture(strategy);
    expect(teachingErrors(draft)).toEqual([]);
    const prompt = slideCheckPrompt({ lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Notice shape change" }, strategy, draft);
    expect(prompt.system).toContain("Review ONLY");
    if (strategy === "cognitive conflict") expect(prompt.system).toContain("ONLY the five-stage cognitive-conflict");
    else expect(prompt.system).toContain("ONLY the selected method");
    expect(JSON.parse(prompt.user).learningTarget).toBe("Deformation during contact");
    if (strategy === "experience bridging") expect(prompt.system).toContain("Do not demand earlier target naming");
    else if (strategy === "analogy") expect(prompt.system).toContain("do not report a missing first-page target merely because it is not repeated");
    else expect(prompt.system).toContain("The application displays the neutral supplied learningTarget");
    if (strategy === "analogy") expect(prompt.system).toContain("Slide 4 does NOT require a limitation");
    if (strategy === "cognitive conflict") expect(prompt.system).toContain("Outcome descriptions are not allowed on pages 1-2");
    if (strategy === "experience bridging") expect(prompt.system).toContain("Do NOT name the scientific concept anywhere student-facing before the name stage on page 3");
  }
});
it("invalidates reviews and teacher decisions after classroom context changes while preserving images", () => {
  const deck = deckFixture("analogy");
  const textBefore = textCheckKey(deck);
  const imageBefore = imageCheckKey(deck, "target");
  deck.teacherDecision = { reason: "Reviewed for the original classroom context.", draftKey: textBefore, checks: deck.checks!, assets: deck.assets };
  expect(hasTeacherDecision(deck)).toBe(true);
  deck.classroomContext = "Grade 10; students have not used spring launchers.";
  expect(textCheckKey(deck)).not.toBe(textBefore);
  expect(imageCheckKey(deck, "target")).not.toBe(imageBefore);
  expect(hasTeacherDecision(deck)).toBe(false);
  expect(qualityErrors(deck).join()).toContain("quality check pending");
  expect(preservedAssets(deck, deck.draft)).toEqual(deck.assets);
});
it("requires a recorded prediction in a cognitive-conflict activity", () => {
  const draft = slideFixture("cognitive conflict");
  draft.slides[1].task = "Predict the ball's shape after release.";
  expect(teachingErrors(draft).join()).toContain("Slide 2.task: explicitly ask students to write");
  draft.slides[1].task = "Record your prediction of the ball's shape after release.";
  expect(teachingErrors(draft)).toEqual([]);
});
it("does not tell learners to watch absent media before a conflict prediction", () => {
  const draft = slideFixture("cognitive conflict");
  draft.slides[0].body = "A ball is dropped. Watch the ball during contact.";
  expect(teachingErrors(draft).join()).toContain("Slide 1.body: describe or imagine the setup");
  draft.slides[0].body = "Imagine dropping a ball onto a table.";
  draft.slides[1].body = "Before you see the result, think about its shape during contact.";
  expect(teachingErrors(draft)).toEqual([]);
  draft.slides[2].task = "Look at the illustration and describe a visible change.";
  expect(teachingErrors(draft)).toEqual([]);
});
it("catches a prediction that already states its shape outcome without banning possible predictions or compressed setups", () => {
  const draft = slideFixture("cognitive conflict");
  draft.slides[1].body = "Predict whether the ball's outer shape changes while it is squashed against the floor.";
  expect(teachingErrors(draft).join()).toContain("Slide 2.body: do not ask whether shape changes");
  for (const text of [
    "Predict whether the ball's shape changes while it touches the floor.",
    "Predict whether the ball becomes flattened during contact.",
    "A compressed spring touches the cart before release; predict the cart's later motion.",
  ]) {
    draft.slides[1].body = text;
    expect(teachingErrors(draft)).toEqual([]);
  }
});
it("grounds image generation in visible text and conditional geometry, without counterpart leakage", () => {
  const draft = slideFixture("analogy");
  const prompt = slideImagePrompt(draft, "analogy", "analogue");
  expect(prompt).toContain("Nine counters distributed");
  expect(prompt).toContain("NEVER the other side");
  expect(prompt).not.toContain("compressed spring");
  expect(prompt).not.toContain("WIDE, LOW OVAL");
  expect(prompt).toContain("SMALL FLAT COUNTING DISCS");
  expect(slideImagePrompt(draft, "analogy", "target")).toContain("SHORT stack");
  const data = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
  expect(data.visual.id).toBe("analogue");
  expect(data.slides).toBeUndefined();
  const variation = slideImagePrompt(draft, "analogy", "variation");
  expect(variation).toContain('"baseline":');
  expect(variation).toContain("change only the named input");
  const lesson = { lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Compare transfers" };
  const singleReview = JSON.parse(slideCheckPrompt(lesson, "analogy", draft, "target").user);
  expect(singleReview).not.toHaveProperty("slides");
  expect(singleReview).not.toHaveProperty("baseline");
  expect(singleReview.visual.id).toBe("target");
  const pairReview = JSON.parse(slideCheckPrompt(lesson, "analogy", draft, "variation").user);
  expect(pairReview.visual.id).toBe("variation");
  expect(pairReview.baseline.id).toBe("target");
});
it("adapts soft-object deformation to the contact surface rather than always flattening vertically", () => {
  const draft = slideFixture("cognitive conflict");
  const prompt = slideImagePrompt(draft, "cognitive conflict", "evidence");
  expect(prompt).toContain("perpendicular to that surface");
  expect(prompt).toContain("vertical-wall collision gives a taller, narrower shape");
  expect(prompt).not.toContain("roughly 1.5 times as wide as tall");
});

it("does not inject target apparatus into an analogue that excludes an internal spring", () => {
  const draft = slideFixture("analogy");
  draft.visuals[0] = { id: "analogue", prompt: "A stretched rubber band hooked to a plain toy, with no internal-spring affordance.", caption: "Stretched rubber band", alt: "Band attached to a toy" };
  const prompt = slideImagePrompt(draft, "analogy", "analogue");
  expect(prompt).toContain("clearly elongated flexible elastic loop");
  expect(prompt).not.toContain("SHORT stack");
  expect(prompt).not.toContain("positively specified contact surfaces FLUSH");
  expect(slideImagePrompt(draft, "analogy", "target")).toContain("positively specified contact surfaces FLUSH");
});

it("does not draw counter props named only in target-plan exclusions and checks target isolation", () => {
  const draft = slideFixture("analogy");
  const lesson = { lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Compare transfers" };
  for (const id of ["target", "variation"]) {
    draft.visuals.find(visual => visual.id === id)!.prompt += " No familiar counters, trays or tokens; no hand moving them.";
    const prompt = slideImagePrompt(draft, "analogy", id);
    expect(prompt).not.toContain("SMALL FLAT COUNTING DISCS");
    expect(prompt).not.toContain("A hand, if planned, picks up or places a disc");
    expect(prompt).toContain("SCIENTIFIC TARGET ROLE");
    expect(prompt).toContain("An object named only in an exclusion is forbidden");
    expect(prompt).toContain("positively specified contact surfaces FLUSH");
    const check = slideCheckPrompt(lesson, "analogy", draft, id);
    expect(check.system).toContain("SCIENTIFIC TARGET ISOLATION");
    expect(check.system).toContain("matching extra props in both do not make them correct");
  }
  expect(slideImagePrompt(draft, "analogy", "analogue")).toContain("SMALL FLAT COUNTING DISCS");
  expect(slideCheckPrompt(lesson, "analogy", draft, "analogue").system).not.toContain("SCIENTIFIC TARGET ISOLATION");
});

it("catches leaked writer guidance in student text without banning private guidance", () => {
  const draft = slideFixture("cognitive conflict");
  draft.slides[2].teacherNotes = ["No causal explanation is given."];
  expect(teachingErrors(draft)).toEqual([]);
  draft.slides[2].body = "The ball flattens. No causal explanation is given.";
  expect(teachingErrors(draft)).toContain("Slide 3.body: remove the writer instruction; describe the situation directly to students and keep production guidance in private notes.");
});

it("keeps reviewer authority on editable content instead of inventing another method's image layout", () => {
  const lesson = { lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Observe shape" };
  for (const strategy of ["cognitive conflict", "experience bridging"] as const) {
    const prompt = slideCheckPrompt(lesson, strategy, slideFixture(strategy));
    expect(prompt.system).not.toContain("analogy slide 1 = analogue");
    if (strategy === "cognitive conflict") expect(prompt.system).toContain("Do not demand extra images, compare unavailable pictures or report app-owned imageIds");
    else expect(prompt.system).toContain("NEVER report imageIds");
    const context = JSON.parse(prompt.user);
    expect(context).not.toHaveProperty("appOwnedImagePlacement");
    expect(context.editableFields.some((field: { id: string }) => field.id.includes("imageIds"))).toBe(false);
    expect(context.studentFacingSlides[0]).not.toHaveProperty("teacherNotes");
    expect(context.privateTeacherNotes[0].teacherNotes).toEqual(slideFixture(strategy).slides[0].teacherNotes);
    if (strategy === "cognitive conflict") expect(prompt.system).toContain("do not add stricter style targets");
    else expect(prompt.system).toContain("do not impose a stricter stylistic length target");
  }
  const picture = slideCheckPrompt(lesson, "cognitive conflict", slideFixture("cognitive conflict"), "evidence");
  expect(picture.system).toContain("Judge instructional adequacy");
  expect(picture.system).toContain("round ball -> visibly flattened under a hand -> round after release");
  expect(picture.system).toContain("all three balls remain round");
});
