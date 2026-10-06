import { analogyMappingIndex, resolveAnalogyMethod, type AnalogyMethod } from "./analogy-methods";

export type AnalogyPlan = {
  targetPhenomenon?: string;
  authenticityRationale?: string;
  discussionGoal?: string;
  targetDifficulty: string;
  familiarExperience: string;
  depth: "entities" | "configurations" | "mechanisms";
  sharedRelation: string;
  providedMapping: string;
  openMapping: string;
  changedInput?: string;
  fixedConditions?: string;
  predictionFocus?: string;
  predictionSupport?: string;
  applicationMode?: "explain" | "predict";
  applicationSupport?: string;
  boundaryDecision: "omit" | "include";
  boundaryReason: string;
  mappingHint: string;
  responseStarter: string;
};

const privateText = (description: string, maxLength = 400) => ({
  type: "string", minLength: 1, maxLength, pattern: "\\S", description: `PRIVATE planning only. ${description}`,
});

// These fields describe one useful relationship, not a complete explanation.
// Legacy methods display mappingHint and responseStarter; six-step displays
// only the optional incomplete responseStarter (see analogyStudentFields).
export const analogyPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["targetDifficulty", "familiarExperience", "depth", "sharedRelation", "providedMapping", "openMapping", "changedInput", "fixedConditions", "predictionFocus", "predictionSupport", "boundaryDecision", "boundaryReason", "mappingHint", "responseStarter"],
  properties: {
    targetDifficulty: privateText("Name the specific target relationship that is hidden, unfamiliar or hard to picture for these learners."),
    familiarExperience: privateText("Identify a familiar experience and the accurate behavior learners can use; choose it for this target and classroom context."),
    depth: { type: "string", enum: ["entities", "configurations", "mechanisms"], description: "PRIVATE planning only. Choose one depth for the useful correspondence." },
    sharedRelation: privateText("State the single scientifically defensible relationship shared by the familiar and target systems."),
    providedMapping: privateText("Identify the real correspondence supplied as a student foothold; do not leave every connection for novices to invent."),
    openMapping: privateText("Identify the useful correspondence or extension that remains for students to infer after the foothold."),
    changedInput: privateText("Name the one target input changed between the two visible starting conditions."),
    fixedConditions: privateText("Name the relevant target conditions held fixed so the comparison is interpretable."),
    predictionFocus: privateText("Name the same observable outcome learners compare for both target starting conditions."),
    predictionSupport: privateText("Explain how the chosen shared relationship and student-visible information support that prediction without an unsupported inferential jump."),
    boundaryDecision: { type: "string", enum: ["omit", "include"], description: "PRIVATE planning only. Include a student boundary only when it is simple, consequential and reduces misunderstanding; otherwise omit it." },
    boundaryReason: privateText("Explain why the boundary is omitted, or the specific misunderstanding that a short included boundary prevents."),
    mappingHint: { type: "string", minLength: 1, maxLength: 140, pattern: "\\S", description: "STUDENT-FACING step 2 foothold, at most 20 words. Supply one real, concrete correspondence consistent with providedMapping, leaving openMapping for the learner." },
    responseStarter: { type: "string", minLength: 1, maxLength: 100, pattern: "\\S", description: "STUDENT-FACING step 2 incomplete response starter, at most 12 words. Support the remaining mapping task without supplying its answer." },
  },
};

export const ANALOGY_PLAN_FIELDS = Object.keys(analogyPlanSchema.properties) as (keyof AnalogyPlan)[];
export const ANALOGY_STUDENT_FIELDS = ["mappingHint", "responseStarter"] as const;
export const SIX_STEP_CONTEXT_FIELDS = ["targetPhenomenon", "authenticityRationale", "discussionGoal"] as const;
export function analogyStudentFields(method?: AnalogyMethod): readonly (typeof ANALOGY_STUDENT_FIELDS[number])[] {
  return resolveAnalogyMethod(method) === "six-step" ? ["responseStarter"] : ANALOGY_STUDENT_FIELDS;
}
const PREDICTION_FIELDS: readonly (keyof AnalogyPlan)[] = ["changedInput", "fixedConditions", "predictionFocus", "predictionSupport"];
const ALL_PLAN_RULES = { ...analogyPlanSchema.properties,
  targetPhenomenon: privateText("Identify one authentic real-world event closely aligned with the specific lesson relationship; name its setting and observable action. It need not be personally familiar to students. Keep this same event across the story."),
  authenticityRationale: privateText("In at most 600 characters, explain the real-world basis, exact lesson relationship and minimal background learners need to understand this event. Use one short clause for each. Personal experience is not required; everyday objects alone do not establish authenticity or lesson fit.", 600),
  discussionGoal: privateText("Name the relationship students should explore through teacher-led questions, without printing its answer on the slide."),
  applicationMode: { type: "string", enum: ["explain", "predict"], description: "PRIVATE planning only. Choose whether step 5 uses the established mapping for a tentative explanation or a supported prediction." },
  applicationSupport: privateText("Explain how the selected shared relation and student-visible facts support the step 5 response without an unstated law, new apparatus or completed scientific explanation. Keep this within the SAME target event."),
};

