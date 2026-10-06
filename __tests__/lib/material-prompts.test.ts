import { describe, expect, it } from "vitest";
import { buildMaterialImageInstructions, buildMaterialPrompt, MATERIAL_INQUIRY_CHECKS, MATERIAL_REVIEW_INSTRUCTIONS, MATERIAL_VISUAL_CHECKS, summarizeDiagnosticAnswers } from "@/lib/material-prompts";
import { parseGeneratedMaterialActivity, parseMaterialActivity } from "@/lib/material-activities";
import { materialOutputFormat } from "@/lib/material-output-schema";
import { getLessonGenerationContext, getStrategyContext } from "@/lib/lesson-context";
import { buildPublishedContentState } from "@/lib/published-content";
import { analogyActivity, conflictActivity, bridgingActivity } from "../fixtures/material-activities";

describe("Analogy source-aligned text and image", () => {
  it("carries scientific regression constraints into both generation and review", () => {
    const prompt = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("analogy"));
    for (const text of [prompt.system, MATERIAL_REVIEW_INSTRUCTIONS]) {
      expect(text).toContain("a change in SHAPE");
      expect(text).toContain("do NOT spontaneously regain a ball shape");
      expect(text).toContain("no net horizontal force");
    }
    expect(prompt.user).toContain("NOT clay/playdough as the target");
    const energyPrompt = buildMaterialPrompt(getLessonGenerationContext(8)!, getStrategyContext("experience bridging"));
    expect(energyPrompt.user).toContain("energy transfer rather than inertia alone");
  });
  it("uses curriculum, explicit strategy sequence and a learner-written question", () => {
    const prompt = buildMaterialPrompt(getLessonGenerationContext(1)!, getStrategyContext("analogy"));
    expect(prompt.user).toContain("ON ITS OWN");
    expect(prompt.user).toContain("ONE mappingDepth");
    expect(prompt.user).toContain("mislead");
    expect(prompt.user).toContain("responses=0");
    expect(prompt.system).toContain("not video or slides");
    expect(prompt.system).toContain("120-240");
    expect(prompt.user).toContain("coreIdeas");
  });
  it("accepts the five-stage fixture and the optional-limits form", () => {
    expect(parseMaterialActivity(analogyActivity, "analogy")).toEqual(analogyActivity);
    const withoutLimits = { ...analogyActivity, stages: analogyActivity.stages.filter(stage => stage.id !== "limits") };
    expect(parseGeneratedMaterialActivity(withoutLimits, "analogy")).toEqual(withoutLimits);
    const published = buildPublishedContentState([{ content_item_id: "no-limits", content_json: JSON.stringify({ title: "Spring", body: "Compatibility text", strategy: "analogy", activity: withoutLimits }) }], []);
    expect(published.contentItems[0].activity?.stages.map(stage => stage.id)).toEqual(["target", "analogue", "mapping", "question"]);
    expect(published.contentItems[0].activity?.image).toEqual(withoutLimits.image);
  });
  it("gives analogy learners a target, visible comparison foothold and unfinished reasoning task in generation and review", () => {
    const prompt = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("analogy"));
    for (const text of [prompt.user, MATERIAL_REVIEW_INSTRUCTIONS]) {
      expect(text).toContain("target concept and the purpose of investigating it visible in the FIRST student stage");
      expect(text).toContain("name the exact target feature and analogue feature to compare");
      expect(text).toContain("Connect one concrete learner action to one tentative inference");
      expect(text).toContain("do not leave essential guidance only there");
      expect(text).toContain("do not supply the completed response");
      expect(text).toContain("same unresolved target");
      expect(text).toContain("Any changed-condition question must say it is imagined");
    }
  });
  it("does not reintroduce mandatory or confusing limits through lesson-specific instructions or review", () => {
    const prompts = Array.from({ length: 8 }, (_, index) => buildMaterialPrompt(getLessonGenerationContext(index + 1)!, getStrategyContext("analogy")));
    for (const text of [...prompts.map(prompt => `${prompt.system}\n${prompt.user}`), MATERIAL_REVIEW_INSTRUCTIONS]) {
      expect(text).toContain("omit or rewrite it if it introduces jargon");
      expect(text).toContain("a disclaimer cannot fix it");
      expect(text).not.toContain("with explicit limits");
      expect(text).not.toContain("Omit only if no consequential overextension is likely");
      expect(text).not.toContain("a relevant boundary are enough");
      expect(text).not.toContain("its correspondence and useful limit are clear");
    }
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("Preserve a clear four-stage draft without inserting limits");
  });
  it("scopes the new target and mapping scaffold to analogy without changing the other strategies' sequence", () => {
    for (const strategy of ["cognitive conflict", "experience bridging"]) {
      const prompt = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext(strategy));
      expect(prompt.user).not.toContain("ANALOGY STUDENT FOLLOWABILITY");
    }
    const conflict = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("cognitive conflict"));
    const bridge = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("experience bridging"));
    expect(conflict.user).toContain("BEFORE seeing evidence");
    expect(bridge.user).toContain("Only AFTER observation");
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("ANALOGY STUDENT FOLLOWABILITY (apply only to analogy)");
  });
  it("rejects wrong order, missing question, early image, or invalid mapping depth", () => {
    for (const activity of [
      { ...analogyActivity, stages: [...analogyActivity.stages].reverse() },
      { ...analogyActivity, stages: analogyActivity.stages.slice(0, -1) },
      { ...analogyActivity, image: { ...analogyActivity.image, revealAt: 0 } },
      { ...analogyActivity, mappingDepth: "looks alike" },
      { ...analogyActivity, stages: analogyActivity.stages.map(stage => ({ ...stage, text: " " })) },
    ]) expect(parseMaterialActivity(activity, "analogy")).toBeUndefined();
  });
  it("passes the actual image scene, not just the strategy label, into image instructions", () => {
    expect(buildMaterialImageInstructions({ strategy: "analogy", activity: analogyActivity })).toContain(analogyActivity.image.panels![0].description);
    expect(buildMaterialImageInstructions({ strategy: "analogy" })).toBe("");
  });
  it("preserves structured stages and media through publication parsing", () => {
    const result = buildPublishedContentState([{ content_item_id: "a1", content_json: JSON.stringify({ title: "Spring", body: "compatibility text", strategy: "analogy", activity: analogyActivity, media: { image: "https://example.org/image.webp" } }) }], []);
    expect(result.contentItems[0].activity).toEqual(analogyActivity);
    expect(result.mediaByItemId.a1.image).toBe("https://example.org/image.webp");
  });
  it("handles malformed model/persisted values without throwing", () => {
    for (const value of [null, [], "a", 1, {}, { version: 1, stages: [null] }]) expect(parseMaterialActivity(value, "analogy")).toBeUndefined();
  });
  it("aggregates diagnostic selections without student identity", () => {
    const summary = summarizeDiagnosticAnswers(1, [{}, {}]);
    expect(summary).toEqual({ responses: 2, selections: [] });
  });
});

