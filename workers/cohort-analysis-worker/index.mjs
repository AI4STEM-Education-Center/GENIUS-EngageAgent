import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { APIConnectionTimeoutError } from "openai";

const STRATEGY_REQUEST_TIMEOUT_MS = 45_000;
const STRATEGY_PLAN_CACHE_VERSION = 3;

const workerDir = path.dirname(fileURLToPath(import.meta.url));
const lessonDataDir = path.join(workerDir, "data");

const loadLessons = () => {
  try {
    return fs
      .readdirSync(lessonDataDir)
      .filter((fileName) => /^lesson\d+\.json$/i.test(fileName))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      .map((fileName) =>
        JSON.parse(
          fs.readFileSync(path.join(lessonDataDir, fileName), "utf8"),
        ),
      )
      .filter(
        (lesson) =>
          lesson &&
          typeof lesson === "object" &&
          typeof lesson.lesson_number === "number",
      );
  } catch (error) {
    console.warn(
      "cohort-analysis-worker lesson data unavailable",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
};

const lessons = loadLessons();

const getLesson = (lessonNumber) =>
  lessons.find((lesson) => lesson.lesson_number === lessonNumber) ?? null;

const splitMisconceptionCodes = (value) =>
  value
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean) ?? [];

const resolveMisconceptionText = (lesson, misconceptionCode) => {
  const codes = splitMisconceptionCodes(misconceptionCode);
  if (codes.length === 0) {
    return null;
  }

  return codes
    .map((code) => lesson.misconceptions?.[code] ?? code)
    .join("; ");
};

const getConfidenceText = (lesson, itemId, selectedOption) => {
  if (!selectedOption) {
    return null;
  }

  const confidenceItem = lesson.quiz_items?.find(
    (item) => item.item_id === `${itemId}_confidence`,
  );
  if (!confidenceItem) {
    return null;
  }

  return confidenceItem.options?.[selectedOption] ?? null;
};

const getLessonGenerationContext = (lessonNumber) => {
  const lesson = getLesson(lessonNumber);
  if (!lesson) {
    return null;
  }

  return {
    lessonNumber: lesson.lesson_number,
    lessonTitle: lesson.lesson_title,
    learningObjective: lesson.learning_objective,
  };
};

const resolveQuizEvidence = (lessonNumber, answers) => {
  const lesson = getLesson(lessonNumber);
  if (!lesson) {
    return [];
  }

  return (lesson.quiz_items ?? [])
    .filter((item) => item.type === "multiple_choice")
    .map((item) => {
      const selectedOption = answers?.[item.item_id]?.trim().toUpperCase() ?? null;
      const correctOption = item.correct_answer?.trim().toUpperCase() ?? null;
      const confidenceOption =
        answers?.[`${item.item_id}_confidence`]?.trim().toUpperCase() ?? null;
      const isCorrect =
        selectedOption && correctOption
          ? selectedOption === correctOption
          : null;
      const misconceptionCode =
        selectedOption && correctOption && selectedOption !== correctOption
          ? item.distractor_misconception_map?.[selectedOption] ??
            item.matched_misconception ??
            null
          : null;

      return {
        itemId: item.item_id,
        questionNumber: item.question_number,
        stem: item.stem,
        selectedOption,
        selectedText: selectedOption ? item.options?.[selectedOption] ?? null : null,
        correctOption,
        correctText: correctOption ? item.options?.[correctOption] ?? null : null,
        isCorrect,
        confidenceOption,
        confidenceText: getConfidenceText(
          lesson,
          item.item_id,
          confidenceOption,
        ),
        misconceptionCode,
        misconceptionText: resolveMisconceptionText(lesson, misconceptionCode),
      };
    });
};

const resolveSurveyEvidence = (lessonNumber, answers) => {
  const lesson = getLesson(lessonNumber);
  if (!lesson) {
    return [];
  }

  return (lesson.survey_items ?? [])
    .map((item) => ({
      itemId: item.item_id,
      questionNumber: item.question_number,
      category: item.category,
      stem: item.stem,
      responses: (item.response_fields ?? []).flatMap((field) => {
        const response = answers?.[field.field_id]?.trim();
        return response
          ? [{ fieldId: field.field_id, label: field.label, response }]
          : [];
      }),
    }))
    .filter((item) => item.responses.length > 0);
};

const buildPrompt = (student, lessonContext, quizEvidence, surveyEvidence) => ({
  system: `You are an education engagement planner.
Return JSON only with keys: name, strategy, relevance, overallRecommendation, recommendationReason, summary, tldr, rationale, tactics, cadence, checks.
The strategy must be exactly one of: cognitive conflict, analogy, experience bridging, engaged critiquing.
The relevance field is an object with those four strategies as keys and integer scores from 0-100.
Base the recommendation primarily on the student's quiz evidence: question text, selected response, confidence, correctness, and any linked misconception.
Use the beginning-of-lesson survey responses as qualitative context about the student's familiarity and experiences. Do not treat survey responses as correct or incorrect, and do not select experience bridging merely because the survey asks about experience.
Use the lesson learning objective as supplemental context, not as a substitute for the student's quiz evidence.
Make the recommendationReason reference the student by name and the assignment/topic.
For recommendationReason and rationale, cite 2+ concrete details from the available quiz and survey evidence and connect them directly to the chosen strategy.`,
  user: `Student name: ${student.name}
Assignment: ${lessonContext?.lessonTitle ?? student.assignment ?? "Not provided"}

${lessonContext ? `Lesson objective:\n${lessonContext.learningObjective}\n\n` : ""}Structured quiz evidence:
${quizEvidence.length > 0 ? JSON.stringify(quizEvidence, null, 2) : JSON.stringify(student.answers ?? {}, null, 2)}

Beginning-of-lesson survey evidence:
${surveyEvidence.length > 0 ? JSON.stringify(surveyEvidence, null, 2) : "No survey responses submitted."}

Return a plan:
- name: short label
- strategy: one of [cognitive conflict, analogy, experience bridging, engaged critiquing]
- relevance: scores 0-100 for each strategy
- overallRecommendation: 1-2 sentences, teacher-facing
- recommendationReason: 2-3 sentences explaining why this strategy fits ${student.name}; reference the assignment/topic and cite 2+ specific details from the available quiz and survey evidence
- summary: 1 sentence
- tldr: 8-14 words, teacher-facing
- rationale: 3-5 sentences; reference the assignment/topic and include at least one concrete in-class example of how the teacher would use the strategy with ${student.name}
- tactics: 3-5 bullets
- cadence: short phrase
- checks: 1-3 quick checks`,
});

const normalizeStrategy = (strategy) => String(strategy ?? "").trim().toLowerCase();

const ensurePlanFields = (plan) => {
  if (!plan.relevance || typeof plan.relevance !== "object") {
    plan.relevance = {};
  }

  const keys = [
    "cognitive conflict",
    "analogy",
    "experience bridging",
    "engaged critiquing",
  ];

  keys.forEach((key) => {
    if (typeof plan.relevance[key] !== "number") {
      plan.relevance[key] = key === plan.strategy ? 100 : 0;
    }
  });

  if (!plan.overallRecommendation) {
    plan.overallRecommendation = plan.summary || "Provide a focused strategy.";
  }

  if (!plan.recommendationReason) {
    plan.recommendationReason = plan.rationale || "Aligned to student responses.";
  }

  if (!plan.tldr) {
    plan.tldr = plan.summary || "Use the recommended strategy.";
  }

  return plan;
};

const parseJson = (value) => {
  if (!value) {
    throw new Error("LLM returned empty response.");
  }

  return JSON.parse(value);
};

const isRecord = (value) => typeof value === "object" && value !== null;

const serializeCachedPlan = (plan, lessonNumber) =>
  JSON.stringify({
    promptVersion: STRATEGY_PLAN_CACHE_VERSION,
    lessonNumber: typeof lessonNumber === "number" ? lessonNumber : null,
    plan,
  });

const deserializeCachedPlan = (planJson, options = {}) => {
  const parsed = JSON.parse(planJson);

  if (isRecord(parsed) && "promptVersion" in parsed && "plan" in parsed) {
    const promptVersion =
      typeof parsed.promptVersion === "number" ? parsed.promptVersion : null;
    if (promptVersion !== STRATEGY_PLAN_CACHE_VERSION) {
      return null;
    }

    if (
      typeof options.lessonNumber === "number" &&
      parsed.lessonNumber !== options.lessonNumber
    ) {
      return null;
    }

    return parsed.plan;
  }

  if (options.requireVersionMatch) {
    return null;
  }

  return parsed;
};

const isTimeoutError = (error) =>
  error instanceof APIConnectionTimeoutError ||
  (error instanceof Error &&
    (error.constructor.name === "APIConnectionTimeoutError" ||
      error.message === "Request timed out."));

const elapsedMs = (startedAt) => Math.round(performance.now() - startedAt);

const nowIso = () => new Date().toISOString();

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const tableName = requireEnv("DYNAMODB_TABLE");
const region =
  process.env.ENGAGE_AWS_REGION ??
  process.env.AWS_REGION ??
  process.env.AWS_DEFAULT_REGION ??
  "us-east-2";
const awsAccessKeyId =
  process.env.ENGAGE_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
const awsSecretAccessKey =
  process.env.ENGAGE_AWS_SECRET_ACCESS_KEY ??
  process.env.AWS_SECRET_ACCESS_KEY;

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region,
    ...(awsAccessKeyId &&
      awsSecretAccessKey && {
        credentials: {
          accessKeyId: awsAccessKeyId,
          secretAccessKey: awsSecretAccessKey,
        },
      }),
  }),
  {
    marshallOptions: { removeUndefinedValues: true },
  },
);

