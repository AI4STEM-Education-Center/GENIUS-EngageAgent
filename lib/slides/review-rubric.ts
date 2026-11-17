export const REVIEW_RUBRIC = [
  ["sci1", "Science", "Accurate to the core ideas"], ["sci2", "Science", "Aimed at the selected focus"],
  ["inq1", "Inquiry", "Leaves a real thinking gap"], ["inq2", "Inquiry", "Observe before predicting"],
  ["inq3", "Inquiry", "One student action per slide"], ["inq4", "Inquiry", "Starts from familiar experiences"],
  ["str1", "Strategy", "Follows the selected sequence"], ["str2", "Strategy", "Commit before the evidence, when required"],
  ["txt1", "Student-facing text", "No teacher jargon"], ["txt2", "Student-facing text", "Short, clear tasks"],
  ["txt3", "Student-facing text", "Honest observations and surprise"],
  ["vis1", "Images & video", "Images match the text"], ["vis2", "Images & video", "Linked video fits the slide"],
  ["q1", "Questions & notes", "Ends with students’ own questions"], ["q2", "Questions & notes", "Notes explain purpose and what to listen for"],
] as const;
export type RubricResult = { id: string; status: "pass" | "issue" | "not_applicable" | "needs_review"; reason: string };
export type ReviewFinding = { id: string; field: string; message: string; slideIndex?: number; visualId?: string };
export function parseRubric(value: unknown): RubricResult[] | undefined {
  if (value === undefined) return undefined; // earlier saved jobs remain readable
  if (!Array.isArray(value) || value.length !== REVIEW_RUBRIC.length || new Set(value.map(v => v?.id)).size !== value.length) throw new Error("Incomplete review rubric.");
  return value.map(v => {
    if (!v || !REVIEW_RUBRIC.some(([id]) => id === v.id) || !["pass", "issue", "not_applicable", "needs_review"].includes(v.status)
      || typeof v.reason !== "string" || !v.reason.trim() || v.reason.length > 240) throw new Error("Invalid review rubric.");
    return { id: v.id, status: v.status, reason: v.reason };
  });
}
