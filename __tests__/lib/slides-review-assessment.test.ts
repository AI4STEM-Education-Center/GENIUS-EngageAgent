import { describe, expect, it } from "vitest";
import { deckFixture } from "../fixtures/slides";
import type { SlideDeck, SlideStrategy } from "@/lib/slides/model";
import { imageCheckKey, imageSourcePrompt, reviewAssessment, teachingErrors, textCheckKey } from "@/lib/slides/quality";

function reviewed(strategy: SlideStrategy = "cognitive conflict"): SlideDeck {
  const deck = deckFixture(strategy);
  deck.checks!.text!.model = "gpt-6.1-sol";
  for (const check of Object.values(deck.checks!.images)) check.model = "gpt-6.1-sol";
  return deck;
}

describe("current slide review assessment", () => {
  it.each(["analogy", "cognitive conflict", "experience bridging"] as const)("recognizes complete, current %s checks without requiring a teacher decision", strategy => {
    const deck = reviewed(strategy);
    expect(reviewAssessment(deck)).toEqual({ complete: true, findings: [], pending: [] });
    expect(deck.teacherDecision).toBeUndefined();
  });

  it("does not interpret no findings as a pass when no checks exist", () => {
    const deck = reviewed(); delete deck.checks;
    const result = reviewAssessment(deck);
    expect(result.complete).toBe(false); expect(result.findings).toEqual([]);
    expect(result.pending).toEqual([expect.stringContaining("Text:"), expect.stringContaining("Image evidence:")]);
  });

  it.each([undefined, "", "   ", "output-rules"])("requires actual AI model provenance instead of %s, including legacy empty checks", model => {
    const deck = reviewed(); deck.checks!.text!.model = model;
    expect(reviewAssessment(deck)).toMatchObject({ complete: false, findings: [], pending: [expect.stringContaining("Text:")] });
    deck.checks!.text!.model = "gpt-6.1-sol"; deck.checks!.images.evidence.model = model;
    expect(reviewAssessment(deck)).toMatchObject({ complete: false, findings: [], pending: [expect.stringContaining("Image evidence:")] });
  });

  it.each(["text", "classroom", "lesson", "provenance"])("invalidates saved checks when %s context changes", change => {
    const deck = reviewed();
    if (change === "text") deck.draft.slides[0].title = "A ball meets a hand";
    if (change === "classroom") deck.classroomContext = "Middle school class.";
    if (change === "lesson") deck.lessonNumber = 4;
    if (change === "provenance") deck.promptProvenance = { version: "optimized", revision: "new-review-source", sourceSha256: "new-source" };
    const result = reviewAssessment(deck);
    expect(result.complete).toBe(false); expect(result.findings).toEqual([]);
    expect(result.pending).toEqual(expect.arrayContaining([expect.stringContaining("Text: the saved review is out of date")]));
  });

  it("requires a valid image for every planned visual even when a cached check claims no issues", () => {
    for (const asset of [undefined, { ...reviewed().assets.evidence, data: "invalid" }]) {
      const deck = reviewed();
      if (asset) deck.assets.evidence = asset; else delete deck.assets.evidence;
      expect(reviewAssessment(deck)).toEqual({ complete: false, findings: [], pending: [expect.stringContaining("Image evidence: the current image is missing or invalid")] });
    }
  });

  it("requires each actual image's review and does not confuse unchanged keys with unchanged pixels", () => {
    const deck = reviewed(); delete deck.checks!.images.evidence;
    expect(reviewAssessment(deck).pending).toEqual([expect.stringContaining("AI review has not been completed")]);
    const replaced = reviewed(); replaced.assets.evidence.data = "data:image/png;base64,iVBORw0KGgo=";
    expect(imageCheckKey(replaced, "evidence")).toBe(replaced.checks!.images.evidence.key);
    expect(reviewAssessment(replaced)).toEqual({ complete: false, findings: [], pending: [expect.stringContaining("Image evidence: the image or slide text has changed")] });
  });

  it("invalidates an unchanged image when its student-facing caption or relevant slide text changes", () => {
    const deck = reviewed(); deck.draft.visuals[0].caption = "An illustration of contact";
    const result = reviewAssessment(deck);
    expect(result.complete).toBe(false);
    expect(result.pending).toEqual(expect.arrayContaining([expect.stringContaining("Image evidence: the image or slide text has changed")]));
  });

  it("does not accept a fresh-looking check when the image no longer matches its plan", () => {
    const deck = reviewed(); deck.draft.visuals[0].prompt += " Show a second hand.";
    deck.checks!.images.evidence.key = imageCheckKey(deck, "evidence");
    deck.checks!.text!.key = textCheckKey(deck);
    expect(reviewAssessment(deck)).toEqual({ complete: false, findings: [], pending: [expect.stringContaining("Image evidence: its image plan or reference has changed")] });
  });

  it("invalidates dependent comparison reviews when baseline pixels change", () => {
    const deck = reviewed("analogy"); deck.assets.target.data = "data:image/png;base64,iVBORw0KGgo=";
    const result = reviewAssessment(deck);
    expect(result.complete).toBe(false);
    expect(result.pending).toEqual(expect.arrayContaining([
      expect.stringContaining("Image target: the image or slide text has changed"),
      expect.stringContaining("Image variation: its image plan or reference has changed"),
    ]));
    deck.assets.variation.referenceData = deck.assets.target.data;
    deck.assets.variation.sourcePrompt = imageSourcePrompt(deck.draft, "variation");
    expect(reviewAssessment(deck).pending).toEqual(expect.arrayContaining([expect.stringContaining("Image variation: the image or slide text has changed")]));
  });

  it("reports grounded current findings separately from completeness and deduplicates teaching rules", () => {
    const deck = reviewed(); deck.draft.slides[1].task = "Predict the shape.";
    const rule = teachingErrors(deck.draft, deck.lessonNumber).find(issue => issue.startsWith("Slide 2.task:"))!;
    deck.checks!.text = { key: textCheckKey(deck), model: "gpt-6.1-sol", issues: [rule, "Slide 1.body: Clarify the contact setup."] };
    deck.checks!.images.evidence = { ...deck.checks!.images.evidence, key: imageCheckKey(deck, "evidence"), issues: ["Image evidence: The drawn gap contradicts contact; close the gap."] };
    expect(reviewAssessment(deck)).toEqual({ complete: true, findings: [rule, "Slide 1.body: Clarify the contact setup.", "Image evidence: The drawn gap contradicts contact; close the gap."], pending: [] });
  });

  it("keeps current findings while other checks are pending and discards findings from old snapshots", () => {
    const deck = reviewed(); deck.checks!.text!.issues = ["Current text correction."];
    deck.checks!.images.evidence.key = "old-snapshot"; deck.checks!.images.evidence.issues = ["Obsolete image correction."];
    expect(reviewAssessment(deck)).toEqual({ complete: false, findings: ["Current text correction."], pending: [expect.stringContaining("Image evidence:")] });
    deck.checks!.text!.key = "old-text";
    expect(reviewAssessment(deck).findings).toEqual([]);
  });

  it("does not mutate the deck or its saved checks", () => {
    const deck = reviewed(); const original = structuredClone(deck);
    reviewAssessment(deck);
    expect(deck).toEqual(original);
  });
});
