import type { Lesson, StudentAnswer, Survey, SurveyItem, SurveyResponse } from "./types";

/**
 * Per-student survey results for the teacher's Assignment summary (#93).
 *
 * Both kinds of survey share the SurveyItem shape, so one viewer covers:
 * - the built-in beginning-of-lesson survey (#88), whose answers are stored
 *   alongside the quiz answers, keyed by field_id; and
 * - teacher-created surveys (#95), whose answers are SurveyResponse records.
 */

export type SurveyResultEntry = {
  studentId: string;
  name: string;
  answers: Record<string, string>;
  submittedAt?: string;
  late: boolean;
};

export type SurveyResultSource = {
  id: string;
  title: string;
  subtitle: string;
  questions: SurveyItem[];
  entries: SurveyResultEntry[];
  /** Students who started but have not submitted (teacher surveys only). */
  inProgress: number;
};

const fieldIdsOf = (questions: SurveyItem[]) =>
  questions.flatMap((q) => q.response_fields.map((f) => f.field_id));

const byName = (a: SurveyResultEntry, b: SurveyResultEntry) =>
  a.name.localeCompare(b.name);

export const buildLessonSurveySource = (
  lesson: Pick<Lesson, "lesson_number" | "survey_items"> | null,
  studentAnswers: StudentAnswer[],
): SurveyResultSource | null => {
  const questions = lesson?.survey_items ?? [];
  if (!lesson || questions.length === 0) return null;
  const fieldIds = fieldIdsOf(questions);

  const entries = studentAnswers
    .filter((a) => fieldIds.some((id) => a.answers[id]?.trim()))
    .map((a) => ({
      studentId: a.student_id,
      name: a.student_name || a.student_id,
      answers: Object.fromEntries(fieldIds.map((id) => [id, a.answers[id] ?? ""])),
      submittedAt: a.submitted_at,
      late: false,
    }))
    .sort(byName);

  return {
    id: `lesson-${lesson.lesson_number}`,
    title: "Beginning-of-lesson survey",
    subtitle: `Lesson ${lesson.lesson_number}`,
    questions,
    entries,
    inProgress: 0,
  };
};

export const buildTeacherSurveySource = (
  survey: Pick<Survey, "survey_id" | "title" | "daily_experience_topic" | "questions">,
  responses: SurveyResponse[],
): SurveyResultSource => {
  const own = responses.filter((r) => r.survey_id === survey.survey_id);
  const entries = own
    .filter((r) => r.status === "submitted")
    .map((r) => ({
      studentId: r.student_id,
      name: r.student_name || r.student_id,
      answers: r.answers,
      submittedAt: r.submitted_at,
      late: Boolean(r.is_late),
    }))
    .sort(byName);

  return {
    id: `survey-${survey.survey_id}`,
    title: survey.title,
    subtitle: survey.daily_experience_topic,
    questions: survey.questions,
    entries,
    inProgress: own.filter((r) => r.status === "draft").length,
  };
};

/** A question counts as answered when any of its fields has an answer. */
export const countAnswered = (
  questions: SurveyItem[],
  answers: Record<string, string>,
) => ({
  answered: questions.filter((q) =>
    q.response_fields.some((f) => answers[f.field_id]?.trim()),
  ).length,
  total: questions.length,
});

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** One student's answers as CSV: question, field, answer. */
export const entryToCsv = (source: SurveyResultSource, entry: SurveyResultEntry) => {
  const rows = [["Student", "Question", "Field", "Answer"]];
  source.questions.forEach((q, i) => {
    q.response_fields.forEach((f) => {
      rows.push([entry.name, `${i + 1}. ${q.stem}`, f.label, entry.answers[f.field_id] ?? ""]);
    });
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
};