const openai = new OpenAI({
  apiKey: requireEnv("OPENAI_API_KEY"),
  timeout: STRATEGY_REQUEST_TIMEOUT_MS,
  maxRetries: 0,
});

const getCachedPlanJson = async (classId, assignmentId, studentId) => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        class_id: `CLASS#${classId}`,
        record_id: `PLAN#ASSIGN#${assignmentId}#STUDENT#${studentId}#LATEST`,
      },
    }),
  );

  return result.Item?.plan_json ?? null;
};

const upsertCachedPlanJson = async (classId, assignmentId, studentId, planJson) => {
  await dynamo.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        class_id: `CLASS#${classId}`,
        record_id: `PLAN#ASSIGN#${assignmentId}#STUDENT#${studentId}#LATEST`,
        record_type: "plan_cache",
        assignment_id: assignmentId,
        student_id: `STUDENT#${studentId}`,
        student_record_id: `PLAN#ASSIGN#${assignmentId}#LATEST`,
        plan_json: planJson,
        updated_at: nowIso(),
      },
    }),
  );
};

const jobPk = (jobId) => `JOB#${jobId}`;

const updateJobMeta = async ({
  jobId,
  classId,
  assignmentId,
  totalStudents,
  completedDelta,
  failedDelta,
}) => {
  const timestamp = nowIso();
  const result = await dynamo.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        class_id: jobPk(jobId),
        record_id: "META",
      },
      UpdateExpression: `SET record_type = :recordType,
          source_class_id = :classId,
          source_assignment_id = :assignmentId,
          total_students = if_not_exists(total_students, :totalStudents),
          created_at = if_not_exists(created_at, :createdAt),
          updated_at = :updatedAt
        ADD processed_students :processedDelta,
          completed_students :completedDelta,
          failed_students :failedDelta`,
      ExpressionAttributeValues: {
        ":recordType": "cohort_job",
        ":classId": classId,
        ":assignmentId": assignmentId,
        ":totalStudents": totalStudents,
        ":createdAt": timestamp,
        ":updatedAt": timestamp,
        ":processedDelta": 1,
        ":completedDelta": completedDelta,
        ":failedDelta": failedDelta,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  const attributes = result.Attributes ?? {};
  const processedStudents = Number(attributes.processed_students ?? 0);
  const total = Number(attributes.total_students ?? totalStudents);
  const failedStudents = Number(attributes.failed_students ?? 0);

  if (processedStudents >= total && total > 0) {
    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          class_id: jobPk(jobId),
          record_id: "META",
        },
        UpdateExpression: "SET #status = :status, updated_at = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": failedStudents > 0 ? "completed_with_errors" : "completed",
          ":updatedAt": nowIso(),
        },
      }),
    );
  } else {
    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          class_id: jobPk(jobId),
          record_id: "META",
        },
        UpdateExpression: "SET #status = :status, updated_at = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": "running",
          ":updatedAt": nowIso(),
        },
      }),
    );
  }
};

