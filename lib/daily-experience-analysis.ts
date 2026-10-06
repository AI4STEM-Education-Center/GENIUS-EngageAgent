import type { SurveyResponse } from "./types";

/**
 * Daily-experience analysis of survey responses (#114).
 *
 * Pipeline: anonymize submitted responses -> LLM extracts each student's
 * activities -> LLM groups the free-text labels into categories -> the code
 * here counts and ranks them. Counting is deliberately done in code, not by
 * the LLM, so the numbers teachers see are exact and testable.
 */

/** Whether the student does the activity themselves or has only watched it. */
export type ActivityInvolvement = "do" | "watched";

export type ExtractedActivity = {
  /** Short free-text label from the LLM, e.g. "soccer" or "bball". */
  label: string;
  involvement: ActivityInvolvement;
  objects: string[];
  /** One-line "something went wrong" moment, if the student described one. */
  incident?: string;
};

export type StudentExtraction = {
  /** Anonymous id ("S1", "S2", ...), never a real name or GENIUS id. */
  student: string;
  /** Empty when the answers were blank or off-topic. */
  activities: ExtractedActivity[];
};

/** Two-level category for an activity, e.g. Sports -> Soccer. */
export type CategoryAssignment = { category: string; activity: string };

/** Normalized label -> category, as returned by the grouping step. */
export type LabelGrouping = Record<string, CategoryAssignment>;

export type RankedActivity = {
  category: string;
  activity: string;
  /** Distinct students who mention it at all. */
  studentCount: number;
  /** Students who do it (a student who both does and watched it counts here). */
  doCount: number;
  /** Students who have only watched it. */
  watchedCount: number;
  /** Most-mentioned objects, by number of distinct students. */
  objects: { name: string; count: number }[];
  /** A few example "something went wrong" moments. */
  incidents: string[];
};

export type DailyExperienceSummary = {
  responseCount: number;
  /** Students with no usable activity (blank or off-topic answers). */
  unclassifiedCount: number;
  enoughResponses: boolean;
  /** Every activity, most common first. */
  activities: RankedActivity[];
  /** Most and second-most common activities (empty when not enough responses). */
  top: RankedActivity[];
};

export const MIN_RESPONSES = 3;
const MAX_OBJECTS = 5;
const MAX_INCIDENTS = 3;

export type AnonymizedResponse = { student: string; answers: Record<string, string> };

/**
 * Keeps only submitted responses to the given survey and replaces student
 * identities with "S1", "S2", ... before anything is sent to the LLM. The
 * returned `idMap` (anonymous id -> student_id) stays on the server.
 */
export const anonymizeResponses = (responses: SurveyResponse[], surveyId: string) => {
  const submitted = responses
    .filter((r) => r.survey_id === surveyId && r.status === "submitted")
    .sort((a, b) => a.student_id.localeCompare(b.student_id));

  const idMap: Record<string, string> = {};
  const anonymized: AnonymizedResponse[] = submitted.map((r, i) => {
    const student = `S${i + 1}`;
    idMap[student] = r.student_id;
    return { student, answers: r.answers };
  });
  return { anonymized, idMap };
};

/** Lowercases, trims, and strips punctuation so "Soccer!" and " soccer" match. */
export const normalizeLabel = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const fallbackAssignment = (label: string): CategoryAssignment => ({
  category: "Uncategorized",
  activity: label.charAt(0).toUpperCase() + label.slice(1),
});

type Tally = {
  assignment: CategoryAssignment;
  involvement: Map<string, ActivityInvolvement>;
  objectStudents: Map<string, Set<string>>;
  incidents: string[];
};

/**
 * Counts and ranks activities across the class.
 *
 * - Each student counts at most once per activity; if they both do and
 *   watched it (e.g. "soccer" and "football" grouped together), "do" wins.
 * - Ranked by distinct students, then by "do" count, then alphabetically.
 * - Labels the grouping step didn't return fall back to "Uncategorized"
 *   rather than being dropped.
 */
export const aggregateDailyExperiences = (
  extractions: StudentExtraction[],
  grouping: LabelGrouping,
  responseCount: number = extractions.length,
): DailyExperienceSummary => {
  const tallies = new Map<string, Tally>();
  let unclassifiedCount = 0;

  for (const { student, activities } of extractions) {
    const usable = activities.filter((a) => normalizeLabel(a.label));
    if (usable.length === 0) {
      unclassifiedCount += 1;
      continue;
    }

    for (const activity of usable) {
      const label = normalizeLabel(activity.label);
      const assignment = grouping[label] ?? fallbackAssignment(label);
      const key = `${assignment.category}\u0000${assignment.activity}`;
      const tally: Tally =
        tallies.get(key) ??
        { assignment, involvement: new Map(), objectStudents: new Map(), incidents: [] };
      tallies.set(key, tally);

      if (tally.involvement.get(student) !== "do") {
        tally.involvement.set(student, activity.involvement);
      }
      for (const object of activity.objects) {
        const name = normalizeLabel(object);
        if (!name) continue;
        const students = tally.objectStudents.get(name) ?? new Set<string>();
        students.add(student);
        tally.objectStudents.set(name, students);
      }
      const incident = activity.incident?.trim();
      if (incident && tally.incidents.length < MAX_INCIDENTS) {
        tally.incidents.push(incident);
      }
    }
  }

  const activities: RankedActivity[] = [...tallies.values()].map((t) => {
    const involvements = [...t.involvement.values()];
    const doCount = involvements.filter((i) => i === "do").length;
    return {
      ...t.assignment,
      studentCount: involvements.length,
      doCount,
      watchedCount: involvements.length - doCount,
      objects: [...t.objectStudents.entries()]
        .map(([name, students]) => ({ name, count: students.size }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, MAX_OBJECTS),
      incidents: t.incidents,
    };
  });

  activities.sort(
    (a, b) =>
      b.studentCount - a.studentCount ||
      b.doCount - a.doCount ||
      a.activity.localeCompare(b.activity),
  );

  const enoughResponses = responseCount >= MIN_RESPONSES;
  return {
    responseCount,
    unclassifiedCount,
    enoughResponses,
    activities,
    top: enoughResponses ? activities.slice(0, 2) : [],
  };
};

/**
 * A saved analysis for one survey. Per-student `extractions` and the
 * anonymous-id `id_map` are stored for later per-student personalization but
 * are never returned to the browser.
 */
export type SurveyAnalysisRecord = {
  class_id: string;
  assignment_id: string;
  survey_id: string;
  daily_experience_topic: string;
  model: string;
  analyzed_at: string;
  summary: DailyExperienceSummary;
  extractions: StudentExtraction[];
  grouping: LabelGrouping;
  id_map: Record<string, string>;
};
