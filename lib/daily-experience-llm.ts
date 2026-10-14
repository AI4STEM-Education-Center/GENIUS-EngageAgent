import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import {
  aggregateDailyExperiences,
  normalizeLabel,
  type ExtractedActivity,
  type LabelGrouping,
  type StudentAnalysis,
  type StudentExtraction,
  type SurveyAnalysisRecord,
} from "./daily-experience-analysis";
import type { Survey, SurveyResponse } from "./types";

/**
 * LLM steps of the daily-experience analysis (#114): extract each student's
 * activities, then group the free-text labels into two-level categories.
 * Counting and ranking stay in code (`aggregateDailyExperiences`).
 */

export const DEFAULT_ANALYSIS_MODEL = "gpt-4o-mini";
/**
 * Bump when a change means saved analyses should be redone from scratch.
 * v2: one student per extraction call and full regrouping, since v1 could
 * silently save skipped students as having no activity.
 */
export const ANALYSIS_VERSION = 2;
/**
 * Students are extracted one per call: batching several students into one
 * call let the model silently skip some of them, or loop on blank ones.
 */
export const EXTRACTION_CONCURRENCY = 8;
/** Output caps, so a runaway reply fails fast instead of burning tokens. */
const EXTRACTION_MAX_TOKENS = 1_000;
const GROUPING_MAX_TOKENS = 8_000;

/** The slice of the OpenAI client this module uses, so tests can pass a fake. */
export type ChatClient = {
  chat: {
    completions: {
      create: (params: {
        model: string;
        temperature?: number;
        max_completion_tokens?: number;
        response_format: ResponseFormatJSONSchema;
        messages: { role: "system" | "user"; content: string }[];
      }) => Promise<{ choices: { message: { content: string | null }; finish_reason?: string }[] }>;
    };
  };
};

const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const extractionFormat: ResponseFormatJSONSchema = {
  type: "json_schema",
  json_schema: {
    name: "daily_experience_extraction",
    strict: true,
    schema: object({
      activities: {
        type: "array",
        maxItems: 2,
        description: "At most two activities. Empty when the answers are blank, refusals or off-topic.",
        items: object({
          label: { type: "string", description: "Common English name of the activity, 1-3 lowercase words, e.g. \"soccer\", \"cooking\", \"video games\". Fix misspellings." },
          involvement: { type: "string", enum: ["do", "watched"] },
          objects: { type: "array", items: { type: "string" }, description: "Physical objects or equipment the student mentions for this activity, lowercase singular nouns." },
          incident: { type: "string", description: "One short sentence paraphrasing what fell, broke, got hurt or went wrong in this activity, with no personal names. Empty string if none." },
        }),
      },
    }),
  },
};

export const groupingFormat: ResponseFormatJSONSchema = {
  type: "json_schema",
  json_schema: {
    name: "daily_experience_grouping",
    strict: true,
    schema: object({
      groups: {
        type: "array",
        items: object({
          label: { type: "string", description: "One input label, copied exactly." },
          category: { type: "string", description: "Broad category in Title case, e.g. \"Sports\", \"Games\", \"Cooking & baking\", \"Chores\", \"Arts & music\"." },
          activity: { type: "string", description: "Specific activity name in sentence case, shared by all labels for the same activity, e.g. \"Soccer\", \"Video games\"." },
        }),
      },
    }),
  },
};

/** Renders the survey's questions once, with their purpose, for the prompt. */
const describeQuestions = (survey: Pick<Survey, "questions">) =>
  survey.questions
    .map((q) => `Q${q.question_number} (${q.category.replace("_", " ")}): ${q.stem}`)
    .join("\n");

/** One student's answers keyed by question number, multi-field answers joined. */
const answersByQuestion = (survey: Pick<Survey, "questions">, answers: Record<string, string>) => {
  const result: Record<string, string> = {};
  for (const q of survey.questions) {
    const text = q.response_fields
      .map((f) => answers[f.field_id]?.trim())
      .filter(Boolean)
      .join(" / ");
    result[`Q${q.question_number}`] = text;
  }
  return result;
};

