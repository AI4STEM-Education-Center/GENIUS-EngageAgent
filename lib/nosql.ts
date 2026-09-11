import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DYNAMODB_MAX_ITEM_BYTES = 400_000;

type StrategyCacheRecord = {
  class_id?: string;
  assignment_id?: string;
  student_id?: string;
  plan_json: string;
  updated_at: string;
};

type MediaVersion = {
  data_url?: string;
  s3_bucket?: string;
  s3_key?: string;
  refinement_prompt?: string;
  created_at: string;
};

type MediaRecord = {
  media_id: string;
  content_item_id: string;
  media_type: "image" | "video";
  mime_type: string;
  data_url?: string;
  s3_bucket?: string;
  s3_key?: string;
  class_id: string;
  assignment_id: string;
  student_id: string;
  created_at: string;
  versions?: MediaVersion[];
  active_version?: number;
};

type QuizStatusRecord = {
  class_id: string;
  assignment_id: string;
  lesson_number: number;
  status: "draft" | "published" | "closed";
  published_by?: string;
  updated_at: string;
};

type StudentAnswerRecord = {
  class_id: string;
  assignment_id: string;
  student_id: string;
  student_name: string;
  lesson_number: number;
  answers: Record<string, string>;
  submitted_at: string;
};

type ContentPublishRecord = {
  class_id: string;
  assignment_id: string;
  content_item_id: string;
  content_json: string;
  published: boolean;
  published_at: string;
  published_by: string;
};

type ContentRatingRecord = {
  class_id: string;
  assignment_id: string;
  student_id: string;
  content_item_id: string;
  rating: number;
  rated_at: string;
};

export type CohortJobRecord = {
  job_id: string;
  class_id: string;
  assignment_id: string;
  total_students: number;
  processed_students: number;
  completed_students: number;
  failed_students: number;
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed_to_queue";
  error_message?: string;
  created_at: string;
  updated_at: string;
};

export type CohortJobStudentRecord = {
  job_id: string;
  class_id: string;
  assignment_id: string;
  student_id: string;
  student_name: string;
  status: "completed" | "failed";
  source?: "cache" | "model" | null;
  plan_json?: string;
  timing?: Record<string, unknown>;
  error?: string;
  updated_at: string;
};

type Store = {
  strategy_cache: Record<string, StrategyCacheRecord>;
  teacher_annotations: TeacherAnnotation[];
  media: MediaRecord[];
  quiz_status: QuizStatusRecord[];
  student_answers: StudentAnswerRecord[];
  content_publish: ContentPublishRecord[];
  content_ratings: ContentRatingRecord[];
  cohort_jobs: CohortJobRecord[];
  cohort_job_students: CohortJobStudentRecord[];
};

type TeacherAnnotation = {
  workspace_class_id?: string;
  annotation_id: string;
  student_name?: string | null;
  assignment?: string | null;
  overall_recommendation: string;
  recommendation_reason?: string | null;
  decision: "agree" | "disagree";
  reason?: string | null;
  ai_plan: Record<string, unknown>;
  selected_strategies: string[];
  answers: Record<string, string | undefined>;
  created_at: string;
};

export type TeacherAnnotationInput = Omit<
  TeacherAnnotation,
  "annotation_id" | "created_at"
>;

const emptyStore: Store = {
  strategy_cache: {},
  teacher_annotations: [],
  media: [],
  quiz_status: [],
  student_answers: [],
  content_publish: [],
  content_ratings: [],
  cohort_jobs: [],
  cohort_job_students: [],
};
const dataDir = path.join(process.cwd(), "data");
const storePath = path.join(dataDir, "engage-nosql.json");

const DEFAULT_ENGAGE_AWS_REGION = "us-east-2";

const useDynamoDb = Boolean(process.env.DYNAMODB_TABLE);
const dynamoRegion = process.env.ENGAGE_AWS_REGION ?? DEFAULT_ENGAGE_AWS_REGION;
const dynamoTableName = process.env.DYNAMODB_TABLE ?? "";
const dynamoAccessKeyId = process.env.ENGAGE_AWS_ACCESS_KEY_ID;
const dynamoSecretAccessKey = process.env.ENGAGE_AWS_SECRET_ACCESS_KEY;
const s3Bucket = process.env.ENGAGE_S3_BUCKET;
const s3Region = process.env.ENGAGE_AWS_REGION ?? process.env.AWS_REGION ?? DEFAULT_ENGAGE_AWS_REGION;

const toPlainStudentId = (value: string | undefined, fallback = "") =>
  value?.replace(/^STUDENT#/, "") ?? fallback;

let s3Client: S3Client | null = null;

const getS3Client = () => {
  if (!s3Bucket) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: s3Region,
      ...(dynamoAccessKeyId &&
        dynamoSecretAccessKey && {
          credentials: {
            accessKeyId: dynamoAccessKeyId,
            secretAccessKey: dynamoSecretAccessKey,
          },
        }),
    });
  }
  return s3Client;
};
const pkField = "class_id";
const skField = "record_id";
const gsiTeacherPkField = "teacher_id";
const gsiTeacherSkField = "teacher_record_id";
const gsiStudentPkField = "student_id";
const gsiStudentSkField = "student_record_id";

let storeCache: Store | null = null;
let loadPromise: Promise<Store> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

let dynamoDocClient: DynamoDBDocumentClient | null = null;

const getDynamoClient = () => {
  if (!useDynamoDb) {
    return null;
  }
  if (!dynamoTableName) {
    throw new Error("DYNAMODB_TABLE is required when using DynamoDB.");
  }
  if (!dynamoDocClient) {
    const client = new DynamoDBClient({
      region: dynamoRegion,
      ...(dynamoAccessKeyId &&
        dynamoSecretAccessKey && {
          credentials: {
            accessKeyId: dynamoAccessKeyId,
            secretAccessKey: dynamoSecretAccessKey,
          },
        }),
    });
    dynamoDocClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return dynamoDocClient;
};

const ensureDataDir = async () => {
  if (!fs.existsSync(dataDir)) {
    await fs.promises.mkdir(dataDir, { recursive: true });
  }
};

const loadStore = async () => {
  if (storeCache) {
    return storeCache;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      await ensureDataDir();
      if (!fs.existsSync(storePath)) {
        await fs.promises.writeFile(
          storePath,
          `${JSON.stringify(emptyStore, null, 2)}\n`,
        );
      }
      const raw = await fs.promises.readFile(storePath, "utf-8");
      const parsed = JSON.parse(raw) as Store;
      if (!parsed.strategy_cache || typeof parsed.strategy_cache !== "object") {
        throw new Error("Invalid NoSQL store format.");
      }
      if (!Array.isArray(parsed.teacher_annotations)) {
        parsed.teacher_annotations = [];
      }
      if (!Array.isArray(parsed.media)) {
        parsed.media = [];
      }
      if (!Array.isArray(parsed.quiz_status)) {
        parsed.quiz_status = [];
      }
      if (!Array.isArray(parsed.student_answers)) {
        parsed.student_answers = [];
      }
      if (!Array.isArray(parsed.content_publish)) {
        parsed.content_publish = [];
      }
      if (!Array.isArray(parsed.content_ratings)) {
        parsed.content_ratings = [];
      }
      if (!Array.isArray(parsed.cohort_jobs)) {
        parsed.cohort_jobs = [];
      }
      if (!Array.isArray(parsed.cohort_job_students)) {
        parsed.cohort_job_students = [];
      }
      storeCache = parsed;
      return parsed;
    })();
  }
  const result = await loadPromise;
  loadPromise = null;
  return result;
};

