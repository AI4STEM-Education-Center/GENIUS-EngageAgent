/** Teaching choices travel with a material, independently of its delivery class. */
export type MaterialTeachingContext = { gradeBand?: string; experienceContext?: string; quizPattern?: string };
export const GRADE_BANDS = ["Elementary school", "Middle school", "High school", "Higher education"] as const;
export const QUIZ_BANDS = ["Under 55% correct", "55–70% correct", "Over 70% correct"] as const;

export function quizBand(correct: number, responses: number): string {
  if (!Number.isFinite(correct) || !Number.isFinite(responses) || responses <= 0 || correct < 0 || correct > responses) return "";
  const percent = Math.round(correct / responses * 100);
  return percent < 55 ? QUIZ_BANDS[0] : percent <= 70 ? QUIZ_BANDS[1] : QUIZ_BANDS[2];
}

export function parseTeachingContext(value: unknown): MaterialTeachingContext | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose valid teaching settings.");
  const input = value as Record<string, unknown>;
  const result: MaterialTeachingContext = {};
  for (const [key, limit] of [["gradeBand", 80], ["experienceContext", 200], ["quizPattern", 200]] as const) {
    const text = input[key];
    if (text === undefined) continue;
    if (typeof text !== "string" || text.length > limit || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error(`Invalid ${key}.`);
    if (text.trim()) result[key] = text.trim();
  }
  if (Object.keys(input).some(key => !["gradeBand", "experienceContext", "quizPattern"].includes(key))) throw new Error("Unexpected teaching setting.");
  return result;
}

export function materialGenerationContext(context: string, settings?: MaterialTeachingContext): string {
  return [context.trim(), settings?.gradeBand && `Grade band: ${settings.gradeBand}.`,
    settings?.experienceContext && `Teacher-selected familiar experience: ${settings.experienceContext}. Use this experience where it supports the selected concept; do not invent student participation or survey results.`]
    .filter(Boolean).join("\n\n");
}

export type MaterialAdaptation = { requestId: string; classroomContext: string; teachingContext: MaterialTeachingContext };