describe("bounded image plans and structural mappings", () => {
  it("uses only the panel plan, ignoring conflicting freeform summary instructions", () => {
    const activity = { ...bridgingActivity, image: { ...bridgingActivity.image, scene: "Draw six extra before-and-after panels" } };
    const prompt = buildMaterialImageInstructions({ strategy: "experience bridging", activity });
    expect(prompt).toContain("Exactly 1 panel");
    expect(prompt).not.toContain("six extra");
  });
  it("requires a plan for new generations but still reads older saved activities", () => {
    const legacy = { ...analogyActivity, analogyMapping: undefined, image: { revealAt: 2, scene: "Legacy comparison." } };
    expect(parseMaterialActivity(legacy, "analogy")).toBeDefined();
    expect(parseGeneratedMaterialActivity(legacy, "analogy")).toBeUndefined();
    expect(buildMaterialImageInstructions({ strategy: "analogy", activity: legacy })).toContain("Legacy comparison.");
    expect(parseGeneratedMaterialActivity(analogyActivity, "analogy")).toBeDefined();
  });
  it("constrains generated captions to the same limit as stored activity parsing", () => {
    expect(materialOutputFormat("analogy").json_schema.schema).toHaveProperty("properties.items.items.properties.activity.properties.image.properties.panels.items.properties.caption.maxLength", 100);
    const withCaption = (caption: string) => ({ ...analogyActivity, image: { ...analogyActivity.image, panels: analogyActivity.image.panels!.map(panel => ({ ...panel, caption })) } });
    expect(parseGeneratedMaterialActivity(withCaption("a".repeat(100)), "analogy")).toBeDefined();
    expect(parseGeneratedMaterialActivity(withCaption("a".repeat(101)), "analogy")).toBeUndefined();
  });
  it("rejects invalid counts, missing alt text and missing correspondence fields", () => {
    for (const [strategy, original, panels] of [
      ["analogy", analogyActivity, analogyActivity.image.panels!.slice(0, 1)],
      ["experience bridging", bridgingActivity, conflictActivity.image.panels!],
      ["cognitive conflict", conflictActivity, []],
      ["analogy", analogyActivity, analogyActivity.image.panels!.map(panel => ({ ...panel, alt: "" }))],
    ] as const) expect(parseMaterialActivity({ ...original, image: { ...original.image, panels } }, strategy)).toBeUndefined();
    expect(parseGeneratedMaterialActivity({ ...analogyActivity, analogyMapping: undefined }, "analogy")).toBeUndefined();
    expect(parseMaterialActivity({ ...analogyActivity, analogyMapping: { ...analogyActivity.analogyMapping, correspondences: [{ targetPart: "spring" }] } }, "analogy")).toBeUndefined();
  });
  it("requires panel plans in the provider schema for all three strategies", () => {
    for (const strategy of ["analogy", "cognitive conflict", "experience bridging"]) {
      const schema = JSON.stringify(materialOutputFormat(strategy));
      expect(schema).toContain('"required":["scene","panels","revealAt"]');
      expect(schema).toContain('"required":["description","caption","alt"]');
    }
    expect(JSON.stringify(materialOutputFormat("analogy"))).toContain("analogyMapping");
  });
  it("preserves the defining source methods in generation and review", () => {
    const analogy = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("analogy"));
    expect(analogy.user).toContain("Present target and analogue separately before showing them together");
    expect(analogy.user).toContain("meaningful shared relationship");
    const bridge = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("experience bridging"));
    expect(bridge.user).toContain("select ONE inspectable moment");
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("first TWO stage texts");
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("setup and conditions ONLY");
  });
  it("accepts a single useful correspondence without requiring elaborate mechanisms", () => {
    const activity = { ...analogyActivity, analogyMapping: { ...analogyActivity.analogyMapping!, correspondences: analogyActivity.analogyMapping!.correspondences.slice(0, 1) } };
    expect(parseGeneratedMaterialActivity(activity, "analogy")).toBeDefined();
    const prompt = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("analogy"));
    expect(prompt.user).toContain("A ball and a sponge CAN be useful");
    expect(prompt.user).not.toContain("Paper may need reopening by hand");
    expect(prompt.user).toContain("One clear correspondence is enough");
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("Preserve an adequate draft");
  });
  it("keeps visible changes and scene consistency in generation, correction and rendering", () => {
    for (const [strategy, activity] of [["analogy", analogyActivity], ["cognitive conflict", conflictActivity], ["experience bridging", bridgingActivity]] as const) {
      const prompt = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext(strategy));
      expect(prompt.user).toContain(MATERIAL_VISUAL_CHECKS);
      expect(buildMaterialImageInstructions({ strategy, activity })).toContain(MATERIAL_VISUAL_CHECKS);
    }
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain(MATERIAL_VISUAL_CHECKS);
    expect(MATERIAL_VISUAL_CHECKS).toContain("not two near-circles");
    expect(MATERIAL_VISUAL_CHECKS).toContain("front top edge visibly dips at the pressed center");
    expect(MATERIAL_VISUAL_CHECKS).toContain("A hand pressing a ball is not a ball falling onto the floor");
    expect(MATERIAL_VISUAL_CHECKS).toContain("Name sustained pressure as pressing or compression, not a collision");
    expect(MATERIAL_VISUAL_CHECKS).toContain("a frozen view of that collision is still valid");
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("Do not repeat the whole scenario");
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("Keep analogy limits fair");
  });
  it("does not substitute unsupported material rankings or unshown outcomes for evidence", () => {
    const prompt = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("cognitive conflict"));
    for (const text of [prompt.system, MATERIAL_REVIEW_INSTRUCTIONS]) {
      expect(text).toContain("Do not rank a generic rubber ball and sponge by recovery speed");
      expect(text).toContain("Do not invent a contrast in which a generic sponge needs help");
    }
    expect(prompt.user).toContain("include a third after-release panel");
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("Before/during panels cannot establish recovery after release");
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("prediction, discrepant, compare and observedOutcome");
  });
});

