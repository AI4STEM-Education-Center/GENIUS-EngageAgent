import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CURRENT_QUIZ_VERSION, getQuizItemsForVersion } from "@/lib/quiz-assessment";
import { getLessonQuizItems } from "@/lib/quiz-data";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/lib-dynamodb", async original => ({
  ...await original<object>(),
  DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) },
}));

beforeEach(() => {
  vi.stubEnv("DYNAMODB_TABLE", "quiz-status-test");
  vi.resetModules();
  const items = new Map<string, Record<string, unknown>>();
  const key = (record: Record<string, unknown>) => `${record.class_id}|${record.record_id}`;
  mocks.send.mockReset().mockImplementation(async command => {
    if (command instanceof PutCommand) {
      // Simulate the document client's removeUndefinedValues behavior and a
      // storage round trip, rather than returning the in-memory write record.
      const stored = JSON.parse(JSON.stringify(command.input.Item!));
      items.set(key(stored), stored);
      return {};
    }
    if (command instanceof GetCommand) {
      const item = items.get(key(command.input.Key!));
      return { Item: item ? JSON.parse(JSON.stringify(item)) : undefined };
    }
    throw new Error("Unexpected database operation");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("preserves quiz_version through Dynamo Put/Get so a published quiz includes experience questions", async () => {
  const { upsertQuizStatus, getQuizStatus } = await import("@/lib/nosql");
  const published = await upsertQuizStatus(
    "ea-class-1", "ea-task-1", 2, "published", "teacher-1", CURRENT_QUIZ_VERSION,
  );
  const restored = await getQuizStatus("ea-class-1", "ea-task-1");
  expect(restored).toEqual(published);
  expect(restored?.quiz_version).toBe(CURRENT_QUIZ_VERSION);
  expect(getQuizItemsForVersion(getLessonQuizItems(2), restored?.quiz_version)).toHaveLength(14);

  const put = mocks.send.mock.calls.find(([command]) => command instanceof PutCommand)![0] as PutCommand;
  expect(put.input).toMatchObject({
    TableName: "quiz-status-test",
    Item: {
      class_id: "CLASS#ea-class-1", record_id: "QUIZ_STATUS#ASSIGN#ea-task-1",
      record_type: "quiz_status", lesson_number: 2, status: "published",
      quiz_version: CURRENT_QUIZ_VERSION,
    },
  });
});

it("preserves legacy quizzes without a version and isolates class/task records", async () => {
  const { upsertQuizStatus, getQuizStatus } = await import("@/lib/nosql");
  await upsertQuizStatus("ea-class-1", "legacy-task", 2, "published", "teacher-1");
  await upsertQuizStatus("ea-class-1", "new-task", 3, "published", "teacher-1", CURRENT_QUIZ_VERSION);
  await upsertQuizStatus("ea-class-2", "legacy-task", 4, "draft", "teacher-2", CURRENT_QUIZ_VERSION);

  const legacy = await getQuizStatus("ea-class-1", "legacy-task");
  expect(legacy).toMatchObject({ lesson_number: 2, status: "published" });
  expect(legacy?.quiz_version).toBeUndefined();
  expect(getQuizItemsForVersion(getLessonQuizItems(2), legacy?.quiz_version)).toHaveLength(8);
  expect(await getQuizStatus("ea-class-1", "new-task"))
    .toMatchObject({ lesson_number: 3, quiz_version: CURRENT_QUIZ_VERSION });
  expect(await getQuizStatus("ea-class-2", "legacy-task"))
    .toMatchObject({ lesson_number: 4, status: "draft", quiz_version: CURRENT_QUIZ_VERSION });
  expect(await getQuizStatus("ea-class-2", "new-task")).toBeNull();
});

it("keeps the version when the caller closes an existing versioned quiz", async () => {
  const { upsertQuizStatus, getQuizStatus } = await import("@/lib/nosql");
  await upsertQuizStatus("ea-class-1", "ea-task-1", 8, "published", "teacher-1", CURRENT_QUIZ_VERSION);
  const published = await getQuizStatus("ea-class-1", "ea-task-1");
  await upsertQuizStatus("ea-class-1", "ea-task-1", 8, "closed", "teacher-1", published?.quiz_version);
  expect(await getQuizStatus("ea-class-1", "ea-task-1"))
    .toMatchObject({ status: "closed", quiz_version: CURRENT_QUIZ_VERSION });
});
