import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { UserContext } from "@/lib/auth";

// Runs the quiz store against a small stand-in for DynamoDB: all-or-nothing
// writes, create-only conditions, and a refusal of undefined values, as the real client gives.
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/lib-dynamodb", async (original) => ({
  ...await original<object>(),
  DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) },
}));

type Item = { class_id: string; record_id: string; value?: unknown; expiresAt?: number };
let items: Map<string, Item>;
let reads: (boolean | undefined)[];
const id = (pk: unknown, sk: unknown) => `${pk}|${sk}`;
const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Ana", email: null, role: "teacher" };
const activity = { classId: "host-class", assignmentId: "host-task" };

function refuseUndefined(value: unknown) {
  if (value === undefined) throw new Error("Pass options.removeUndefinedValues=true");
  if (value && typeof value === "object") for (const inner of Object.values(value)) refuseUndefined(inner);
}

beforeEach(() => {
  vi.stubEnv("DYNAMODB_TABLE", "quiz-test");
  vi.resetModules();
  items = new Map();
  reads = [];
  mocks.send.mockReset().mockImplementation(async (command: unknown) => {
    if (command instanceof GetCommand) {
      reads.push(command.input.ConsistentRead);
      return { Item: items.get(id(command.input.Key!.class_id, command.input.Key!.record_id)) };
    }
    if (command instanceof QueryCommand) {
      const values = command.input.ExpressionAttributeValues!;
      return { Items: [...items.values()].filter((item) => item.class_id === values[":pk"] && item.record_id.startsWith(String(values[":prefix"]))) };
    }
    if (command instanceof PutCommand) {
      items.set(id(command.input.Item!.class_id, command.input.Item!.record_id), command.input.Item as Item);
      return {};
    }
    if (command instanceof TransactWriteCommand) {
      const writes = command.input.TransactItems!;
      for (const write of writes) {
        if (write.Put) refuseUndefined(write.Put.Item);
        if (write.Put?.ConditionExpression && items.has(id(write.Put.Item!.class_id, write.Put.Item!.record_id))) {
          throw Object.assign(new Error("Transaction cancelled"), { name: "TransactionCanceledException", CancellationReasons: writes.map((w) => ({ Code: w === write ? "ConditionalCheckFailed" : "None" })) });
        }
      }
      for (const write of writes) {
        if (write.Put) items.set(id(write.Put.Item!.class_id, write.Put.Item!.record_id), write.Put.Item as Item);
        if (write.Delete) items.delete(id(write.Delete.Key!.class_id, write.Delete.Key!.record_id));
      }
      return {};
    }
    throw new Error("Unexpected database operation");
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("picks, edits and publishes once through the database, always reading the latest", async () => {
  const store = await import("@/lib/task-quiz-store");
  const quiz = await store.pickQuizLesson(teacher, activity, 1, false);
  expect(quiz.items).toHaveLength(4);
  await store.changeQuizItem(teacher, activity, "L1_Q1", { action: "editText", explanation: "Mine" });

  const results = await Promise.all([store.publishTaskQuiz(teacher, activity), store.publishTaskQuiz(teacher, activity)]);
  expect(results.filter((result) => !result.alreadyPublished)).toHaveLength(1);
  expect(reads.every((consistent) => consistent === true || consistent === undefined)).toBe(true);

  const puts = mocks.send.mock.calls.map(([command]) => command).filter((command) => command instanceof TransactWriteCommand).flatMap((command) => command.input.TransactItems!);
  for (const write of puts.filter((candidate) => /^(PUBLISHED|REV#)/.test(candidate.Put?.Item?.record_id ?? ""))) expect(write.Put!.ConditionExpression).toBe("attribute_not_exists(record_id)");

  const rows = [...items.values()].filter((item) => item.class_id.startsWith("WORKSPACE_TASK_QUIZ#"));
  expect(rows.map((row) => row.record_id).sort()).toEqual(["PUBLISHED", "QUIZ", "REV#000001", "REV#000002", "REV#000003"]);
  for (const row of rows.filter((candidate) => candidate.record_id.startsWith("REV#"))) expect(row.expiresAt).toBeGreaterThan(Date.now() / 1000);

  await expect(store.changeQuizItem(teacher, activity, "L1_Q1", { action: "confirm" })).rejects.toThrow("published");
  expect((await store.getTaskQuizItems(activity.classId, activity.assignmentId))?.[0].explanation).toBe("Mine");
  const status = items.get(id(`CLASS#${activity.classId}`, `QUIZ_STATUS#ASSIGN#${activity.assignmentId}`));
  expect(status).toMatchObject({ status: "published", lesson_number: 1, published_by: teacher.geniusId });
});

it("the published copy can only be written once", async () => {
  const store = await import("@/lib/task-quiz-store");
  await store.pickQuizLesson(teacher, activity, 1, false);
  await store.publishTaskQuiz(teacher, activity);
  const writes = mocks.send.mock.calls.map(([command]) => command).filter((command) => command instanceof TransactWriteCommand).flatMap((command) => command.input.TransactItems!);
  expect(writes.filter((write) => write.Put?.Item?.record_id === "PUBLISHED").map((write) => write.Put!.ConditionExpression)).toEqual(["attribute_not_exists(record_id)"]);
});

it("loses cleanly to a save made since the quiz was read", async () => {
  const store = await import("@/lib/task-quiz-store");
  await store.pickQuizLesson(teacher, activity, 1, false);
  const before = mocks.send.getMockImplementation()!;
  let raced = false;
  // Another server saves between this save's read and write, every time.
  mocks.send.mockImplementation(async (command: unknown) => {
    if (command instanceof TransactWriteCommand && !raced) {
      raced = true;
      for (const write of command.input.TransactItems!) items.set(id(write.Put!.Item!.class_id, write.Put!.Item!.record_id), write.Put!.Item as Item);
    }
    return before(command);
  });
  const saved = await store.changeQuizItem(teacher, activity, "L1_Q1", { action: "editText", explanation: "Mine" });
  expect(saved.items[0].explanation).toBe("Mine"); // It tried again.
  mocks.send.mockImplementation(async (command: unknown) => {
    if (command instanceof TransactWriteCommand) throw Object.assign(new Error("x"), { name: "TransactionCanceledException", CancellationReasons: [{ Code: "TransactionConflict" }] });
    return before(command);
  });
  await expect(store.changeQuizItem(teacher, activity, "L1_Q1", { action: "editText", explanation: "Never" })).rejects.toMatchObject({ status: 409 });
});