describe("Experience Bridging source requirements", () => {
  it("names the concept after observation and distinguishes experience from analogy", () => {
    const prompt = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("experience bridging"));
    expect(prompt.user).toContain("EXPERIENCE ITSELF IS THE PHENOMENON");
    expect(prompt.user).toContain("accessible alternative");
    expect(prompt.user).toContain("Only AFTER observation");
    expect(prompt.user).toContain("SAME scientific concept");
  });
  it("accepts an optional connection stage, but not naming the concept before observation", () => {
    expect(parseMaterialActivity(bridgingActivity, "experience bridging")).toEqual(bridgingActivity);
    expect(parseMaterialActivity({ ...bridgingActivity, stages: bridgingActivity.stages.filter(stage => stage.id !== "connect") }, "experience bridging")).toBeDefined();
    const stages = [...bridgingActivity.stages];
    [stages[1], stages[2]] = [stages[2], stages[1]];
    expect(parseMaterialActivity({ ...bridgingActivity, stages }, "experience bridging")).toBeUndefined();
  });
  it("uses the revised early-field naming and same-domain contracts in generation and correction", () => {
    const prompt = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("experience bridging"));
    for (const text of [prompt.user, MATERIAL_REVIEW_INSTRUCTIONS]) {
      expect(text).toContain("Name the target scientific concept ONLY in stage 3");
      expect(text).toContain("early image captions/alt");
      expect(text).toContain("same conceptual domain");
    }
    expect(prompt.user).toContain("No learner experience or survey context supplied");
  });
});

