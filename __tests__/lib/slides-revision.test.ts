import { expect, it } from "vitest";
import { slideRevisionFeedback, SLIDE_REVISION_RULES } from "@/lib/slides/revision";
import { slidePrompt } from "@/lib/slides/prompts";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import type { SlideStrategy } from "@/lib/slides/model";
import type { AnalogyMethod } from "@/lib/slides/analogy-methods";
import { slideFixture } from "../fixtures/slides";

it.each([4000, 6000])("retains the entire maximum-length teacher request within the %i-character endpoint limit", maxLength => {
  const teacherRequest = "T".repeat(2990) + "KEEP RIGHT";
  const result = slideRevisionFeedback(teacherRequest, ["Finding. ".repeat(1000)], maxLength);
  expect(result.length).toBeLessThanOrEqual(maxLength);
  expect(result).toContain(teacherRequest);
  expect(result.indexOf(teacherRequest)).toBeLessThan(result.indexOf("AI review findings"));
  expect(result).toContain("priority over AI suggestions, within scientific and strategy requirements");
});

it("deduplicates findings without labeling AI-only correction as a teacher instruction", () => {
  const result = slideRevisionFeedback("  ", ["Fix the caption.", " Fix the caption. ", ""]);
  expect(result).not.toContain("Teacher revision request");
  expect(result).toContain("AI review findings");
  expect(result.match(/Fix the caption\./g)).toHaveLength(1);
  expect(slideRevisionFeedback("", [])).toBe("");
});

const methods: Array<[SlideStrategy, AnalogyMethod | undefined]> = [
  ["cognitive conflict", undefined], ["experience bridging", undefined],
  ["analogy", "six-step"], ["analogy", "reference-story"], ["analogy", "predict-transfer"],
];

it.each(methods)("applies the same local-revision safeguards to %s / %s in both prompt versions", async (strategy, analogyMethod) => {
  const source = await loadSlideSource(strategy, analogyMethod);
  const draft = slideFixture(strategy);
  const teacherRequest = "Simplify only this image; keep the left spring and rightward cart motion.";
  const feedback = slideRevisionFeedback(teacherRequest, ["Image evidence: make the later position clear."]);
  const lesson = { lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Track stored energy during release" };
  for (const version of ["reference", "optimized"] as const) {
    const options = { version, referenceText: source.text, analogyMethod };
    const revision = slidePrompt(lesson, strategy, draft, feedback, undefined, options);
    const generation = slidePrompt(lesson, strategy, undefined, "", undefined, options);
    expect(revision.system).toContain(SLIDE_REVISION_RULES);
    expect(generation.system).not.toContain("REVISION SCOPE AND PRIORITY:");
    expect(revision.system).toContain("teacher explicitly requests it or a definite scientific error");
    expect(revision.system).toContain("never describe a new scene while keeping a contradictory old image plan");
    expect(JSON.parse(revision.user).correctionRequest).toBe(feedback);
    expect(JSON.parse(revision.user).draft).toEqual(draft);
    expect(JSON.parse(generation.user).correctionRequest).toBeUndefined();
  }
});
