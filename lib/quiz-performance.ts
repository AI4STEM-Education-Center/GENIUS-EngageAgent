import { resolveQuizEvidence } from "./lesson-context";
import { getLesson } from "./quiz-data";
import type { StudentAnswer } from "./types";

/**
 * Quiz performance for the teacher (UC-Q-06, #34).
 *
 * Builds the overview, the per-question summaries and the detailed per-student
 * rows from the stored quiz answers. Right/wrong, confidence and the diagnostic
 * category come from resolveQuizEvidence, so this report and the strategy
 * recommendations read answers the same way.
 */

/** Confidence answers are A–D; the report shows them on a 4-point scale. */
const CONFIDENCE_LEVEL: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 };

export const confidenceLevel = (option: string | null): number | null =>
  option ? CONFIDENCE_LEVEL[option.toUpperCase()] ?? null : null;

/**
 * A single key for the diagnostic filter: the misconception code for a wrong
 * answer, "correct" for a right one, "uncategorized" for a wrong answer with no
 * mapped misconception, and "no-answer" when the question was left blank.
 */
export type DiagnosticKey = string;

export type PerformanceRow = {
  studentId: string;
  studentName: string;
  submittedAt: string;
  itemId: string;
  questionNumber: number;
  stem: string;
  selectedOption: string | null;
  selectedText: string | null;
  correctOption: string | null;
  isCorrect: boolean | null;
  confidenceLevel: number | null;
  confidenceText: string | null;
  diagnosticKey: DiagnosticKey;
  diagnosticLabel: string;
};

export type QuestionSummary = {
  itemId: string;
  questionNumber: number;
  stem: string;
  options: Record<string, string>;
  correctOption: string | null;
  responses: number;
  noResponse: number;
  correct: number;
  /** null when nobody has answered yet ("Not available"). */
  correctPercent: number | null;
  averageConfidence: number | null;
  optionCounts: Record<string, number>;
};

export type PerformanceReport = {
  lessonNumber: number;
  lessonTitle: string;
  questionCount: number;
  submitted: number;
  questions: QuestionSummary[];
  rows: PerformanceRow[];
  /** Diagnostic categories that appear in this lesson, for the filter. */
  diagnosticOptions: Array<{ key: DiagnosticKey; label: string }>;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export const buildPerformanceReport = (
  lessonNumber: number | null,
  answers: StudentAnswer[],
): PerformanceReport | null => {
  if (!lessonNumber) return null;
  const lesson = getLesson(lessonNumber);
  if (!lesson) return null;

  const questions = lesson.quiz_items.filter((q) => q.type === "multiple_choice");
  // Only answers for the lesson currently assigned, in case the teacher switched lessons.
  const submissions = answers
    .filter((a) => a.lesson_number === lessonNumber)
    .sort((a, b) => (a.student_name || a.student_id).localeCompare(b.student_name || b.student_id));

  const rows: PerformanceRow[] = [];
  for (const submission of submissions) {
    const evidence = resolveQuizEvidence(lessonNumber, submission.answers);
    evidence.forEach((e, index) => {
      const key: DiagnosticKey = !e.selectedOption
        ? "no-answer"
        : e.isCorrect
          ? "correct"
          : e.misconceptionCode ?? "uncategorized";
      const label =
        key === "no-answer"
          ? "No answer"
          : key === "correct"
            ? "Correct"
            : key === "uncategorized"
              ? "Uncategorized"
              : `${key}: ${e.misconceptionText ?? key}`;
      rows.push({
        studentId: submission.student_id,
        studentName: submission.student_name || submission.student_id,
        submittedAt: submission.submitted_at,
        itemId: e.itemId,
        questionNumber: e.questionNumber ?? index + 1,
        stem: e.stem,
        selectedOption: e.selectedOption,
        selectedText: e.selectedText,
        correctOption: e.correctOption,
        isCorrect: e.isCorrect,
        confidenceLevel: confidenceLevel(e.confidenceOption),
        confidenceText: e.confidenceText,
        diagnosticKey: key,
        diagnosticLabel: label,
      });
    });
  }

  const summaries: QuestionSummary[] = questions.map((q, index) => {
    const qRows = rows.filter((r) => r.itemId === q.item_id);
    const answered = qRows.filter((r) => r.selectedOption);
    const correct = answered.filter((r) => r.isCorrect).length;
    const levels = answered.map((r) => r.confidenceLevel).filter((n): n is number => n !== null);
    const optionCounts: Record<string, number> = Object.fromEntries(
      Object.keys(q.options).map((o) => [o, 0]),
    );
    for (const r of answered) {
      if (r.selectedOption && r.selectedOption in optionCounts) optionCounts[r.selectedOption] += 1;
    }
    return {
      itemId: q.item_id,
      questionNumber: q.question_number ?? index + 1,
      stem: q.stem,
      options: q.options,
      correctOption: q.correct_answer?.toUpperCase() ?? null,
      responses: answered.length,
      noResponse: submissions.length - answered.length,
      correct,
      correctPercent: answered.length ? Math.round((correct / answered.length) * 100) : null,
      averageConfidence: levels.length ? round1(levels.reduce((a, b) => a + b, 0) / levels.length) : null,
      optionCounts,
    };
  });

  const diagnosticOptions = [
    { key: "correct", label: "Correct" },
    ...Object.entries(lesson.misconceptions).map(([code, text]) => ({ key: code, label: `${code}: ${text}` })),
    { key: "uncategorized", label: "Uncategorized" },
    { key: "no-answer", label: "No answer" },
  ];

  return {
    lessonNumber,
    lessonTitle: lesson.lesson_title,
    questionCount: questions.length,
    submitted: submissions.length,
    questions: summaries,
    rows,
    diagnosticOptions,
  };
};

/* ------------------------------------------------------------------ */
/*  Filters for the detailed report                                     */
/* ------------------------------------------------------------------ */

export type PerformanceFilters = {
  /** item_id, or "all" */
  question: string;
  /** free-text search on student name or id */
  student: string;
  /** "A"–"D", or "all" */
  option: string;
  /** "1"–"4", or "all" */
  confidence: string;
  /** a DiagnosticKey, or "all" */
  diagnostic: string;
  /** "true" / "false", or "all" */
  correct: string;
};

export const EMPTY_FILTERS: PerformanceFilters = {
  question: "all",
  student: "",
  option: "all",
  confidence: "all",
  diagnostic: "all",
  correct: "all",
};

export const hasActiveFilters = (f: PerformanceFilters) =>
  (Object.keys(EMPTY_FILTERS) as Array<keyof PerformanceFilters>).some((k) => f[k] !== EMPTY_FILTERS[k]);

export const filterRows = (rows: PerformanceRow[], f: PerformanceFilters): PerformanceRow[] => {
  const term = f.student.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (f.question === "all" || r.itemId === f.question) &&
      (!term || r.studentName.toLowerCase().includes(term) || r.studentId.toLowerCase().includes(term)) &&
      (f.option === "all" || r.selectedOption === f.option) &&
      (f.confidence === "all" || String(r.confidenceLevel) === f.confidence) &&
      (f.diagnostic === "all" || r.diagnosticKey === f.diagnostic) &&
      (f.correct === "all" || String(r.isCorrect) === f.correct),
  );
};