describe("Cognitive Conflict source requirements", () => {
  it("keeps hypothetical data distinct from a static illustration on restore and publication", () => {
    const outcome = "The hypothetical positions increase by 0.30 meters each second; these are model values, not measurements.";
    const input = { ...conflictActivity, observedOutcome: outcome };
    const original = JSON.stringify(input);
    const parsed = parseMaterialActivity(input, "cognitive conflict")!;
    const compare = parsed.stages.find(stage => stage.id === "compare")!.text;
    expect(compare).toContain("What we observed in the activity:");
    expect(compare).toContain("How did what we observed match or differ from your recorded prediction?");
    expect(compare).toContain(outcome);
    expect(compare).not.toContain("observed in the illustration");
    expect(compare).toContain("your recorded prediction");
    expect(parseMaterialActivity(parsed, "cognitive conflict")).toEqual(parsed);
    expect(JSON.stringify(input)).toBe(original);
    const published = buildPublishedContentState([{ content_item_id: "data-example", content_json: JSON.stringify({ title: "Cart", body: "", strategy: "cognitive conflict", activity: input }) }], []);
    expect(published.contentItems[0].activity?.stages.find(stage => stage.id === "compare")?.text).toBe(compare);
  });
  it("requires the five stages in order and withholds the result image", () => {
    expect(parseMaterialActivity(conflictActivity, "cognitive conflict")).toEqual(conflictActivity);
    expect(parseMaterialActivity({ ...conflictActivity, image: { ...conflictActivity.image, revealAt: 1 } }, "cognitive conflict")).toBeUndefined();
    const prompt = buildMaterialPrompt(getLessonGenerationContext(3)!, getStrategyContext("cognitive conflict"));
    expect(prompt.user).toContain("BEFORE seeing evidence");
    expect(prompt.user).toContain("SAME likely prediction");
    expect(prompt.user).toContain("Do not supply the causal explanation");
    expect(prompt.user).toContain("hypothetical numerical data");
  });
  it("aggregates actual wrong selections into likely thinking without sending identities", () => {
    const summary = summarizeDiagnosticAnswers(1, [{ L1_Q1: "D" }, { L1_Q1: "D" }, { L1_Q1: "C" }]);
    expect(summary.responses).toBe(3);
    expect(summary.selections.find(item => item.selected.includes("weak"))?.count).toBe(2);
    expect(summary.selections.find(item => item.count === 2)?.misconception).toContain("weak");
    expect(Object.keys(summary.selections[0]).sort()).toEqual(["count", "misconception", "question", "selected"]);
  });
});

describe("September template quality review", () => {
  it("shares practical inquiry requirements across generation and review without adding schema gates", () => {
    for (const strategy of ["analogy", "cognitive conflict", "experience bridging"]) {
      const prompt = buildMaterialPrompt(getLessonGenerationContext(8)!, getStrategyContext(strategy));
      expect(prompt.user).toContain(MATERIAL_INQUIRY_CHECKS);
    }
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain(MATERIAL_INQUIRY_CHECKS);
    expect(MATERIAL_INQUIRY_CHECKS).toContain("identify, compare or use a correspondence");
    expect(MATERIAL_INQUIRY_CHECKS).toContain("what the comparison cannot establish");
    expect(MATERIAL_INQUIRY_CHECKS).toContain("do not unexpectedly require");
    expect(MATERIAL_INQUIRY_CHECKS).toContain("before it is available");
    expect(MATERIAL_INQUIRY_CHECKS).toContain("tray/counter captions must not mention a launch");
    expect(MATERIAL_REVIEW_INSTRUCTIONS).toContain("A during/after pair already shows recovery");
  });
  it("requires persistent equipment and inspectable contact details in rendering as well as review", () => {
    const prompt = buildMaterialImageInstructions({ strategy: "cognitive conflict", activity: conflictActivity });
    for (const text of [prompt, MATERIAL_REVIEW_INSTRUCTIONS]) {
      expect(text).toContain("keep its visible coil attached to the same fixed support");
      expect(text).toContain("Do not replace the coil with a short peg");
      expect(text).toContain("keep the changed outline visible around the fingers");
    }
  });
});
