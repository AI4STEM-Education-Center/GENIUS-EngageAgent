import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/lib-dynamodb", async original => ({
  ...await original<object>(),
  DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) },
}));

beforeEach(() => {
  vi.stubEnv("DYNAMODB_TABLE", "review-questions-test");
  vi.resetModules();
  const items: Record<string, unknown>[] = [];
  mocks.send.mockReset().mockImplementation(async command => {
    if (command instanceof PutCommand) { items.push(command.input.Item!); return {}; }
    if (command instanceof QueryCommand) {
      const values = command.input.ExpressionAttributeValues!;
      return { Items: items.filter(item => item.class_id === values[":pk"]
        && (command.input.KeyConditionExpression?.includes("begins_with")
          ? String(item.record_id).startsWith(values[":skPrefix"])
          : item.record_id === values[":sk"])) };
    }
    throw new Error("Unexpected database operation");
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const question = (studentId: string, assignmentId = "ea-task-1", classId = "ea-class-1") => ({
  class_id: classId, assignment_id: assignmentId, student_id: studentId,
  questions: [`Question from ${studentId}`], submitted_at: "2026-10-07T00:00:00Z",
});

it("does not read another student's questions when their ID extends the requested ID", async () => {
  const { upsertReviewQuestions, listReviewQuestions } = await import("@/lib/nosql");
  await upsertReviewQuestions(question("student10"));
  expect(await listReviewQuestions("ea-class-1", "ea-task-1", "student1")).toEqual([]);
  await upsertReviewQuestions(question("student1"));
  expect(await listReviewQuestions("ea-class-1", "ea-task-1", "student1"))
    .toEqual([{ ...question("student1"), class_id: "CLASS#ea-class-1" }]);
  const query = mocks.send.mock.calls.find(([command]) => command instanceof QueryCommand)![0] as QueryCommand;
  expect(query.input.KeyConditionExpression).toBe("#pk = :pk AND #sk = :sk");
});

it("preserves teacher aggregation of all students in only the selected class and task", async () => {
  const { upsertReviewQuestions, listReviewQuestions } = await import("@/lib/nosql");
  for (const record of [question("student1"), question("student10"), question("student2", "ea-task-2"), question("student3", "ea-task-1", "ea-class-2")]) {
    await upsertReviewQuestions(record);
  }
  expect((await listReviewQuestions("ea-class-1", "ea-task-1")).map(record => record.student_id)).toEqual(["student1", "student10"]);
});