const persistStore = async (store: Store) => {
  await fs.promises.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
  storeCache = store;
};

const withWriteLock = async <T>(fn: () => Promise<T>) => {
  const task = writeQueue.then(fn, fn);
  writeQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
};

export const getCachedPlanJson = async (
  classId: string,
  assignmentId: string,
  studentId: string,
) => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) {
      return null;
    }
    const result = await client.send(
      new GetCommand({
        TableName: dynamoTableName,
        Key: {
          [pkField]: `CLASS#${classId}`,
          [skField]: `PLAN#ASSIGN#${assignmentId}#STUDENT#${studentId}#LATEST`,
        },
      }),
    );
    return (result.Item?.plan_json as string | undefined) ?? null;
  }

  const store = await loadStore();
  const key = classId.startsWith("ea-class-") ? JSON.stringify([classId, assignmentId, studentId]) : studentId;
  return store.strategy_cache[key]?.plan_json ?? null;
};

export const upsertCachedPlanJson = async (
  classId: string,
  assignmentId: string,
  studentId: string,
  planJson: string,
) => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) {
      return;
    }
    const updatedAt = new Date().toISOString();
    await client.send(
      new PutCommand({
        TableName: dynamoTableName,
        Item: {
          [pkField]: `CLASS#${classId}`,
          [skField]: `PLAN#ASSIGN#${assignmentId}#STUDENT#${studentId}#LATEST`,
          record_type: "plan_cache",
          assignment_id: assignmentId,
          [gsiStudentPkField]: `STUDENT#${studentId}`,
          [gsiStudentSkField]: `PLAN#ASSIGN#${assignmentId}#LATEST`,
          plan_json: planJson,
          updated_at: updatedAt,
        },
      }),
    );
    return;
  }

  await withWriteLock(async () => {
    const store = await loadStore();
    const native = classId.startsWith("ea-class-");
    const key = native ? JSON.stringify([classId, assignmentId, studentId]) : studentId;
    store.strategy_cache[key] = {
      ...(native ? { class_id: classId, assignment_id: assignmentId, student_id: studentId } : {}),
      plan_json: planJson,
      updated_at: new Date().toISOString(),
    };
    await persistStore(store);
  });
};

export type CachedPlanRecord = {
  student_id: string;
  assignment_id: string;
  class_id: string;
  plan_json: string;
  updated_at: string;
};

/**
 * List all cached plans for a given class + session.
 * Optionally filter to a single student.
 */
export const listCachedPlans = async (
  classId: string,
  assignmentId: string,
  studentId?: string,
): Promise<CachedPlanRecord[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) {
      return [];
    }

    if (studentId) {
      const result = await client.send(
        new GetCommand({
          TableName: dynamoTableName,
          Key: {
            [pkField]: `CLASS#${classId}`,
            [skField]: `PLAN#ASSIGN#${assignmentId}#STUDENT#${studentId}#LATEST`,
          },
        }),
      );
      if (!result.Item?.plan_json) {
        return [];
      }
      const raw = result.Item.student_id as string;
      const plain = raw?.replace(/^STUDENT#/, "") ?? studentId;
      return [
        {
          student_id: plain,
          assignment_id: (result.Item.assignment_id as string) ?? assignmentId,
          class_id: classId,
          plan_json: result.Item.plan_json as string,
          updated_at: (result.Item.updated_at as string) ?? "",
        },
      ];
    }

    const result = await client.send(
      new QueryCommand({
        TableName: dynamoTableName,
        KeyConditionExpression:
          "#pk = :pk AND begins_with(#sk, :skPrefix)",
        ExpressionAttributeNames: {
          "#pk": pkField,
          "#sk": skField,
        },
        ExpressionAttributeValues: {
          ":pk": `CLASS#${classId}`,
          ":skPrefix": `PLAN#ASSIGN#${assignmentId}#STUDENT#`,
        },
      }),
    );

    return (result.Items ?? [])
      .filter((item) => item.record_type === "plan_cache" && item.plan_json)
      .map((item) => ({
        student_id: toPlainStudentId(item.student_id as string) ||
          (item.student_id as string) ||
          "",
        assignment_id: (item.assignment_id as string) ?? assignmentId,
        class_id: classId,
        plan_json: item.plan_json as string,
        updated_at: (item.updated_at as string) ?? "",
      }));
  }

  // Local JSON fallback
  const store = await loadStore();
  const records: CachedPlanRecord[] = [];
  for (const [sid, record] of Object.entries(store.strategy_cache)) {
    if (classId.startsWith("ea-class-") && (record.class_id !== classId || record.assignment_id !== assignmentId)) continue;
    if (!classId.startsWith("ea-class-") && record.class_id?.startsWith("ea-class-")) continue;
    const studentKey = record.student_id || sid;
    if (studentId && studentKey !== studentId) {
      continue;
    }
    records.push({
      student_id: studentKey,
      assignment_id: assignmentId,
      class_id: classId,
      plan_json: record.plan_json,
      updated_at: record.updated_at,
    });
  }
  return records;
};

const jobPk = (jobId: string) => `JOB#${jobId}`;

const normalizeCohortJob = (
  jobId: string,
  item: Record<string, unknown>,
): CohortJobRecord => ({
  job_id: jobId,
  class_id: (item.source_class_id as string) ?? "",
  assignment_id: (item.source_assignment_id as string) ?? "",
  total_students: Number(item.total_students ?? 0),
  processed_students: Number(item.processed_students ?? 0),
  completed_students: Number(item.completed_students ?? 0),
  failed_students: Number(item.failed_students ?? 0),
  status: ((item.status as string) ??
    "queued") as CohortJobRecord["status"],
  error_message: (item.error_message as string) ?? undefined,
  created_at: (item.created_at as string) ?? "",
  updated_at: (item.updated_at as string) ?? "",
});

const normalizeCohortJobStudent = (
  jobId: string,
  item: Record<string, unknown>,
): CohortJobStudentRecord => ({
  job_id: jobId,
  class_id: (item.source_class_id as string) ?? "",
  assignment_id: (item.source_assignment_id as string) ?? "",
  student_id: toPlainStudentId(item.student_id as string, item.student_id as string),
  student_name: (item.student_name as string) ?? "",
  status: ((item.status as string) ??
    "failed") as CohortJobStudentRecord["status"],
  source: ((item.source as string) ?? null) as CohortJobStudentRecord["source"],
  plan_json: (item.plan_json as string) ?? undefined,
  timing: (item.timing as Record<string, unknown>) ?? undefined,
  error: (item.error as string) ?? undefined,
  updated_at: (item.updated_at as string) ?? "",
});

