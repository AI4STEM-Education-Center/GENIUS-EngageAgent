import { describe, expect, it } from "vitest";
import { ANALOGY_PLAN_FIELDS, analogyPlanErrors, analogyPlanSchema, type AnalogyPlan } from "@/lib/slides/analogy";
import { draftErrors, parseDraft, STRATEGIES } from "@/lib/slides/model";
import { hasTeacherDecision, textCheckKey } from "@/lib/slides/quality";
import { parseTextFindings, reviewFields, textReviewFormat } from "@/lib/slides/review";
import { deckFixture, slideFixture } from "../fixtures/slides";

import { analogyPlanFixture as planFixture } from "../fixtures/analogy";

describe("analogy plan contract", () => {
  it("keeps the strict schema and runtime fields aligned", () => {
    expect(analogyPlanErrors(planFixture())).toEqual([]);
    expect(analogyPlanSchema.additionalProperties).toBe(false);
    expect(analogyPlanSchema.required).toEqual(ANALOGY_PLAN_FIELDS);
    expect(Object.keys(planFixture())).toEqual(ANALOGY_PLAN_FIELDS);
    expect(parseDraft({ ...slideFixture("analogy"), analogyPlan: planFixture() }, "analogy").analogyPlan).toEqual(planFixture());
  });

  it.each(STRATEGIES)("keeps legacy %s drafts readable without a plan", strategy => {
    const draft = slideFixture(strategy);
    delete draft.analogyPlan;
    expect(parseDraft(draft, strategy)).toBe(draft);
  });

  it.each(["cognitive conflict", "experience bridging"] as const)("rejects an analogy plan on %s", strategy => {
    expect(draftErrors({ ...slideFixture(strategy), analogyPlan: planFixture() }, strategy)).toContain("Deck.analogyPlan: only the analogy strategy can have an analogy plan.");
  });

  it.each([null, undefined, [], "plan", 3])("rejects an explicitly present malformed plan: %s", value => {
    expect(draftErrors({ ...slideFixture("analogy"), analogyPlan: value }, "analogy")).toContain("Analogy plan: expected an object.");
  });

  it.each(ANALOGY_PLAN_FIELDS)("requires %s when a plan is present", field => {
    const value: Partial<AnalogyPlan> = planFixture();
    delete value[field];
    expect(analogyPlanErrors(value).some(error => error.startsWith(`Analogy plan.${field}:`))).toBe(true);
  });

  it("rejects extra fields, unsupported enums and control characters", () => {
    expect(analogyPlanErrors({ ...planFixture(), answer: "student answer" })).toContain("Analogy plan: unexpected field.");
    expect(analogyPlanErrors({ ...planFixture(), depth: "all", boundaryDecision: "always" })).toHaveLength(2);
    expect(analogyPlanErrors({ ...planFixture(), sharedRelation: "hidden\u0000text" })).toHaveLength(1);
    expect(analogyPlanErrors({ ...planFixture(), sharedRelation: "   " })).toHaveLength(1);
  });

  it.each([
    ["sharedRelation", 400],
    ["mappingHint", 140],
    ["responseStarter", 100],
  ] as const)("enforces the %s character budget on generated and editable drafts", (field, max) => {
    const plan = { ...planFixture(), [field]: "x".repeat(max) };
    expect(analogyPlanErrors(plan)).toEqual([]);
    plan[field] += "x";
    for (const editable of [false, true]) {
      expect(draftErrors({ ...slideFixture("analogy"), analogyPlan: plan }, "analogy", editable)).toContain(`Analogy plan.${field}: enter 1-${max} characters of plain text.`);
    }
  });

  it.each([["mappingHint", 20], ["responseStarter", 12]] as const)("enforces the %s word budget", (field, max) => {
    expect(analogyPlanErrors({ ...planFixture(), [field]: Array(max).fill("a").join(" ") })).toEqual([]);
    expect(analogyPlanErrors({ ...planFixture(), [field]: Array(max + 1).fill("a").join(" ") })).toContain(`Analogy plan.${field}: use at most ${max} words.`);
  });

  it("accepts either an omitted or justified included boundary", () => {
    expect(analogyPlanErrors(planFixture())).toEqual([]);
    expect(analogyPlanErrors({ ...planFixture(), boundaryDecision: "include", boundaryReason: "Clarify a consequential boundary in this comparison." })).toEqual([]);
  });
});

describe("analogy plan review", () => {
  it("grounds repair findings in stable private or student-facing plan fields", () => {
    const draft = { ...slideFixture("analogy"), analogyPlan: planFixture() };
    const fields = reviewFields(draft);
    const planFields = fields.filter(field => field.id.startsWith("analogy-plan-"));
    expect(planFields).toHaveLength(ANALOGY_PLAN_FIELDS.length);
    expect(new Set(fields.map(field => field.id)).size).toBe(fields.length);
    expect(planFields.filter(field => field.label.includes("student-facing")).map(field => field.id)).toEqual(["analogy-plan-mappingHint", "analogy-plan-responseStarter"]);
    expect(JSON.stringify(textReviewFormat(draft))).toContain("analogy-plan-predictionSupport");
    for (const field of planFields) {
      const finding = { field: field.id, quote: field.text.slice(0, 100), problem: "The requested inference has no supplied support.", correction: "Connect the task to the stated shared relationship." };
      expect(parseTextFindings([finding], draft)).toEqual([`${field.label}: ${finding.problem} ${finding.correction}`]);
      expect(() => parseTextFindings([{ ...finding, quote: "A statement absent from this plan." }], draft)).toThrow("not grounded");
    }
    expect(() => parseTextFindings([{ field: "analogy-plan-mappingHint", quote: draft.analogyPlan.predictionSupport, problem: "Private notes are absent from the student slide.", correction: "Provide one visible foothold." }], draft)).toThrow("not grounded");
  });

  it("invalidates prior text review and teacher acceptance after a plan edit", () => {
    const deck = deckFixture("analogy");
    deck.draft.analogyPlan = planFixture();
    const originalKey = textCheckKey(deck);
    deck.checks = { text: { key: originalKey, issues: [] }, images: {} };
    deck.teacherDecision = { reason: "Reviewed the comparison and its student foothold.", draftKey: originalKey, checks: deck.checks, assets: deck.assets };
    expect(hasTeacherDecision(deck)).toBe(true);
    for (const field of ["predictionSupport", "mappingHint", "responseStarter"] as const) {
      const changed = { ...deck, draft: { ...deck.draft, analogyPlan: { ...deck.draft.analogyPlan, [field]: `${deck.draft.analogyPlan[field]} revised` } } };
      expect(textCheckKey(changed)).not.toBe(originalKey);
      expect(hasTeacherDecision(changed)).toBe(false);
    }
  });
});