/** One student's answers only: no name, id or other students are sent. */
export const buildExtractionPrompt = (
  survey: Pick<Survey, "daily_experience_topic" | "questions">,
  answers: Record<string, string>,
) => ({
  system: [
    "You analyze one middle-school student's survey answers about their daily experiences.",
    `The teacher's DAILY EXPERIENCE TOPIC for this survey is: "${survey.daily_experience_topic}". Focus on experiences relevant to that topic.`,
    "List at most two activities the student describes (usually one from the first activity question and one from the second).",
    "involvement is \"do\" unless the student says they watch the activity or describes other people doing it; only then use \"watched\".",
    "Use the general activity name, not a specific game title, brand, team or position (\"Minecraft\" -> \"video games\", \"goalie\" -> \"soccer\"), and fix misspellings.",
    "Name each activity using details from all of the student's answers about it, including the follow-up answers about what went wrong.",
    "Resolve ambiguous names from those details: \"football\" with kicking, goals, goalkeepers or goal posts is \"soccer\"; with touchdowns, quarterbacks or tackling pads it is \"american football\". Only write \"football\" if it is truly unclear.",
    "Write objects as lowercase singular nouns (\"pot\", not \"pots\").",
    "Write incidents in the third person (\"A player fell\", \"The pot boiled over\"), never \"I\" or personal names.",
    "If the same activity appears twice, list it once, as \"do\" if they do it at all.",
    "Count an activity they only watch, even if they say they don't do anything themselves.",
    "Return an empty activities list for blank, refusal (\"idk\", \"nothing\") or off-topic answers. Never invent activities.",
    "Never include personal names in any field.",
    "",
    "Survey questions:",
    describeQuestions(survey),
  ].join("\n"),
  user: JSON.stringify({ answers: answersByQuestion(survey, answers) }),
});

/**
 * Groups the survey's full label list in one call, so the result doesn't
 * depend on the order responses arrived in.
 */
export const buildGroupingPrompt = (topic: string, labels: string[]) => ({
  system: [
    "You group activity labels extracted from students' survey answers.",
    `The DAILY EXPERIENCE TOPIC is: "${topic}".`,
    "Assign every label a broad category and a specific activity name.",
    "Labels that are synonyms, regional names or misspellings of the same activity must share exactly the same category and activity name.",
    "Name activities at the general level a teacher would use for a classroom example: a sport, game type, hobby or chore, not a specific title, brand or variant (\"minecraft\" and \"racing games\" -> \"Video games\").",
    "Keep genuinely different activities separate (e.g. soccer and basketball are both Sports but different activities). Cooking and baking are one activity, \"Cooking\".",
    "\"football\" means the student's sport was unclear (clear cases were already written as \"soccer\" or \"american football\"), so give it its own activity, \"Football\"; never merge it into Soccer or American football.",
    "Return one entry per input label, copying the label exactly.",
  ].join("\n"),
  user: JSON.stringify({ labels }),
});

const parseContent = (content: string | null | undefined, step: string): unknown => {
  try {
    return JSON.parse(content ?? "");
  } catch {
    throw new Error(`The ${step} step returned invalid JSON.`);
  }
};

const asString = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Coerces one student's extraction output and drops malformed fields. Throws
 * when there's no activities list at all, so the student is retried later
 * rather than counted as having no activity.
 */
export const parseExtraction = (raw: unknown): ExtractedActivity[] => {
  const activities = (raw as { activities?: unknown })?.activities;
  if (!Array.isArray(activities)) throw new Error("The extraction step returned no activities list.");
  return activities
    .map((a) => ({
      label: asString(a?.label),
      involvement: a?.involvement === "watched" ? ("watched" as const) : ("do" as const),
      objects: Array.isArray(a?.objects) ? a.objects.map(asString).filter(Boolean) : [],
      incident: asString(a?.incident) || undefined,
    }))
    .filter((a) => normalizeLabel(a.label))
    .slice(0, 2);
};

/** Whether every answer is empty, so there's nothing to send to the model. */
const isBlankResponse = (answers: Record<string, string>) =>
  Object.values(answers).every((value) => !value?.trim());

/** Coerces grouping output into normalized label -> category. */
export const parseGrouping = (raw: unknown): LabelGrouping => {
  const grouping: LabelGrouping = {};
  const rows = (raw as { groups?: unknown })?.groups;
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = normalizeLabel(asString(row?.label));
    const category = asString(row?.category).trim();
    const activity = asString(row?.activity).trim();
    if (label && category && activity) grouping[label] = { category, activity };
  }
  return grouping;
};

/** Like Promise.allSettled over `items.map(fn)`, with at most `limit` running at once. */
const settleWithLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** Submitted responses to the survey that aren't in `previous` yet, or changed since. */
export const responsesToAnalyze = (
  responses: SurveyResponse[],
  surveyId: string,
  previous: Pick<SurveyAnalysisRecord, "students"> | null,
) =>
  responses.filter(
    (r) =>
      r.survey_id === surveyId &&
      r.status === "submitted" &&
      previous?.students[r.student_id]?.response_updated_at !== r.updated_at,
  );