export const createCohortJob = async (
  jobId: string,
  classId: string,
  assignmentId: string,
  totalStudents: number,
): Promise<CohortJobRecord> => {
  const timestamp = new Date().toISOString();
  const record: CohortJobRecord = {
    job_id: jobId,
    class_id: classId,
    assignment_id: assignmentId,
    total_students: totalStudents,
    processed_students: 0,
    completed_students: 0,
    failed_students: 0,
    status: "queued",
    created_at: timestamp,
    updated_at: timestamp,
  };

  if (useDynamoDb) {
    const client = getDynamoClient();
    if (client) {
      await client.send(
        new PutCommand({
          TableName: dynamoTableName,
          Item: {
            [pkField]: jobPk(jobId),
            [skField]: "META",
            record_type: "cohort_job",
            source_class_id: classId,
            source_assignment_id: assignmentId,
            total_students: totalStudents,
            processed_students: 0,
            completed_students: 0,
            failed_students: 0,
            status: "queued",
            created_at: timestamp,
            updated_at: timestamp,
          },
        }),
      );
    }
    return record;
  }

  await withWriteLock(async () => {
    const store = await loadStore();
    const nextJobs = store.cohort_jobs.filter((job) => job.job_id !== jobId);
    nextJobs.push(record);
    store.cohort_jobs = nextJobs;
    await persistStore(store);
  });

  return record;
};

export const setCohortJobStatus = async (
  jobId: string,
  status: CohortJobRecord["status"],
  errorMessage?: string,
) => {
  const updatedAt = new Date().toISOString();

  if (useDynamoDb) {
    const client = getDynamoClient();
    if (client) {
      const current = await getCohortJob(jobId);
      if (!current.job) {
        return null;
      }
      const nextJob: CohortJobRecord = {
        ...current.job,
        status,
        ...(errorMessage ? { error_message: errorMessage } : {}),
        updated_at: updatedAt,
      };
      await client.send(
        new PutCommand({
          TableName: dynamoTableName,
          Item: {
            [pkField]: jobPk(jobId),
            [skField]: "META",
            record_type: "cohort_job",
            source_class_id: nextJob.class_id,
            source_assignment_id: nextJob.assignment_id,
            total_students: nextJob.total_students,
            processed_students: nextJob.processed_students,
            completed_students: nextJob.completed_students,
            failed_students: nextJob.failed_students,
            status: nextJob.status,
            error_message: nextJob.error_message,
            created_at: nextJob.created_at,
            updated_at: nextJob.updated_at,
          },
        }),
      );
      return nextJob;
    }
    return null;
  }

  let nextJob: CohortJobRecord | null = null;
  await withWriteLock(async () => {
    const store = await loadStore();
    const index = store.cohort_jobs.findIndex((job) => job.job_id === jobId);
    if (index < 0) {
      return;
    }
    nextJob = {
      ...store.cohort_jobs[index],
      status,
      ...(errorMessage ? { error_message: errorMessage } : {}),
      updated_at: updatedAt,
    };
    store.cohort_jobs[index] = nextJob;
    await persistStore(store);
  });
  return nextJob;
};

export const getCohortJob = async (
  jobId: string,
): Promise<{ job: CohortJobRecord | null; students: CohortJobStudentRecord[] }> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) {
      return { job: null, students: [] };
    }

    const result = await client.send(
      new QueryCommand({
        TableName: dynamoTableName,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: {
          "#pk": pkField,
        },
        ExpressionAttributeValues: {
          ":pk": jobPk(jobId),
        },
      }),
    );

    let job: CohortJobRecord | null = null;
    const students: CohortJobStudentRecord[] = [];

    for (const item of result.Items ?? []) {
      if (item.record_type === "cohort_job") {
        job = normalizeCohortJob(jobId, item);
        continue;
      }
      if (item.record_type === "cohort_job_student") {
        students.push(normalizeCohortJobStudent(jobId, item));
      }
    }

    return { job, students };
  }

  const store = await loadStore();
  return {
    job: store.cohort_jobs.find((record) => record.job_id === jobId) ?? null,
    students: store.cohort_job_students.filter((record) => record.job_id === jobId),
  };
};

export const recordTeacherAnnotation = async (
  input: TeacherAnnotationInput,
) => {
  const createdAt = new Date().toISOString();
  const annotationId = crypto.randomUUID();
  const record: TeacherAnnotation = {
    annotation_id: annotationId,
    created_at: createdAt,
    ...input,
  };

  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) {
      return record;
    }
    const partition = "ANNOTATIONS";
    await client.send(
      new PutCommand({
        TableName: dynamoTableName,
        Item: {
          record_type: "teacher_annotation",
          // Use a stable partition since UI no longer collects IDs.
          [pkField]: `CLASS#${partition}`,
          [skField]: `ANNOTATION#${annotationId}`,
          ...record,
        },
      }),
    );
    return record;
  }

  await withWriteLock(async () => {
    const store = await loadStore();
    store.teacher_annotations.push(record);
    await persistStore(store);
  });

  return record;
};

/* ------------------------------------------------------------------ */
/*  Media storage (images & videos)                                    */
/* ------------------------------------------------------------------ */

export type UpsertMediaInput = {
  classId: string;
  assignmentId: string;
  studentId: string;
  contentItemId: string;
  mediaType: "image" | "video";
  mimeType: string;
  dataUrl: string;
  refinementPrompt?: string;
};

const mediaExt = (mime: string) =>
  mime.includes("webp") ? "webp" : mime.includes("mp4") ? "mp4" : "bin";

/**
 * Store (or replace) a generated image/video for a specific content item.
 * Key: classId + assignmentId + studentId + contentItemId + mediaType
 * When using DynamoDB: stores in S3 if ENGAGE_S3_BUCKET is set (avoids 400KB limit).
 */
