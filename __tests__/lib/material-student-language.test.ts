import { describe, expect, it } from "vitest";
import { parseGeneratedMaterialActivity, parseMaterialActivity } from "@/lib/material-activities";
import { buildPublishedContentState } from "@/lib/published-content";
import { conflictActivity } from "../fixtures/material-activities";

const leakedQuestion = "Write one scientific question that came from comparing your prediction with the observedOutcome. Start your question with Why, How, or Under what conditions.";
const correctedQuestion = "Write one scientific question that came from comparing your prediction with the observed result. Start your question with Why, How, or Under what conditions.";
const withQuestion = (text: string) => ({ ...conflictActivity, stages: conflictActivity.stages.map(stage => stage.id === "question" ? { ...stage, text } : { ...stage }) });

describe("cognitive-conflict student language", () => {
  it("repairs the production schema-name leak at generation and published-read boundaries without changing the source", () => {
    const input = withQuestion(leakedQuestion);
    const original = structuredClone(input);
    const generated = parseGeneratedMaterialActivity(input, "cognitive conflict")!;
    const published = buildPublishedContentState([{ content_item_id: "production-video", content_json: JSON.stringify({ title: "Ball during contact", body: leakedQuestion, strategy: "cognitive conflict", activity: input, media: { video: "https://example.org/ball.mp4" } }) }], []);

    expect(generated.stages.at(-1)?.text).toBe(correctedQuestion);
    expect(published.contentItems[0].activity?.stages.at(-1)?.text).toBe(correctedQuestion);
    expect(published.mediaByItemId["production-video"].video).toBe("https://example.org/ball.mp4");
    expect(generated.observedOutcome).toBe(input.observedOutcome);
    expect(generated.image).toEqual(input.image);
    expect(input).toEqual(original);
    expect(parseMaterialActivity(generated, "cognitive conflict")).toEqual(generated);
  });

  it("repairs exact field references in student headings and text while preserving the teacher's surrounding task", () => {
    const input = withQuestion("Use the `activity.observedOutcome` to frame your own question. Keep your chosen conditions unchanged.");
    input.stages[4].title = "Your question about observedOutcome";
    const parsed = parseMaterialActivity(input, "cognitive conflict")!;
    expect(parsed.stages[4]).toEqual({ id: "question", title: "Your question about observed result", text: "Use the observed result to frame your own question. Keep your chosen conditions unchanged." });
    expect(parsed.stages.slice(0, 4)).toEqual(conflictActivity.stages.slice(0, 4));
  });

  it("preserves a teacher's specific question and normal observed-outcome wording", () => {
    const question = "Write your own question about the observed outcome for the rubber ball. Focus on a condition you would change, and keep your wording.";
    const input = withQuestion(question);
    expect(parseMaterialActivity(input, "cognitive conflict")).toEqual(input);
  });
});
