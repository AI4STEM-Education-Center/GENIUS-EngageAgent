import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import {
  aggregateDailyExperiences,
  anonymizeResponses,
  normalizeLabel,
  type AnonymizedResponse,
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
export const EXTRACTION_BATCH_SIZE = 10;

/** The slice of the OpenAI client this module uses, so tests can pass a fake. */
export type ChatClient = {
  chat: {
    completions: {
      create: (params: {
        model: string;
        temperature?: number;
        response_format: ResponseFormatJSONSchema;
        messages: { role: "system" | "user"; content: string }[];
      }) => Promise<{ choices: { message: { content: string | null } }[] }>;
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
      students: {
        type: "array",
        items: object({
          student: { type: "string", description: "The anonymous student id exactly as given, e.g. S3." },
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

export const buildExtractionPrompt = (
  survey: Pick<Survey, "daily_experience_topic" | "questions">,
  students: AnonymizedResponse[],
) => ({
  system: [
    "You analyze middle-school students' survey answers about their daily experiences.",
    `The teacher's DAILY EXPERIENCE TOPIC for this survey is: "${survey.daily_experience_topic}". Focus on experiences relevant to that topic.`,
    "For each student, list at most two activities they describe (usually one from the first activity question and one from the second).",
    "involvement is \"do\" unless the student says they watch the activity or describes other people doing it; only then use \"watched\".",
    "Use the general activity name, not a specific game title, brand, team or position (\"Minecraft\" -> \"video games\", \"goalie\" -> \"soccer\"), and fix misspellings.",
    "Resolve ambiguous names from the details: \"football\" with kicking, goals, goalkeepers or goal posts is \"soccer\"; with touchdowns, quarterbacks or tackling pads it is \"american football\". Only write \"football\" if it is truly unclear.",
    "Write objects as lowercase singular nouns (\"pot\", not \"pots\").",
    "Write incidents in the third person (\"A player fell\", \"The pot boiled over\"), never \"I\" or personal names.",
    "If the same activity appears twice for a student, list it once, as \"do\" if they do it at all.",
    "Return an empty activities list for blank, refusal (\"idk\", \"nothing\") or off-topic answers. Never invent activities.",
    "Never include personal names in any field.",
    "Return every student id exactly once.",
    "",
    "Survey questions:",
    describeQuestions(survey),
  ].join("\n"),
  user: JSON.stringify({
    students: students.map((s) => ({ student: s.student, answers: answersByQuestion(survey, s.answers) })),
  }),
});

export const buildGroupingPrompt = (
  topic: string,
  labels: string[],
  existing: { category: string; activity: string }[] = [],
) => ({
  system: [
    "You group activity labels extracted from students' survey answers.",
    `The DAILY EXPERIENCE TOPIC is: "${topic}".`,
    "Assign every label a broad category and a specific activity name.",
    "Labels that are synonyms, regional names or misspellings of the same activity must share exactly the same category and activity name.",
    "Name activities at the general level a teacher would use for a classroom example: a sport, game type, hobby or chore, not a specific title, brand or variant (\"minecraft\" and \"racing games\" -> \"Video games\").",
    "Keep genuinely different activities separate (e.g. soccer and basketball are both Sports but different activities; cooking and baking may stay separate).",
    "Return one entry per input label, copying the label exactly.",
    ...(existing.length
      ? [
          "These activities are already in use for this survey. When a label is the same activity as one of them, reuse its category and activity name exactly:",
          ...existing.map((e) => `- ${e.category} / ${e.activity}`),
        ]
      : []),
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
 * Coerces one batch's extraction output: keeps only the requested students,
 * fills in any the model skipped as unclassified, and drops malformed fields.
 */
export const parseExtraction = (raw: unknown, students: string[]): StudentExtraction[] => {
  const byStudent = new Map<string, ExtractedActivity[]>();
  const rows = (raw as { students?: unknown })?.students;
  for (const row of Array.isArray(rows) ? rows : []) {
    const student = asString((row as { student?: unknown }).student);
    if (!students.includes(student) || byStudent.has(student)) continue;
    const activities = (row as { activities?: unknown }).activities;
    byStudent.set(
      student,
      (Array.isArray(activities) ? activities : [])
        .map((a) => ({
          label: asString(a?.label),
          involvement: a?.involvement === "watched" ? ("watched" as const) : ("do" as const),
          objects: Array.isArray(a?.objects) ? a.objects.map(asString).filter(Boolean) : [],
          incident: asString(a?.incident) || undefined,
        }))
        .filter((a) => normalizeLabel(a.label))
        .slice(0, 2),
    );
  }
  return students.map((student) => ({ student, activities: byStudent.get(student) ?? [] }));
};

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

const chunk = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

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
 * responses are sent for extraction (anonymized as S1..Sn, with names and
 * ids never sent); earlier students' results are reused. Only labels not
 * seen before are sent for grouping, along with the activities already in
 * use so new labels join existing groups. Counting is redone in code.
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
  const ask = async (prompt: { system: string; user: string }, format: ResponseFormatJSONSchema, step: string) => {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: format,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });
    return parseContent(completion.choices[0]?.message?.content, step);
  };

  const changed = responsesToAnalyze(responses, survey.survey_id, previous);
  const { anonymized, idMap } = anonymizeResponses(changed, survey.survey_id);
  const extracted = (
    await Promise.all(
      chunk(anonymized, EXTRACTION_BATCH_SIZE).map(async (batch) =>
        parseExtraction(
          await ask(buildExtractionPrompt(survey, batch), extractionFormat, "extraction"),
          batch.map((s) => s.student),
        ),
      ),
    )
  ).flat();

  // Keep earlier results only for students who still have a submitted response.
  const submitted = responses.filter((r) => r.survey_id === survey.survey_id && r.status === "submitted");
  const students: Record<string, StudentAnalysis> = {};
  for (const r of submitted) {
    const kept = previous?.students[r.student_id];
    if (kept && kept.response_updated_at === r.updated_at) students[r.student_id] = kept;
  }
  const updatedAtById = new Map(changed.map((r) => [r.student_id, r.updated_at]));
  for (const { student, activities } of extracted) {
    const studentId = idMap[student];
    students[studentId] = { response_updated_at: updatedAtById.get(studentId) ?? "", activities };
  }

  const grouping: LabelGrouping = { ...(previous?.grouping ?? {}) };
  const labels = [...new Set(Object.values(students).flatMap((s) => s.activities.map((a) => normalizeLabel(a.label))))];
  const newLabels = labels.filter((l) => !grouping[l]).sort();
  if (newLabels.length) {
    const existing = [...new Map(Object.values(grouping).map((g) => [`${g.category}\u0000${g.activity}`, g])).values()];
    Object.assign(
      grouping,
      parseGrouping(await ask(buildGroupingPrompt(survey.daily_experience_topic, newLabels, existing), groupingFormat, "grouping")),
    );
  }

  const extractions: StudentExtraction[] = Object.entries(students).map(([student, s]) => ({ student, activities: s.activities }));
  return {
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