export const upsertMedia = async (input: UpsertMediaInput) => {
  const {
    classId,
    assignmentId,
    studentId,
    contentItemId,
    mediaType,
    mimeType,
    dataUrl,
    refinementPrompt,
  } = input;
  const mediaId = `${classId}_${assignmentId}_${studentId}_${contentItemId}_${mediaType}`;
  const createdAt = new Date().toISOString();
  const MAX_VERSIONS = 10;

  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) {
      return { media_id: mediaId, content_item_id: contentItemId, media_type: mediaType, mime_type: mimeType, class_id: classId, assignment_id: assignmentId, student_id: studentId, created_at: createdAt };
    }

    const pk = `CLASS#${classId}`;
    const sk = `MEDIA#ASSIGN#${assignmentId}#STUDENT#${studentId}#ITEM#${contentItemId}#${mediaType.toUpperCase()}`;

    // Load existing record to preserve version history
    const existing = await client.send(new GetCommand({ TableName: dynamoTableName, Key: { [pkField]: pk, [skField]: sk } }));
    const existingVersions: MediaVersion[] = (existing.Item?.versions as MediaVersion[] | undefined) ?? [];
    // Monotonic counter to avoid S3 key collisions when MAX_VERSIONS caps old entries
    const versionCounter = ((existing.Item?.version_counter as number) ?? existingVersions.length);

    const s3 = getS3Client();
    if (s3 && s3Bucket) {
      try {
        const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
        const body = base64Match
          ? Buffer.from(base64Match[1], "base64")
          : Buffer.from(dataUrl, "utf-8");
        const ext = mediaExt(mimeType);
        const s3Key = `media/${classId}/${assignmentId}/${studentId}/${contentItemId}_${mediaType}_v${versionCounter}.${ext}`;

        await s3.send(
          new PutObjectCommand({ Bucket: s3Bucket, Key: s3Key, Body: body, ContentType: mimeType }),
        );

        const newVersion: MediaVersion = { s3_bucket: s3Bucket, s3_key: s3Key, refinement_prompt: refinementPrompt, created_at: createdAt };
        const allVersions = [...existingVersions, newVersion];
        const cappedVersions = allVersions.length > MAX_VERSIONS ? allVersions.slice(allVersions.length - MAX_VERSIONS) : allVersions;
        const activeVersion = cappedVersions.length - 1;

        await client.send(
          new PutCommand({
            TableName: dynamoTableName,
            Item: {
              [pkField]: pk, [skField]: sk,
              record_type: "media", assignment_id: assignmentId,
              [gsiStudentPkField]: `STUDENT#${studentId}`,
              [gsiStudentSkField]: `MEDIA#ASSIGN#${assignmentId}#ITEM#${contentItemId}#${mediaType.toUpperCase()}`,
              media_id: mediaId, content_item_id: contentItemId,
              media_type: mediaType, mime_type: mimeType,
              s3_bucket: s3Bucket, s3_key: s3Key,
              versions: cappedVersions, active_version: activeVersion,
              version_counter: versionCounter + 1,
              created_at: createdAt,
            },
          }),
        );
        return { media_id: mediaId, content_item_id: contentItemId, media_type: mediaType, mime_type: mimeType, s3_bucket: s3Bucket, s3_key: s3Key, class_id: classId, assignment_id: assignmentId, student_id: studentId, created_at: createdAt, versions: cappedVersions, active_version: activeVersion };
      } catch (error) {
        console.error(`Failed to store ${mediaType} ${mediaId} in S3. Falling back to DynamoDB inline storage.`, error);
      }
    }

    // No S3: only persist if under DynamoDB limit
    const itemSize = new TextEncoder().encode(JSON.stringify({ data_url: dataUrl })).length;
    if (itemSize > DYNAMODB_MAX_ITEM_BYTES) {
      console.warn(
        `Media ${mediaId} exceeds DynamoDB 400KB limit (${Math.round(itemSize / 1024)}KB). Set ENGAGE_S3_BUCKET to store in S3.`,
      );
      return { media_id: mediaId, content_item_id: contentItemId, media_type: mediaType, mime_type: mimeType, class_id: classId, assignment_id: assignmentId, student_id: studentId, created_at: createdAt };
    }

    const newVersion: MediaVersion = { data_url: dataUrl, refinement_prompt: refinementPrompt, created_at: createdAt };
    const allVersions = [...existingVersions, newVersion];
    const cappedVersions = allVersions.length > MAX_VERSIONS ? allVersions.slice(allVersions.length - MAX_VERSIONS) : allVersions;
    const activeVersion = cappedVersions.length - 1;

    await client.send(
      new PutCommand({
        TableName: dynamoTableName,
        Item: {
          [pkField]: pk, [skField]: sk,
          record_type: "media", assignment_id: assignmentId,
          [gsiStudentPkField]: `STUDENT#${studentId}`,
          [gsiStudentSkField]: `MEDIA#ASSIGN#${assignmentId}#ITEM#${contentItemId}#${mediaType.toUpperCase()}`,
          media_id: mediaId, content_item_id: contentItemId,
          media_type: mediaType, mime_type: mimeType,
          data_url: dataUrl,
          versions: cappedVersions, active_version: activeVersion,
          version_counter: versionCounter + 1,
          created_at: createdAt,
        },
      }),
    );
    return { media_id: mediaId, content_item_id: contentItemId, media_type: mediaType, mime_type: mimeType, data_url: dataUrl, class_id: classId, assignment_id: assignmentId, student_id: studentId, created_at: createdAt, versions: cappedVersions, active_version: activeVersion };
  }

  // Local JSON: store data_url with version history
  const newVersion: MediaVersion = { data_url: dataUrl, refinement_prompt: refinementPrompt, created_at: createdAt };
  let record: MediaRecord;

  await withWriteLock(async () => {
    const store = await loadStore();
    const existingIndex = store.media.findIndex((m) => m.media_id === mediaId);
    const existingVersions = existingIndex >= 0 ? (store.media[existingIndex].versions ?? []) : [];
    const allVersions = [...existingVersions, newVersion];
    const cappedVersions = allVersions.length > MAX_VERSIONS ? allVersions.slice(allVersions.length - MAX_VERSIONS) : allVersions;

    record = {
      media_id: mediaId, content_item_id: contentItemId,
      media_type: mediaType, mime_type: mimeType, data_url: dataUrl,
      class_id: classId, assignment_id: assignmentId, student_id: studentId,
      created_at: createdAt, versions: cappedVersions, active_version: cappedVersions.length - 1,
    };

    if (existingIndex >= 0) {
      store.media[existingIndex] = record;
    } else {
      store.media.push(record);
    }
    await persistStore(store);
  });

  return record!;
};

const PRESIGNED_EXPIRY_SEC = 3600;

async function resolveMediaUrl(record: MediaRecord): Promise<MediaRecord> {
  if (record.data_url) return record;
  if (record.s3_key && record.s3_bucket) {
    try {
      // Prefer the shared client if available; otherwise create one on the fly
      // using the record's bucket region (covers case where ENGAGE_S3_BUCKET
      // env var is not set but records reference an S3 bucket).
      let s3 = getS3Client();
      if (!s3) {
        s3 = new S3Client({
          region: s3Region,
          ...(dynamoAccessKeyId &&
            dynamoSecretAccessKey && {
              credentials: {
                accessKeyId: dynamoAccessKeyId,
                secretAccessKey: dynamoSecretAccessKey,
              },
            }),
        });
      }
      const command = new GetObjectCommand({
        Bucket: record.s3_bucket,
        Key: record.s3_key,
      });
      const url = await getSignedUrl(s3, command, {
        expiresIn: PRESIGNED_EXPIRY_SEC,
      });
      return { ...record, data_url: url };
    } catch (err) {
      console.error(
        `Failed to generate presigned URL for ${record.s3_key}:`,
        err,
      );
    }
  }
  return record;
}

/** Resolve presigned URLs for a record and all its versions. */
async function resolveMediaWithVersions(record: MediaRecord): Promise<MediaRecord> {
  const resolved = await resolveMediaUrl(record);
  if (resolved.versions?.length) {
    resolved.versions = await Promise.all(
      resolved.versions.map(async (v) => {
        if (v.data_url) return v;
        if (v.s3_key && v.s3_bucket) {
          const vRecord = await resolveMediaUrl({ ...resolved, data_url: undefined, s3_key: v.s3_key, s3_bucket: v.s3_bucket });
          return { ...v, data_url: vRecord.data_url };
        }
        return v;
      }),
    );
  }
  return resolved;
}