const putStudentResult = async ({
  jobId,
  classId,
  assignmentId,
  student,
  status,
  plan,
  source,
  timing,
  error,
}) => {
  await dynamo.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        class_id: jobPk(jobId),
        record_id: `STUDENT#${student.id}`,
        record_type: "cohort_job_student",
        source_class_id: classId,
        source_assignment_id: assignmentId,
        student_id: student.id,
        student_name: student.name,
        status,
        source: source ?? null,
        plan_json: plan ? JSON.stringify(plan) : undefined,
        timing,
        error: error ?? undefined,
        updated_at: nowIso(),
      },
    }),
  );
};

const normalizeLessonNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const validateMessage = (payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Message body must be an object.");
  }

  const {
    jobId,
    classId,
    assignmentId,
    lessonNumber,
    forceRefresh,
    student,
    totalStudents,
  } = payload;
  if (!jobId || !classId || !assignmentId) {
    throw new Error("jobId, classId, and assignmentId are required.");
  }

  if (!student || typeof student !== "object") {
    throw new Error("student is required.");
  }

  if (!student.id || !student.name) {
    throw new Error("student.id and student.name are required.");
  }

  return {
    jobId,
    classId,
    assignmentId,
    lessonNumber: normalizeLessonNumber(lessonNumber),
    forceRefresh: forceRefresh === true,
    totalStudents: Number(totalStudents ?? 1),
    student,
  };
};

