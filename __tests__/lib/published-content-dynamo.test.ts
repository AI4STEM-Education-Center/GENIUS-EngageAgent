import { afterEach, expect, it, vi } from "vitest";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/lib-dynamodb", async original => ({ ...await original<object>(), DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) } }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("reads published content consistently using its actual class/task partition and preserves the physical record shape", async () => {
  vi.stubEnv("DYNAMODB_TABLE", "published-content-test");
  vi.resetModules();
  const { upsertContentPublish, listPublishedContent } = await import("@/lib/nosql");
  let stored: Record<string, unknown> | undefined;
  mocks.send.mockImplementation(async command => {
    if (command instanceof PutCommand) { stored = command.input.Item; return {}; }
    if (command instanceof QueryCommand) return { Items: stored ? [stored] : [] };
    throw new Error("Unexpected database operation");
  });
  const record = { class_id: "ea-class-live", assignment_id: "ea-task-live", content_item_id: "slides-deck", content_json: "{}", published: true, published_at: "2026-10-06T00:00:00Z", published_by: "teacher" };
  await upsertContentPublish(record);
  expect(stored).toMatchObject({ class_id: "CLASS#ea-class-live", record_id: "CONTENT_PUB#ASSIGN#ea-task-live#ITEM#slides-deck", assignment_id: "ea-task-live" });
  const records = await listPublishedContent(record.class_id, record.assignment_id);
  expect(records).toEqual([{ ...record, class_id: "CLASS#ea-class-live" }]);
  const query = mocks.send.mock.calls.find(([command]) => command instanceof QueryCommand)![0] as QueryCommand;
  expect(query.input).toMatchObject({ TableName: "published-content-test", ConsistentRead: true,
    ExpressionAttributeValues: { ":pk": "CLASS#ea-class-live", ":skPrefix": "CONTENT_PUB#ASSIGN#ea-task-live#ITEM#" } });
});