/**
 * Retrieve a single media record by its composite key.
 */
export const getMedia = async (
  classId: string,
  assignmentId: string,
  studentId: string,
  contentItemId: string,
  mediaType: "image" | "video",
): Promise<MediaRecord | null> => {
  let record: MediaRecord | null = null;

  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return null;
    const result = await client.send(
      new GetCommand({
        TableName: dynamoTableName,
        Key: {
          [pkField]: `CLASS#${classId}`,
          [skField]: `MEDIA#ASSIGN#${assignmentId}#STUDENT#${studentId}#ITEM#${contentItemId}#${mediaType.toUpperCase()}`,
        },
      }),
    );
    if (!result.Item) return null;
    const hasData = result.Item.data_url || result.Item.s3_key;
    if (!hasData) return null;
    record = {
      media_id: (result.Item.media_id as string) ?? "",
      content_item_id: (result.Item.content_item_id as string) ?? contentItemId,
      media_type: (result.Item.media_type as "image" | "video") ?? mediaType,
      mime_type: (result.Item.mime_type as string) ?? "",
      data_url: result.Item.data_url as string | undefined,
      s3_bucket: result.Item.s3_bucket as string | undefined,
      s3_key: result.Item.s3_key as string | undefined,
      class_id: classId,
      assignment_id: assignmentId,
      student_id: studentId,
      created_at: (result.Item.created_at as string) ?? "",
      versions: result.Item.versions as MediaVersion[] | undefined,
      active_version: result.Item.active_version as number | undefined,
    };
  } else {
    const store = await loadStore();
    const mediaId = `${classId}_${assignmentId}_${studentId}_${contentItemId}_${mediaType}`;
    record = store.media.find((m) => m.media_id === mediaId) ?? null;
  }

  if (!record) return null;
  return resolveMediaWithVersions(record);
};

/**
 * Set the active version for a media record (used when teacher navigates image history).
 */
