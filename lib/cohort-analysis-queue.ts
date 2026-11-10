import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { LessonGenerationContext, ResolvedQuizEvidence } from "./lesson-context";

const DEFAULT_ENGAGE_AWS_REGION = "us-east-2";

const getQueueConfig = () => ({
  queueUrl: process.env.COHORT_ANALYSIS_QUEUE_URL?.trim() ?? "",
  awsRegion: process.env.ENGAGE_AWS_REGION ?? DEFAULT_ENGAGE_AWS_REGION,
  awsAccessKeyId: process.env.ENGAGE_AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.ENGAGE_AWS_SECRET_ACCESS_KEY,
});

const getSqsClient = () => {
  const { queueUrl, awsRegion, awsAccessKeyId, awsSecretAccessKey } =
    getQueueConfig();
  if (!queueUrl) {
    return null;
  }

  return new SQSClient({
    region: awsRegion,
    ...(awsAccessKeyId &&
      awsSecretAccessKey && {
        credentials: {
          accessKeyId: awsAccessKeyId,
          secretAccessKey: awsSecretAccessKey,
        },
      }),
  });
};

const chunkItems = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const buildBatchEntryId = (chunkIndex: number, studentIndex: number) =>
  `student-${chunkIndex}-${studentIndex}`;

export const getCohortAnalysisQueueConfigIssues = () => {
  const { queueUrl } = getQueueConfig();
  const issues: string[] = [];

  if (!queueUrl) {
    issues.push("COHORT_ANALYSIS_QUEUE_URL");
  }

  return issues;
};

export const isCohortAnalysisQueueConfigured = () =>
  getCohortAnalysisQueueConfigIssues().length === 0;

export const enqueueCohortJobStudents = async ({
  jobId,
  classId,
  assignmentId,
  lessonNumber,
  lessonContext,
  totalStudents,
  forceRefresh = false,
  students,
}: {
  jobId: string;
  classId: string;
  assignmentId: string;
  lessonNumber: number;
  lessonContext?: LessonGenerationContext;
  totalStudents: number;
  forceRefresh?: boolean;
  students: Array<{
    id: string;
    name: string;
    assignment?: string;
    answers: Record<string, string | undefined>;
    quizEvidence?: ResolvedQuizEvidence[];
  }>;
}) => {
  const { queueUrl } = getQueueConfig();
  if (!queueUrl) {
    throw new Error("COHORT_ANALYSIS_QUEUE_URL is not configured.");
  }

  const client = getSqsClient();
  if (!client) {
    throw new Error("Failed to initialize the cohort analysis queue client.");
  }

  const chunks = chunkItems(students, 10);
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const response = await client.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: chunk.map((student, studentIndex) => ({
          Id: buildBatchEntryId(chunkIndex, studentIndex),
          MessageBody: JSON.stringify({
            jobId,
            classId,
            assignmentId,
            lessonNumber,
            lessonContext,
            totalStudents,
            forceRefresh,
            student,
          }),
        })),
      }),
    );

    if ((response.Failed ?? []).length > 0) {
      const firstError = response.Failed?.[0];
      throw new Error(
        firstError?.Message ??
          `Failed to enqueue ${response.Failed?.length ?? 1} student message(s).`,
      );
    }
  }
};
