import OpenAI from "openai";
import type { RankedActivity, SurveyAnalysisRecord } from "./daily-experience-analysis";
import {
  DEFAULT_ANALYSIS_MODEL,
  isAnalysisStale,
  updateDailyExperienceAnalysis,
  type ChatClient,
} from "./daily-experience-llm";
import { getSurveyAnalysis, listSurveyResponses, listSurveys, upsertSurveyAnalysis } from "./nosql";
import { pickTaskSurvey } from "./survey-schedule";

/**
 * Students' common daily experiences for one learning task (#114), as input
 * for personalizing generated materials.
 *
 * Usage (server-side):
 *
 *   const interests = await getTaskInterests(classId, assignmentId);
 *   if (interests?.enoughResponses) {
 *     const [first, second] = interests.top;
 *     // e.g. first.activity === "Soccer", first.objects === ["ball", "goal", ...]
 *   }
 *
 * Results are per learning task: each task has one survey (#111), and the
 * analysis follows that survey's DAILY EXPERIENCE TOPIC. The analysis
 * updates automatically when it's read after new responses arrive.
 */

export type InterestActivity = {
  /** Specific activity, e.g. "Soccer". */
  activity: string;
  /** Broad category, e.g. "Sports". */
  category: string;
  /** Distinct students who mentioned it. */
  studentCount: number;
  /** Students who do it themselves. */
  doCount: number;
  /** Students who have only watched it. */
  watchedCount: number;
  /** Most-mentioned objects/equipment, most common first (up to 5). */
  objects: string[];
  /** Example "something fell, broke, got hurt or went wrong" moments (up to 3), third person, no names. */
  incidents: string[];
};

export type TaskInterests = {
  classId: string;
  assignmentId: string;
  surveyId: string;
  dailyExperienceTopic: string;
  /** When the analysis was last updated (ISO). */
  analyzedAt: string;
  /** Submitted responses included in the analysis. */
  responseCount: number;
  /** Students whose answers had no clear activity (blank or off-topic). */
  unclassifiedCount: number;
  /** False with fewer than 3 responses; `top` is then empty. */
  enoughResponses: boolean;
  /** Most and second-most common activities. */
  top: InterestActivity[];
  /** Every activity mentioned, most common first. */
  activities: InterestActivity[];
  /**
   * True when newer responses exist but the update failed (e.g. OpenAI was
   * unavailable); the result is the last successful analysis.
   */
  stale: boolean;
};

const toActivity = (a: RankedActivity): InterestActivity => ({
  activity: a.activity,
  category: a.category,
  studentCount: a.studentCount,
  doCount: a.doCount,
  watchedCount: a.watchedCount,
  objects: a.objects.map((o) => o.name),
  incidents: a.incidents,
});

export const toTaskInterests = (record: SurveyAnalysisRecord, stale = false): TaskInterests => ({
  classId: record.class_id,
  assignmentId: record.assignment_id,
  surveyId: record.survey_id,
  dailyExperienceTopic: record.daily_experience_topic,
  analyzedAt: record.analyzed_at,
  responseCount: record.summary.responseCount,
  unclassifiedCount: record.summary.unclassifiedCount,
  enoughResponses: record.summary.enoughResponses,
  top: record.summary.top.map(toActivity),
  activities: record.summary.activities.map(toActivity),
  stale,
});

// Concurrent reads of the same task on this server share one update.
const inFlight = new Map<string, Promise<TaskInterests | null>>();

const defaultClient = (): ChatClient | null =>
  process.env.OPENAI_API_KEY
    ? (new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as ChatClient)
    : null;

/**
 * The task's interests, brought up to date first if new responses have
 * arrived. Returns null when the task has no survey or no submitted
 * responses yet. If updating fails, returns the last saved analysis marked
 * `stale` (or throws if there is none yet).
 */
export const getTaskInterests = async (
  classId: string,
  assignmentId: string,
  options: { client?: ChatClient | null } = {},
): Promise<TaskInterests | null> => {
  const key = `${classId}\u0000${assignmentId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const run = (async () => {
    const survey = pickTaskSurvey(await listSurveys(classId, assignmentId));
    if (!survey) return null;

    const [responses, previous] = await Promise.all([
      listSurveyResponses(classId, assignmentId, survey.survey_id),
      getSurveyAnalysis(classId, assignmentId, survey.survey_id),
    ]);
    const current = previous?.daily_experience_topic === survey.daily_experience_topic ? previous : null;
    if (!isAnalysisStale(responses, survey.survey_id, current)) {
      return current ? toTaskInterests(current) : null;
    }

    const client = options.client === undefined ? defaultClient() : options.client;
    try {
      if (!client) throw new Error("OPENAI_API_KEY is not set.");
      const record = await updateDailyExperienceAnalysis({
        client,
        survey,
        responses,
        previous: current,
        model: process.env.OPENAI_SURVEY_ANALYSIS_MODEL ?? DEFAULT_ANALYSIS_MODEL,
      });
      await upsertSurveyAnalysis(record);
      return toTaskInterests(record);
    } catch (error) {
      console.error("daily-experience analysis update failed", error instanceof Error ? error.message : error);
      if (previous) return toTaskInterests(previous, true);
      throw error;
    }
  })();

  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
};