export const setActiveMediaVersion = async (
  classId: string,
  assignmentId: string,
  studentId: string,
  contentItemId: string,
  mediaType: "image" | "video",
  versionIndex: number,
): Promise<boolean> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return false;
    const pk = `CLASS#${classId}`;
    const sk = `MEDIA#ASSIGN#${assignmentId}#STUDENT#${studentId}#ITEM#${contentItemId}#${mediaType.toUpperCase()}`;

    // Read raw record without resolving presigned URLs
    const result = await client.send(new GetCommand({ TableName: dynamoTableName, Key: { [pkField]: pk, [skField]: sk } }));
    const versions = (result.Item?.versions as MediaVersion[] | undefined) ?? [];
    if (!versions.length) return false;
    const idx = Math.max(0, Math.min(versionIndex, versions.length - 1));
    const activeV = versions[idx];

    const updateFields: Record<string, unknown> = { active_version: idx };
    if (activeV.s3_key) updateFields.s3_key = activeV.s3_key;
    if (activeV.s3_bucket) updateFields.s3_bucket = activeV.s3_bucket;
    if (activeV.data_url && !activeV.s3_key) updateFields.data_url = activeV.data_url;

    const setExprs = Object.keys(updateFields).map((k) => `#${k} = :${k}`);
    const names = Object.fromEntries(Object.keys(updateFields).map((k) => [`#${k}`, k]));
    const values = Object.fromEntries(Object.entries(updateFields).map(([k, v]) => [`:${k}`, v]));

    await client.send(new UpdateCommand({
      TableName: dynamoTableName,
      Key: { [pkField]: pk, [skField]: sk },
      UpdateExpression: `SET ${setExprs.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
    return true;
  }

  // Local JSON
  let found = false;
  await withWriteLock(async () => {
    const store = await loadStore();
    const mediaId = `${classId}_${assignmentId}_${studentId}_${contentItemId}_${mediaType}`;
    const existing = store.media.find((m) => m.media_id === mediaId);
    if (!existing?.versions?.length) return;
    const idx = Math.max(0, Math.min(versionIndex, existing.versions.length - 1));
    existing.active_version = idx;
    const activeV = existing.versions[idx];
    if (activeV.data_url) existing.data_url = activeV.data_url;
    await persistStore(store);
    found = true;
  });
  return found;
};

/**
 * List all media for a given class + session + student.
 * Optionally filter by contentItemId and/or mediaType.
 */
export const listMedia = async (
  classId: string,
  assignmentId: string,
  studentId: string,
  contentItemId?: string,
  mediaType?: "image" | "video",
): Promise<MediaRecord[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) {
      return [];
    }

    // Query by PK + SK prefix for the student's media in this session
    let skPrefix = `MEDIA#ASSIGN#${assignmentId}#STUDENT#${studentId}#`;
    if (contentItemId) {
      skPrefix += `ITEM#${contentItemId}#`;
      if (mediaType) {
        skPrefix += mediaType.toUpperCase();
      }
    }

    const result = await client.send(
      new QueryCommand({
        TableName: dynamoTableName,
        KeyConditionExpression:
          "#pk = :pk AND begins_with(#sk, :skPrefix)",
        ExpressionAttributeNames: {
          "#pk": pkField,
          "#sk": skField,
        },
        ExpressionAttributeValues: {
          ":pk": `CLASS#${classId}`,
          ":skPrefix": skPrefix,
        },
      }),
    );

    const records = (result.Items ?? [])
      .filter(
        (item) =>
          item.record_type === "media" && (item.data_url || item.s3_key),
      )
      .map((item) => ({
        media_id: (item.media_id as string) ?? "",
        content_item_id: (item.content_item_id as string) ?? "",
        media_type: (item.media_type as "image" | "video") ?? "image",
        mime_type: (item.mime_type as string) ?? "",
        data_url: item.data_url as string | undefined,
        s3_bucket: item.s3_bucket as string | undefined,
        s3_key: item.s3_key as string | undefined,
        class_id: classId,
        assignment_id: assignmentId,
        student_id: studentId,
        created_at: (item.created_at as string) ?? "",
        versions: item.versions as MediaVersion[] | undefined,
        active_version: item.active_version as number | undefined,
      }));
    return Promise.all(records.map(resolveMediaWithVersions));
  }

  // Local JSON fallback
  const store = await loadStore();
  const records = store.media.filter((m) => {
    if (m.class_id !== classId) return false;
    if (m.assignment_id !== assignmentId) return false;
    if (m.student_id !== studentId) return false;
    if (contentItemId && m.content_item_id !== contentItemId) return false;
    if (mediaType && m.media_type !== mediaType) return false;
    return true;
  });
  return Promise.all(records.map(resolveMediaUrl));
};

/* ------------------------------------------------------------------ */
/*  Gallery: list all media across classes/sessions (paginated)        */
/* ------------------------------------------------------------------ */

export type GalleryItem = {
  media_id: string;
  content_item_id: string;
  media_type: "image" | "video";
  mime_type: string;
  url: string;
  class_id: string;
  assignment_id: string;
  student_id: string;
  created_at: string;
  s3_key?: string;
};

export type GalleryPage = {
  items: GalleryItem[];
  nextCursor: string | null;
};

const toEpochMs = (value: string | undefined) => {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortByMostRecentMedia = (a: MediaRecord, b: MediaRecord) => {
  const timeDiff = toEpochMs(b.created_at) - toEpochMs(a.created_at);
  if (timeDiff !== 0) return timeDiff;
  // Deterministic fallback when timestamps are identical/missing.
  return b.media_id.localeCompare(a.media_id);
};

export const listAllMedia = async (options: {
  mediaType?: "image" | "video";
  search?: string;
  limit?: number;
  cursor?: string;
}): Promise<GalleryPage> => {
  const { mediaType = "image", search, limit = 30, cursor } = options;

  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return { items: [], nextCursor: null };

    // Filter by record_type + media_type in DynamoDB; do search filtering
    // in JS so it's case-insensitive and can match across multiple fields.
    const allRecords: MediaRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await client.send(
        new ScanCommand({
          TableName: dynamoTableName,
          FilterExpression: "#rt = :media AND #mt = :mt",
          ExpressionAttributeNames: { "#rt": "record_type", "#mt": "media_type" },
          ExpressionAttributeValues: { ":media": "media", ":mt": mediaType },
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      );

      for (const item of result.Items ?? []) {
        allRecords.push({
          media_id: (item.media_id as string) ?? "",
          content_item_id: (item.content_item_id as string) ?? "",
          media_type: (item.media_type as "image" | "video") ?? "image",
          mime_type: (item.mime_type as string) ?? "",
          data_url: item.data_url as string | undefined,
          s3_bucket: item.s3_bucket as string | undefined,
          s3_key: item.s3_key as string | undefined,
          class_id: (item.class_id as string) ?? "",
          assignment_id: (item.assignment_id as string) ?? "",
          student_id: toPlainStudentId(item.student_id as string),
          created_at: (item.created_at as string) ?? "",
        });
      }

      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    // Case-insensitive search across multiple fields (matches local JSON path)
    const filtered = search
      ? allRecords.filter((m) => {
          const q = search.toLowerCase();
          const haystack = `${m.content_item_id} ${m.class_id} ${m.assignment_id} ${m.student_id}`.toLowerCase();
          return haystack.includes(q);
        })
      : allRecords;

    filtered.sort(sortByMostRecentMedia);

    const startIndex = cursor ? parseInt(cursor, 10) : 0;
    const page = filtered.slice(startIndex, startIndex + limit);
    const resolved = await Promise.all(page.map(resolveMediaUrl));
    const hasMore = startIndex + limit < filtered.length;

    return {
      items: resolved.map((r) => ({
        media_id: r.media_id,
        content_item_id: r.content_item_id,
        media_type: r.media_type,
        mime_type: r.mime_type,
        url: r.data_url ?? "",
        class_id: r.class_id,
        assignment_id: r.assignment_id,
        student_id: r.student_id,
        created_at: r.created_at,
        s3_key: r.s3_key,
      })),
      nextCursor: hasMore ? String(startIndex + limit) : null,
    };
  }

  // Local JSON fallback
  const store = await loadStore();
  const records = store.media.filter((m) => {
    if (mediaType && m.media_type !== mediaType) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = `${m.content_item_id} ${m.class_id} ${m.assignment_id} ${m.student_id}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  records.sort(sortByMostRecentMedia);

  const startIndex = cursor ? parseInt(cursor, 10) : 0;
  const page = records.slice(startIndex, startIndex + limit);
  const resolved = await Promise.all(page.map(resolveMediaUrl));
  const hasMore = startIndex + limit < records.length;

  return {
    items: resolved.map((r) => ({
      media_id: r.media_id,
      content_item_id: r.content_item_id,
      media_type: r.media_type,
      mime_type: r.mime_type,
      url: r.data_url ?? "",
      class_id: r.class_id,
      assignment_id: r.assignment_id,
      student_id: r.student_id,
      created_at: r.created_at,
      s3_key: r.s3_key,
    })),
    nextCursor: hasMore ? String(startIndex + limit) : null,
  };
};

/* ------------------------------------------------------------------ */
/*  Quiz status                                                        */
/* ------------------------------------------------------------------ */

export const getQuizStatus = async (
  classId: string,
  assignmentId: string,
): Promise<QuizStatusRecord | null> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return null;
    const result = await client.send(
      new GetCommand({
        TableName: dynamoTableName,
        Key: {
          [pkField]: `CLASS#${classId}`,
          [skField]: `QUIZ_STATUS#ASSIGN#${assignmentId}`,
        },
      }),
    );
    if (!result.Item) return null;
    return {
      class_id: classId,
      assignment_id: assignmentId,
      lesson_number: (result.Item.lesson_number as number) ?? 0,
      status: (result.Item.status as QuizStatusRecord["status"]) ?? "draft",
      published_by: result.Item.published_by as string | undefined,
      updated_at: (result.Item.updated_at as string) ?? "",
    };
  }

  const store = await loadStore();
  return (
    store.quiz_status.find(
      (q) => q.class_id === classId && q.assignment_id === assignmentId,
    ) ?? null
  );
};

export const upsertQuizStatus = async (
  classId: string,
  assignmentId: string,
  lessonNumber: number,
  status: QuizStatusRecord["status"],
  publishedBy?: string,
): Promise<QuizStatusRecord> => {
  const updatedAt = new Date().toISOString();
  const record: QuizStatusRecord = {
    class_id: classId,
    assignment_id: assignmentId,
    lesson_number: lessonNumber,
    status,
    published_by: publishedBy,
    updated_at: updatedAt,
  };

  if (useDynamoDb) {
    const client = getDynamoClient();
    if (client) {
      await client.send(
        new PutCommand({
          TableName: dynamoTableName,
          Item: {
            [pkField]: `CLASS#${classId}`,
            [skField]: `QUIZ_STATUS#ASSIGN#${assignmentId}`,
            record_type: "quiz_status",
            lesson_number: lessonNumber,
            status,
            published_by: publishedBy,
            updated_at: updatedAt,
          },
        }),
      );
    }
    return record;
  }

  await withWriteLock(async () => {
    const store = await loadStore();
    const idx = store.quiz_status.findIndex(
      (q) => q.class_id === classId && q.assignment_id === assignmentId,
    );
    if (idx >= 0) {
      store.quiz_status[idx] = record;
    } else {
      store.quiz_status.push(record);
    }
    await persistStore(store);
  });
  return record;
};

/* ------------------------------------------------------------------ */
/*  Student answers                                                    */
/* ------------------------------------------------------------------ */

