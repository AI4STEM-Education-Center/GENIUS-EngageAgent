import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getLessonGenerationContext, getStrategyContext } from "@/lib/lesson-context";
import { buildMaterialImageInstructions, buildMaterialPrompt, MATERIAL_REVIEW_INSTRUCTIONS, MATERIAL_STRATEGY_REVISION, materialReviewInstructions } from "@/lib/material-prompts";
import { materialOutputFormat } from "@/lib/material-output-schema";
import { parseGeneratedMaterialActivity } from "@/lib/material-activities";
import { analogyActivity, bridgingActivity, conflictActivity } from "../fixtures/material-activities";

const strategies = ["cognitive conflict", "experience bridging"] as const;
const prompt = (strategy: string) => buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext(strategy));

describe("CC/EB student inquiry refinement", () => {
  it("leaves the existing analogy generation, schema and image prompt byte-identical", () => {
    // Snapshot taken immediately before this scoped CC/EB change. All eight
    // curricula are included so a shared-constant edit cannot silently leak in.
    const analogySnapshot = {
      prompts: Array.from({ length: 8 }, (_, index) => buildMaterialPrompt(getLessonGenerationContext(index + 1)!, getStrategyContext("analogy"))),
      schema: materialOutputFormat("analogy"),
      image: buildMaterialImageInstructions({ strategy: "analogy", activity: analogyActivity }),
    };
    expect(createHash("sha256").update(JSON.stringify(analogySnapshot)).digest("hex")).toBe("a245895f0a2867a14b02a3e547c259b5eb4e1a75fdbaa263791adbb6360327a6");
  });

  it.each(strategies)("keeps %s generation and actual review on the same student-facing contract", strategy => {
    const generation = prompt(strategy);
    expect(MATERIAL_STRATEGY_REVISION).toBe("cc-eb-20261005-v2");
    expect(generation.system).toContain(MATERIAL_STRATEGY_REVISION);
    for (const instructions of [generation.user, materialReviewInstructions(strategy)]) {
      expect(instructions).toContain("ONE coherent, lesson-aligned episode");
      expect(instructions).toContain("focus and wording to the learner");
      expect(instructions).toContain("GENERAL unfinished");
      expect(instructions).toMatch(/natural scene titles/i);
      expect(instructions).toMatch(/facilitation directions/);
    }
    expect(generation.user).not.toContain("ANALOGY STUDENT FOLLOWABILITY");
  });

  it("uses a focused reviewer for the selected inquiry method while preserving analogy's reviewer", () => {
    expect(materialReviewInstructions("analogy")).toBe(MATERIAL_REVIEW_INSTRUCTIONS);
    const cc = materialReviewInstructions("cognitive conflict");
    const eb = materialReviewInstructions("experience bridging");
    expect(cc).toContain("Read the opening and prediction BEFORE reading the result");
    expect(cc).toContain("Two copies of the same pressed state");
    expect(cc).not.toContain("UPDATED EXPERIENCE BRIDGING CONTRACT");
    expect(eb).toContain("Replace answer-bearing noticing instructions");
    expect(eb).not.toContain("UPDATED COGNITIVE CONFLICT CONTRACT");
  });

  it("keeps conflict uncertainty valid even when prediction matches and the result is stated", () => {
    for (const instructions of [prompt("cognitive conflict").user, materialReviewInstructions("cognitive conflict")]) {
      expect(instructions).toContain("SAME predicted feature under the SAME stated conditions");
      expect(instructions).toContain("Supplying an observed result is allowed");
      expect(instructions).toContain("DIFFERENT meaningful task");
      expect(instructions).toContain("A matching prediction can still leave");
      expect(instructions).toContain("an age-appropriate incomplete rule supported by diagnostic or curriculum context");
      expect(instructions).toContain("does not replace the need to design a meaningful model-evidence contrast");
      expect(instructions).toContain("Do not invent a study, citation, camera recording or measured value");
    }
    const outcome = "The schematic shows a wider contact outline; this is a drawing, not measured camera evidence.";
    const draft = parseGeneratedMaterialActivity({ ...conflictActivity, observedOutcome: outcome }, "cognitive conflict")!;
    expect(draft.stages.find(stage => stage.id === "compare")!.text).toContain(outcome);
    expect(draft.stages.find(stage => stage.id === "compare")!.text).toContain("match or differ");
    expect(draft.stages.slice(0, 2).every(stage => !stage.text.includes(outcome))).toBe(true);
  });

  it("keeps bridging's noticing task open and avoids invented learner experiences or responses", () => {
    for (const instructions of [prompt("experience bridging").user, materialReviewInstructions("experience bridging")]) {
      expect(instructions).toContain("without supplying the noticing task's answer");
      expect(instructions).toContain("one frozen image does not prove a before/after change");
      expect(instructions).toContain("Keep the recalled OR imagined choice valid through notice, name and the final question");
      expect(instructions).toContain('Do not assert "you noticed" or "you have experienced"');
      expect(instructions).toContain("Name the target scientific concept ONLY in stage 3");
      expect(instructions).toContain("same conceptual domain");
    }
    const fourStages = { ...bridgingActivity, stages: bridgingActivity.stages.filter(stage => stage.id !== "connect") };
    expect(parseGeneratedMaterialActivity(fourStages, "experience bridging")?.stages).toEqual(fourStages.stages);
    expect(parseGeneratedMaterialActivity(bridgingActivity, "experience bridging")?.stages).toEqual(bridgingActivity.stages);
  });

  it.each(strategies)("gives %s provider schema semantic guidance without adding public teacher fields", strategy => {
    const schema = materialOutputFormat(strategy).json_schema.schema as {
      properties: { items: { items: { properties: { title: { description: string }; activity: { properties: { stages: { items: { properties: { text: { description: string } } } } }; required: string[] } } } } };
    };
    const item = schema.properties.items.items.properties;
    expect(item.title.description).toContain("natural scene title");
    expect(item.activity.properties.stages.items.properties.text.description).toContain("OWN scientific question");
    expect(item.activity.required).toEqual(strategy === "cognitive conflict" ? ["version", "observedOutcome", "stages", "image"] : ["version", "stages", "image"]);
  });

  it.each(strategies)("preserves Lesson 8 energy-system meaning without forcing unfamiliar apparatus for %s", strategy => {
    const generation = buildMaterialPrompt(getLessonGenerationContext(8)!, getStrategyContext(strategy));
    expect(generation.user).toContain("stored energy being released and transferred");
    expect(generation.user).toContain("cart-launcher is an example, not a compulsory learner experience");
    expect(generation.user).toContain("Do not substitute a generic braking/sliding story that omits stored-energy release");
    expect(generation.user).not.toContain("Focus on the FULL cart-launcher system");
  });

  it("renders only the selected strategy's planned inquiry scene", () => {
    const conflict = buildMaterialImageInstructions({ strategy: "cognitive conflict", activity: conflictActivity });
    const bridge = buildMaterialImageInstructions({ strategy: "experience bridging", activity: bridgingActivity });
    expect(conflict).toContain("Change only what the stated conditions permit");
    expect(conflict).toContain("Do not add unplanned equipment");
    expect(bridge).toContain("lived experience itself");
    expect(bridge).toContain("Do not add a second experience");
    expect(bridge).not.toContain("Keep the comparison inspectable");
    expect(conflict).not.toContain("lived experience itself");
  });
});