export function analogyPlanFields(method?: AnalogyMethod): (keyof AnalogyPlan)[] {
  if (resolveAnalogyMethod(method) === "predict-transfer") return [...ANALOGY_PLAN_FIELDS];
  const common = ANALOGY_PLAN_FIELDS.filter(field => !PREDICTION_FIELDS.includes(field));
  return resolveAnalogyMethod(method) === "six-step" ? [...SIX_STEP_CONTEXT_FIELDS, ...common, "applicationMode", "applicationSupport"] : common;
}

export function analogyPlanSchemaFor(method?: AnalogyMethod) {
  const fields = analogyPlanFields(method);
  const page = analogyMappingIndex(method) + 1;
  return { ...analogyPlanSchema, required: fields, properties: Object.fromEntries(fields.map(field => {
    const rule = ALL_PLAN_RULES[field];
    if (resolveAnalogyMethod(method) === "six-step" && field === "mappingHint") return [field, { type: "string", enum: [""], description: "Compatibility field: return an empty string. Six-step mapping is teacher-led; supplied correspondences belong in PRIVATE providedMapping and teacherNotes, never on the student canvas." }];
    if (resolveAnalogyMethod(method) === "six-step" && field === "responseStarter") return [field, { type: "string", maxLength: 100, description: "Optional STUDENT-FACING step 4 incomplete response starter, at most 12 words. Return empty when the question suffices. No supplied correspondence or scientific explanation." }];
    const sixStepDescriptions: Partial<Record<keyof AnalogyPlan, string>> = {
      providedMapping: "PRIVATE planning only. A possible scientifically defensible correspondence for the teacher to listen for and guide through follow-up questions. It is NOT a supplied student hint. Include practical facilitation in page 4 teacherNotes.",
      openMapping: "PRIVATE planning only. Identify the useful relation students will discuss on page 4. Keep ALL proposed correspondences and explanations out of its title, body, captions and responseStarter, including paraphrases. Needed prerequisites may be introduced verbally in teacherNotes.",
      applicationSupport: "PRIVATE planning only. Explain how the chosen shared relation, accessible scene information and planned teacher-led discussion support step 5 without an unstated law or new apparatus. Put any necessary prerequisite and follow-up in teacherNotes. Stay within the SAME target event.",
      boundaryDecision: "PRIVATE planning only. Default to omit. Include only when a specific wording, visual feature or inference in THIS mapping makes a consequential overextension likely. Physical objects or the general existence of analogy limits are insufficient.",
      boundaryReason: "PRIVATE planning only. For include, identify the exact task-specific trigger and consequential misunderstanding it makes likely; otherwise explain omission. A narrow source/receiver counter mapping alone does not justify a tiny-material-objects warning. A private teacher follow-up may be enough.",
    };
    const description = resolveAnalogyMethod(method) === "six-step" ? sixStepDescriptions[field] : undefined;
    return [field, description ? { ...rule, description } : field === "mappingHint" || field === "responseStarter" ? { ...rule, description: rule.description.replace("step 2", `step ${page}`) } : rule];
  })) };
}

export function analogyPlanErrors(value: unknown, method?: AnalogyMethod): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Analogy plan: expected an object."];
  const plan = value as Record<string, unknown>;
  const errors: string[] = [];
  const fields = analogyPlanFields(method);
  const sixStep = resolveAnalogyMethod(method) === "six-step";
  if (Object.keys(plan).some(field => !fields.includes(field as keyof AnalogyPlan))) errors.push("Analogy plan: unexpected field.");
  for (const field of fields) {
    const rule = ALL_PLAN_RULES[field];
    const text = plan[field];
    const path = `Analogy plan.${field}`;
    // Saved v5 decks remain editable; new generation requires these fields in its schema.
    if (sixStep && text === undefined && SIX_STEP_CONTEXT_FIELDS.some(key => key === field)) continue;
    if (sixStep && text === "" && (field === "mappingHint" || field === "responseStarter")) continue;
    if ("enum" in rule) {
      if (typeof text !== "string" || !rule.enum.includes(text)) errors.push(`${path}: expected ${rule.enum.join(" or ")}.`);
      continue;
    }
    if (typeof text !== "string" || !text.trim() || text.length > rule.maxLength || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(text)) {
      errors.push(`${path}: enter 1-${rule.maxLength} characters of plain text.`);
      continue;
    }
    const maxWords = field === "mappingHint" ? 20 : field === "responseStarter" ? 12 : undefined;
    if (maxWords && text.trim().split(/\s+/u).length > maxWords) errors.push(`${path}: use at most ${maxWords} words.`);
  }
  return errors;
}