export const upsertStudentAnswer = async (
  input: StudentAnswerRecord,
): Promise<StudentAnswerRecord> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (client) {
      await client.send(
        new PutCommand({
          TableName: dynamoTableName,
          Item: {
            [pkField]: `CLASS#${input.class_id}`,
            [skField]: `ANSWER#ASSIGN#${input.assignment_id}#STUDENT#${input.student_id}`,
            record_type: "student_answer",
            [gsiStudentPkField]: `STUDENT#${input.student_id}`,
            [gsiStudentSkField]: `ANSWER#ASSIGN#${input.assignment_id}`,
            assignment_id: input.assignment_id,
            student_name: input.student_name,
            lesson_number: input.lesson_number,
            answers: input.answers,
            submitted_at: input.submitted_at,
          },
        }),
      );
    }
    return input;
  }

  await withWriteLock(async () => {
    const store = await loadStore();
    const idx = store.student_answers.findIndex(
      (a) =>
        a.class_id === input.class_id &&
        a.assignment_id === input.assignment_id &&
        a.student_id === input.student_id,
    );
    if (idx >= 0) {
      store.student_answers[idx] = input;
    } else {
      store.student_answers.push(input);
    }
    await persistStore(store);
  });
  return input;
};

export const listStudentAnswers = async (
  classId: string,
  assignmentId: string,
): Promise<StudentAnswerRecord[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return [];
    const result = await client.send(
      new QueryCommand({
        TableName: dynamoTableName,
        KeyConditionExpression:
          "#pk = :pk AND begins_with(#sk, :skPrefix)",
        ExpressionAttributeNames: {
          "#pk": pkField,
          "#sk": skField,
        },
        ExpressionAttributeValues: {
          ":pk": `CLASS#${classId}`,
          ":skPrefix": `ANSWER#ASSIGN#${assignmentId}#STUDENT#`,
        },
      }),
    );
    return (result.Items ?? [])
      .filter((item) => item.record_type === "student_answer")
      .map((item) => ({
        class_id: (item.class_id as string) ?? classId,
        assignment_id: (item.assignment_id as string) ?? assignmentId,
        student_id: toPlainStudentId(item.student_id as string),
        student_name: (item.student_name as string) ?? "",
        lesson_number: (item.lesson_number as number) ?? 0,
        answers: (item.answers as Record<string, string>) ?? {},
        submitted_at: (item.submitted_at as string) ?? "",
      }));
  }

  const store = await loadStore();
  return store.student_answers.filter(
    (a) => a.class_id === classId && a.assignment_id === assignmentId,
  );
};

export const getStudentAnswer = async (
  classId: string,
  assignmentId: string,
  studentId: string,
): Promise<StudentAnswerRecord | null> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return null;
    const result = await client.send(
      new GetCommand({
        TableName: dynamoTableName,
        Key: {
          [pkField]: `CLASS#${classId}`,
          [skField]: `ANSWER#ASSIGN#${assignmentId}#STUDENT#${studentId}`,
        },
      }),
    );
    if (!result.Item) return null;
    return {
      class_id: classId,
      assignment_id: assignmentId,
      student_id: studentId,
      student_name: (result.Item.student_name as string) ?? "",
      lesson_number: (result.Item.lesson_number as number) ?? 0,
      answers: (result.Item.answers as Record<string, string>) ?? {},
      submitted_at: (result.Item.submitted_at as string) ?? "",
    };
  }

  const store = await loadStore();
  return (
    store.student_answers.find(
      (a) =>
        a.class_id === classId &&
        a.assignment_id === assignmentId &&
        a.student_id === studentId,
    ) ?? null
  );
};

/* ------------------------------------------------------------------ */
/*  Content publish                                                    */
/* ------------------------------------------------------------------ */

export const upsertContentPublish = async (
  input: ContentPublishRecord,
): Promise<ContentPublishRecord> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (client) {
      await client.send(
        new PutCommand({
          TableName: dynamoTableName,
          Item: {
            [pkField]: `CLASS#${input.class_id}`,
            [skField]: `CONTENT_PUB#ASSIGN#${input.assignment_id}#ITEM#${input.content_item_id}`,
            record_type: "content_publish",
            assignment_id: input.assignment_id,
            content_item_id: input.content_item_id,
            content_json: input.content_json,
            published: input.published,
            published_at: input.published_at,
            published_by: input.published_by,
          },
        }),
      );
    }
    return input;
  }

  await withWriteLock(async () => {
    const store = await loadStore();
    const idx = store.content_publish.findIndex(
      (c) =>
        c.class_id === input.class_id &&
        c.assignment_id === input.assignment_id &&
        c.content_item_id === input.content_item_id,
    );
    if (idx >= 0) {
      store.content_publish[idx] = input;
    } else {
      store.content_publish.push(input);
    }
    await persistStore(store);
  });
  return input;
};

export const listPublishedContent = async (
  classId: string,
  assignmentId: string,
): Promise<ContentPublishRecord[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return [];
    const result = await client.send(
      new QueryCommand({
        TableName: dynamoTableName,
        KeyConditionExpression:
          "#pk = :pk AND begins_with(#sk, :skPrefix)",
        ExpressionAttributeNames: {
          "#pk": pkField,
          "#sk": skField,
        },
        ExpressionAttributeValues: {
          ":pk": `CLASS#${classId}`,
          ":skPrefix": `CONTENT_PUB#ASSIGN#${assignmentId}#ITEM#`,
        },
      }),
    );
    return (result.Items ?? [])
      .filter((item) => item.record_type === "content_publish" && item.published)
      .map((item) => ({
        class_id: (item.class_id as string) ?? classId,
        assignment_id: (item.assignment_id as string) ?? assignmentId,
        content_item_id: (item.content_item_id as string) ?? "",
        content_json: (item.content_json as string) ?? "{}",
        published: true,
        published_at: (item.published_at as string) ?? "",
        published_by: (item.published_by as string) ?? "",
      }));
  }

  const store = await loadStore();
  return store.content_publish.filter(
    (c) =>
      c.class_id === classId &&
      c.assignment_id === assignmentId &&
      c.published,
  );
};

/* ------------------------------------------------------------------ */
/*  Content ratings                                                    */
/* ------------------------------------------------------------------ */

export const upsertContentRating = async (
  input: ContentRatingRecord,
): Promise<ContentRatingRecord> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (client) {
      await client.send(
        new PutCommand({
          TableName: dynamoTableName,
          Item: {
            [pkField]: `CLASS#${input.class_id}`,
            [skField]: `RATING#ASSIGN#${input.assignment_id}#STUDENT#${input.student_id}#ITEM#${input.content_item_id}`,
            record_type: "content_rating",
            [gsiStudentPkField]: `STUDENT#${input.student_id}`,
            [gsiStudentSkField]: `RATING#ASSIGN#${input.assignment_id}#ITEM#${input.content_item_id}`,
            assignment_id: input.assignment_id,
            content_item_id: input.content_item_id,
            rating: input.rating,
            rated_at: input.rated_at,
          },
        }),
      );
    }
    return input;
  }

  await withWriteLock(async () => {
    const store = await loadStore();
    const idx = store.content_ratings.findIndex(
      (r) =>
        r.class_id === input.class_id &&
        r.assignment_id === input.assignment_id &&
        r.student_id === input.student_id &&
        r.content_item_id === input.content_item_id,
    );
    if (idx >= 0) {
      store.content_ratings[idx] = input;
    } else {
      store.content_ratings.push(input);
    }
    await persistStore(store);
  });
  return input;
};