const processRecord = async (record) => {
  const startedAt = performance.now();
  const payload = validateMessage(JSON.parse(record.body ?? "{}"));
  const {
    jobId,
    classId,
    assignmentId,
    lessonNumber,
    forceRefresh,
    totalStudents,
    student,
  } =
    payload;

  let source = "model";
  let cacheReadMs = 0;
  let modelMs = 0;
  let cacheWriteMs = 0;
  const lessonContext =
    typeof lessonNumber === "number"
      ? getLessonGenerationContext(lessonNumber)
      : null;

  if (typeof lessonNumber === "number" && !lessonContext) {
    throw new Error(`Lesson ${lessonNumber} not found.`);
  }

  try {
    const cacheReadStartedAt = performance.now();
    let cachedPlanJson = null;
    try {
      if (!forceRefresh) {
        cachedPlanJson = await getCachedPlanJson(
          classId,
          assignmentId,
          student.id,
        );
      }
    } finally {
      cacheReadMs = elapsedMs(cacheReadStartedAt);
    }

    let plan;
    if (cachedPlanJson) {
      const parsed = deserializeCachedPlan(cachedPlanJson, {
        lessonNumber: lessonContext?.lessonNumber,
        requireVersionMatch: lessonContext !== null,
      });
      if (parsed) {
        source = "cache";
        parsed.strategy = normalizeStrategy(parsed.strategy);
        plan = ensurePlanFields(parsed);
      }
    }

    if (!plan) {
      const prompt = buildPrompt(
        student,
        lessonContext,
        typeof lessonNumber === "number"
          ? resolveQuizEvidence(lessonNumber, student.answers)
          : [],
        typeof lessonNumber === "number"
          ? resolveSurveyEvidence(lessonNumber, student.answers)
          : [],
      );
      const completion = await (async () => {
        const modelStartedAt = performance.now();
        try {
          return await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL ?? "gpt-5-nano",
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
          });
        } finally {
          modelMs = elapsedMs(modelStartedAt);
        }
      })();

      const parsed = parseJson(completion.choices[0]?.message?.content);
      parsed.strategy = normalizeStrategy(parsed.strategy);
      plan = ensurePlanFields(parsed);

      const cacheWriteStartedAt = performance.now();
      try {
        await upsertCachedPlanJson(
          classId,
          assignmentId,
          student.id,
          serializeCachedPlan(plan, lessonContext?.lessonNumber),
        );
      } finally {
        cacheWriteMs = elapsedMs(cacheWriteStartedAt);
      }
    }

    const timing = {
      cacheReadMs,
      modelMs,
      cacheWriteMs,
      totalMs: elapsedMs(startedAt),
      timedOut: false,
    };

    await putStudentResult({
      jobId,
      classId,
      assignmentId,
      student,
      status: "completed",
      source,
      plan,
      timing,
    });

    await updateJobMeta({
      jobId,
      classId,
      assignmentId,
      totalStudents,
      completedDelta: 1,
      failedDelta: 0,
    });

    console.info(
      "cohort-analysis-worker success",
      JSON.stringify({
        jobId,
        classId,
        assignmentId,
        lessonNumber,
        forceRefresh,
        studentId: student.id,
        source,
        timing,
      }),
    );
  } catch (error) {
    const timing = {
      cacheReadMs,
      modelMs,
      cacheWriteMs,
      totalMs: elapsedMs(startedAt),
      timedOut: isTimeoutError(error),
    };
    const message =
      isTimeoutError(error)
        ? "Strategy generation timed out before the model returned."
        : error instanceof Error
          ? error.message
          : "Failed to analyze student.";

    await putStudentResult({
      jobId: payload.jobId,
      classId: payload.classId,
      assignmentId: payload.assignmentId,
      student: payload.student,
      status: "failed",
      source,
      timing,
      error: message,
    });

    await updateJobMeta({
      jobId: payload.jobId,
      classId: payload.classId,
      assignmentId: payload.assignmentId,
      totalStudents: payload.totalStudents,
      completedDelta: 0,
      failedDelta: 1,
    });

    console.error(
      "cohort-analysis-worker failure",
      JSON.stringify({
        jobId: payload.jobId,
        classId: payload.classId,
        assignmentId: payload.assignmentId,
        lessonNumber: payload.lessonNumber,
        forceRefresh: payload.forceRefresh,
        studentId: payload.student.id,
        error: message,
        timing,
      }),
    );

    throw error;
  }
};

export const handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records ?? []) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error(
        "cohort-analysis-worker record failure",
        JSON.stringify({
          messageId: record.messageId ?? null,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      if (record.messageId) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
  }

  return {
    batchItemFailures,
  };
};
