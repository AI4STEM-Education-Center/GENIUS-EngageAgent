import { refreshClassInformation } from "./classroom-context";
/** Teaching choices travel with a material, independently of its delivery class. */
export type MaterialTeachingContext = { gradeBand?: string; experienceContext?: string; quizPattern?: string; contextRef?: string; experienceId?: string; experienceSource?: "reported" | "ai_suggested" | "teacher_entered" };
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
  for (const [key, limit] of [["gradeBand", 80], ["experienceContext", 200], ["quizPattern", 200], ["contextRef", 64], ["experienceId", 160]] as const) {
    const text = input[key];
    if (text === undefined) continue;
    if (key === "contextRef" && (typeof text !== "string" || (text.trim() && !/^[a-f0-9]{64}$/u.test(text)))) throw new Error(`Invalid class information version. ${refreshClassInformation}`);
    if (typeof text !== "string" || text.length > limit || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error(`Invalid ${key}.`);
    if (text.trim()) result[key] = text.trim();
  }
  if (input.experienceSource !== undefined) {
    if (!["reported", "ai_suggested", "teacher_entered"].includes(String(input.experienceSource))) throw new Error("Invalid experience source.");
    result.experienceSource = input.experienceSource as MaterialTeachingContext["experienceSource"];
  }
  if (Object.keys(input).some(key => !["gradeBand", "experienceContext", "quizPattern", "contextRef", "experienceId", "experienceSource"].includes(key))) throw new Error("Unexpected teaching setting.");
  return result;
}

export function materialGenerationContext(context: string, settings?: MaterialTeachingContext): string {
  return [context.trim(), settings?.gradeBand && `Grade band: ${settings.gradeBand}.`,
    settings?.experienceContext && `Teacher-selected familiar experience: ${settings.experienceContext}. Use this experience where it supports the selected concept; do not invent student participation or survey results.`]
    .filter(Boolean).join("\n\n");
}

export type MaterialAdaptation = { requestId: string; classroomContext: string; teachingContext: MaterialTeachingContext };

/** Public metadata never includes the private class snapshot reference. */
export function publicTeachingSettings(settings?: MaterialTeachingContext) {
  return { gradeBand: settings?.gradeBand || "", experienceContext: settings?.experienceContext || "", quizPattern: settings?.quizPattern || "" };
}

export function canonicalGrade(value = "") {
  const s = value.trim().toLowerCase().replace(/[–—]/gu, "-");
  if (/^(middle school|grades? (6-8|7-8|6|7|8))$/u.test(s)) return "Middle school";
  if (/^(high school|grades? (9-12|9|10|11|12))$/u.test(s)) return "High school";
  if (/^(elementary school|primary school|grades? (k-5|1-5|1|2|3|4|5))$/u.test(s)) return "Elementary school";
  return GRADE_BANDS.find(grade => grade.toLowerCase() === s) || value.trim();
}

/** Compare common K–12 grade ranges without changing a material's recorded grade. */
export function galleryGradeBand(value = "") {
  const label = value.trim().toLowerCase().replace(/[–—]/gu, "-");
  const grades = /^(?:grades?\s+)?(k|[1-9]|1[0-2])(?:st|nd|rd|th)?(?:\s*-\s*(k|[1-9]|1[0-2])(?:st|nd|rd|th)?)?(?:\s+grades?)?$/u.exec(label);
  if (grades) {
    const first = grades[1] === "k" ? 0 : Number(grades[1]);
    const last = grades[2] === undefined ? first : grades[2] === "k" ? 0 : Number(grades[2]);
    if (first <= last) {
      if (last <= 5) return "Elementary school";
      if (first >= 6 && last <= 8) return "Middle school";
      if (first >= 9) return "High school";
    }
  }
  return canonicalGrade(value);
}