export type { StudentAnswerRecord, ContentPublishRecord, ContentRatingRecord, TeacherAnnotation, QuizStatusRecord };

export const listAllTeacherAnnotations = async (): Promise<TeacherAnnotation[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return [];
    const result = await client.send(
      new ScanCommand({
        TableName: dynamoTableName,
        FilterExpression: "#rt = :rt",
        ExpressionAttributeNames: { "#rt": "record_type" },
        ExpressionAttributeValues: { ":rt": "teacher_annotation" },
      }),
    );
    return (result.Items ?? []).map((item) => ({
      annotation_id: (item.annotation_id as string) ?? "",
      ...(typeof item.workspace_class_id === "string" ? { workspace_class_id: item.workspace_class_id } : {}),
      student_name: (item.student_name as string) ?? null,
      assignment: (item.assignment as string) ?? null,
      overall_recommendation: (item.overall_recommendation as string) ?? "",
      recommendation_reason: (item.recommendation_reason as string) ?? null,
      decision: (item.decision as "agree" | "disagree") ?? "agree",
      reason: (item.reason as string) ?? null,
      ai_plan: (item.ai_plan as Record<string, unknown>) ?? {},
      selected_strategies: (item.selected_strategies as string[]) ?? [],
      answers: (item.answers as Record<string, string | undefined>) ?? {},
      created_at: (item.created_at as string) ?? "",
    }));
  }
  const store = await loadStore();
  return store.teacher_annotations;
};

export const listAllStudentAnswers = async (): Promise<StudentAnswerRecord[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return [];
    const result = await client.send(
      new ScanCommand({
        TableName: dynamoTableName,
        FilterExpression: "#rt = :rt",
        ExpressionAttributeNames: { "#rt": "record_type" },
        ExpressionAttributeValues: { ":rt": "student_answer" },
      }),
    );
    return (result.Items ?? []).map((item) => ({
      class_id: (item.class_id as string) ?? "",
      assignment_id: (item.assignment_id as string) ?? "",
      student_id: toPlainStudentId(item.student_id as string),
      student_name: (item.student_name as string) ?? "",
      lesson_number: (item.lesson_number as number) ?? 0,
      answers: (item.answers as Record<string, string>) ?? {},
      submitted_at: (item.submitted_at as string) ?? "",
    }));
  }
  const store = await loadStore();
  return store.student_answers;
};

export const listAllCachedPlans = async (): Promise<CachedPlanRecord[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return [];
    const result = await client.send(
      new ScanCommand({
        TableName: dynamoTableName,
        FilterExpression: "#rt = :rt",
        ExpressionAttributeNames: { "#rt": "record_type" },
        ExpressionAttributeValues: { ":rt": "plan_cache" },
      }),
    );
    return (result.Items ?? []).map((item) => ({
      student_id: toPlainStudentId(item.student_id as string),
      assignment_id: (item.assignment_id as string) ?? "",
      class_id: (item.class_id as string) ?? "",
      plan_json: (item.plan_json as string) ?? "",
      updated_at: (item.updated_at as string) ?? "",
    }));
  }
  const store = await loadStore();
  const records: CachedPlanRecord[] = [];
  for (const [sid, record] of Object.entries(store.strategy_cache)) {
    records.push({
      student_id: record.student_id || sid,
      assignment_id: record.assignment_id || "",
      class_id: record.class_id || "",
      plan_json: record.plan_json,
      updated_at: record.updated_at,
    });
  }
  return records;
};

export const listAllPublishedContent = async (): Promise<ContentPublishRecord[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return [];
    const result = await client.send(
      new ScanCommand({
        TableName: dynamoTableName,
        FilterExpression: "#rt = :rt AND #pub = :pub",
        ExpressionAttributeNames: { "#rt": "record_type", "#pub": "published" },
        ExpressionAttributeValues: { ":rt": "content_publish", ":pub": true },
      }),
    );
    return (result.Items ?? []).map((item) => ({
      class_id: (item.class_id as string) ?? "",
      assignment_id: (item.assignment_id as string) ?? "",
      content_item_id: (item.content_item_id as string) ?? "",
      content_json: (item.content_json as string) ?? "{}",
      published: true,
      published_at: (item.published_at as string) ?? "",
      published_by: (item.published_by as string) ?? "",
    }));
  }
  const store = await loadStore();
  return store.content_publish.filter((c) => c.published);
};

export const listAllContentRatings = async (): Promise<ContentRatingRecord[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return [];
    const result = await client.send(
      new ScanCommand({
        TableName: dynamoTableName,
        FilterExpression: "#rt = :rt",
        ExpressionAttributeNames: { "#rt": "record_type" },
        ExpressionAttributeValues: { ":rt": "content_rating" },
      }),
    );
    return (result.Items ?? []).map((item) => ({
      class_id: (item.class_id as string) ?? "",
      assignment_id: (item.assignment_id as string) ?? "",
      student_id: toPlainStudentId(item.student_id as string),
      content_item_id: (item.content_item_id as string) ?? "",
      rating: (item.rating as number) ?? 0,
      rated_at: (item.rated_at as string) ?? "",
    }));
  }
  const store = await loadStore();
  return store.content_ratings;
};

export const listContentRatings = async (
  classId: string,
  assignmentId: string,
  studentId?: string,
): Promise<ContentRatingRecord[]> => {
  if (useDynamoDb) {
    const client = getDynamoClient();
    if (!client) return [];
    const skPrefix = studentId
      ? `RATING#ASSIGN#${assignmentId}#STUDENT#${studentId}#ITEM#`
      : `RATING#ASSIGN#${assignmentId}#STUDENT#`;
    const result = await client.send(
      new QueryCommand({
        TableName: dynamoTableName,
        KeyConditionExpression:
          "#pk = :pk AND begins_with(#sk, :skPrefix)",
        ExpressionAttributeNames: {
          "#pk": pkField,
          "#sk": skField,
        },
        ExpressionAttributeValues: {
          ":pk": `CLASS#${classId}`,
          ":skPrefix": skPrefix,
        },
      }),
    );
    return (result.Items ?? [])
      .filter((item) => item.record_type === "content_rating")
      .map((item) => ({
        class_id: (item.class_id as string) ?? classId,
        assignment_id: (item.assignment_id as string) ?? assignmentId,
        student_id: toPlainStudentId(item.student_id as string),
        content_item_id: (item.content_item_id as string) ?? "",
        rating: (item.rating as number) ?? 0,
        rated_at: (item.rated_at as string) ?? "",
      }));
  }

  const store = await loadStore();
  return store.content_ratings.filter((r) => {
    if (r.class_id !== classId) return false;
    if (r.assignment_id !== assignmentId) return false;
    if (studentId && r.student_id !== studentId) return false;
    return true;
  });
};