/**
 * Whether the saved analysis is out of date: a submitted response is new or
 * changed, or a previously analyzed student no longer has a submitted one.
 */
export const isAnalysisStale = (
  responses: SurveyResponse[],
  surveyId: string,
  previous: Pick<SurveyAnalysisRecord, "students"> | null,
) => {
  const submitted = responses.filter((r) => r.survey_id === surveyId && r.status === "submitted");
  if (!previous) return submitted.length > 0;
  return (
    responsesToAnalyze(responses, surveyId, previous).length > 0 ||
    Object.keys(previous.students).length !== submitted.length
  );
};

/**
 * Brings a survey's analysis up to date (#114). Only new or changed
 * responses are sent for extraction, one student per call with only their
 * answers (names and ids are never sent); fully blank responses aren't sent
 * at all, and earlier students' results are reused. A student whose call
 * fails isn't saved, so the next update retries them; if every call fails,
 * this throws. When there are new labels, the whole label list is regrouped
 * so the grouping doesn't depend on arrival order. Counting is redone in code.
 */
export const updateDailyExperienceAnalysis = async ({
  client,
  survey,
  responses,
  previous,
  model = DEFAULT_ANALYSIS_MODEL,
  now = new Date(),
}: {
  client: ChatClient;
  survey: Pick<Survey, "survey_id" | "class_id" | "assignment_id" | "daily_experience_topic" | "questions">;
  responses: SurveyResponse[];
  previous: SurveyAnalysisRecord | null;
  model?: string;
  now?: Date;
}): Promise<SurveyAnalysisRecord> => {
  const ask = async (
    prompt: { system: string; user: string },
    format: ResponseFormatJSONSchema,
    step: string,
    maxTokens: number,
  ) => {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      max_completion_tokens: maxTokens,
      response_format: format,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });
    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") throw new Error(`The ${step} step's output was cut off.`);
    return parseContent(choice?.message?.content, step);
  };

  const changed = responsesToAnalyze(responses, survey.survey_id, previous);
  const settled = await settleWithLimit(changed, EXTRACTION_CONCURRENCY, async (r) =>
    isBlankResponse(r.answers)
      ? []
      : parseExtraction(
          await ask(buildExtractionPrompt(survey, r.answers), extractionFormat, "extraction", EXTRACTION_MAX_TOKENS),
        ),
  );
  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
  // Every call to the model failed (e.g. it's down): keep the last good analysis.
  const sent = changed.filter((r) => !isBlankResponse(r.answers)).length;
  if (failures.length && failures.length === sent) throw failures[0].reason;
  if (failures.length) {
    console.error(
      `daily-experience extraction failed for ${failures.length} of ${changed.length} responses; they'll be retried on the next update`,
      failures[0].reason instanceof Error ? failures[0].reason.message : failures[0].reason,
    );
  }

  // Keep earlier results only for students who still have a submitted response.
  const submitted = responses.filter((r) => r.survey_id === survey.survey_id && r.status === "submitted");
  const students: Record<string, StudentAnalysis> = {};
  for (const r of submitted) {
    const kept = previous?.students[r.student_id];
    if (kept && kept.response_updated_at === r.updated_at) students[r.student_id] = kept;
  }
  changed.forEach((r, i) => {
    const result = settled[i];
    if (result.status === "fulfilled") {
      students[r.student_id] = { response_updated_at: r.updated_at, activities: result.value };
    }
  });

  const labels = [...new Set(Object.values(students).flatMap((s) => s.activities.map((a) => normalizeLabel(a.label))))].sort();
  const previousGrouping = previous?.grouping ?? {};
  const grouping: LabelGrouping = labels.every((l) => previousGrouping[l])
    ? Object.fromEntries(labels.map((l) => [l, previousGrouping[l]]))
    : parseGrouping(
        await ask(buildGroupingPrompt(survey.daily_experience_topic, labels), groupingFormat, "grouping", GROUPING_MAX_TOKENS),
      );

  const extractions: StudentExtraction[] = Object.entries(students).map(([student, s]) => ({ student, activities: s.activities }));
  return {
    analysis_version: ANALYSIS_VERSION,
    class_id: survey.class_id,
    assignment_id: survey.assignment_id,
    survey_id: survey.survey_id,
    daily_experience_topic: survey.daily_experience_topic,
    model,
    analyzed_at: now.toISOString(),
    summary: aggregateDailyExperiences(extractions, grouping, submitted.length),
    students,
    grouping,
  };
};
