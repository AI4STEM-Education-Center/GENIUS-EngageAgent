import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) },
  GetCommand: class {}, QueryCommand: class {},
  TransactWriteCommand: class { constructor(public input: unknown) {} },
}));
import { workspacePut } from "@/lib/workspace-store";
afterEach(() => vi.unstubAllEnvs());
it("puts optional expiry at the DynamoDB item level without changing ordinary workspace records", async () => {
  vi.stubEnv("DYNAMODB_TABLE", "test-table");
  await workspacePut([
    { partition: "SLIDE_JOBS#teacher", key: "JOB#example", value: { providerResponseId: "private" }, expiresAt: 123456, createOnly: true },
    { partition: "WORKSPACE#class", key: "META", value: { name: "Science" } },
  ]);
  const puts = mocks.send.mock.calls[0][0].input.TransactItems.map((item: { Put: unknown }) => item.Put);
  expect(puts[0]).toMatchObject({ Item: { expiresAt: 123456, value: { providerResponseId: "private" } }, ConditionExpression: "attribute_not_exists(record_id)" });
  expect(puts[1].Item).toEqual({ class_id: "WORKSPACE#class", record_id: "META", value: { name: "Science" } });
});
