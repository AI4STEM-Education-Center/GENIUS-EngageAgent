import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import type { SlideDraft } from "./model";
import { analogyPlanFields, analogyStudentFields } from "./analogy";
import { analogyMappingIndex } from "./analogy-methods";

export function reviewFields(draft: SlideDraft) {
  return [
    ...(draft.slides[0]?.stage === "experience" ? [{ id: "deck-title", label: "Deck title", text: draft.title }] : []),
    ...(draft.analogyPlan ? analogyPlanFields(draft.analogyMethod).map(field => ({
      id: `analogy-plan-${field}`,
      label: `Analogy plan.${field} (${analogyStudentFields(draft.analogyMethod).some(studentField => studentField === field) ? `student-facing step ${analogyMappingIndex(draft.analogyMethod) + 1}` : "private planning"})`,
      text: draft.analogyPlan![field] ?? "",
    })) : []),
    ...draft.slides.flatMap((slide, i) => [
      ...(["title", "body", "task"] as const).map(field => ({ id: `slide-${i + 1}-${field}`, label: `Slide ${i + 1}.${field}`, text: slide[field] })),
      ...slide.teacherNotes.map((text, n) => ({ id: `slide-${i + 1}-note-${n + 1}`, label: `Slide ${i + 1}.teacherNotes ${n + 1}`, text })),
    ]),
    ...draft.visuals.flatMap(visual => (["prompt", "caption", "alt"] as const).map(field => ({ id: `image-${visual.id}-${field}`, label: `Image ${visual.id}.${field}`, text: visual[field] }))),
  ];
}

export function textReviewFormat(draft: SlideDraft): ResponseFormatJSONSchema {
  const inquiryStrategy = draft.slides[1]?.stage === "prediction" || draft.slides[0]?.stage === "experience";
  const string = (maxLength: number) => ({ type: "string", minLength: 1, maxLength, pattern: "\\S" });
  return { type: "json_schema", json_schema: { name: "slide_content_findings", strict: true, schema: {
    type: "object", additionalProperties: false, required: ["issues"], properties: {
      issues: { type: "array", maxItems: 5, items: {
        type: "object", additionalProperties: false, required: ["field", "quote", "problem", "correction"], properties: {
          field: { type: "string", enum: reviewFields(draft).map(field => field.id) },
          quote: { ...string(180), description: `Exact contiguous excerpt from this field, copied verbatim. Never quote metadata, another field or invented text.${inquiryStrategy ? " Choose a SHORT excerpt of at most 80 characters, ending at a word boundary. Do not truncate a longer quotation, add ellipses or insert soft hyphens/invisible characters; select a shorter exact span instead." : ""}` },
          problem: { ...string(240), description: `Definite scientific or selected-method problem, not optional polish or a layout instruction.${inquiryStrategy ? " Use one concise COMPLETE sentence, aiming for at most 180 characters. Rewrite shorter rather than cut off a sentence." : ""}` },
          correction: { ...string(240), description: `Smallest useful content correction in this field, preserving the chosen method.${inquiryStrategy ? " Use one concise COMPLETE sentence, aiming for at most 180 characters. Rewrite shorter rather than cut off a sentence." : ""}` },
        },
      } },
    },
  } } };
}

export function parseTextFindings(value: unknown, draft: SlideDraft): string[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error("Invalid content findings.");
  const fields = new Map(reviewFields(draft).map(field => [field.id, field]));
  return value.map(issue => {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) throw new Error("Invalid content finding.");
    const finding = issue as Record<string, unknown>;
    if (Object.keys(finding).sort().join(",") !== "correction,field,problem,quote") throw new Error("Invalid content finding fields.");
    const field = typeof finding.field === "string" ? fields.get(finding.field) : undefined;
    if (!field || typeof finding.quote !== "string" || !finding.quote.trim() || finding.quote.length > 180 || !field.text.includes(finding.quote)) throw new Error("Finding is not grounded in an editable field.");
    for (const key of ["problem", "correction"] as const) if (typeof finding[key] !== "string" || !(finding[key] as string).trim() || (finding[key] as string).length > 240) throw new Error("Invalid finding explanation.");
    return `${field.label}: ${finding.problem} ${finding.correction}`;
  });
}
