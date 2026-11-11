import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ db: vi.fn(), s3: vi.fn(), failCommit: false, rows: new Map<string, Record<string, unknown>>() }));
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mocks.db }) },
  GetCommand: class { constructor(public input: unknown) {} },
  QueryCommand: class { constructor(public input: unknown) {} },
  TransactWriteCommand: class { constructor(public input: unknown) {} },
}));
vi.mock("@aws-sdk/client-s3", async original => ({ ...await original<object>(), S3Client: class { send = mocks.s3; destroy() {} } }));
vi.mock("@/lib/session", async original => ({ ...await original<object>(), sessionUser: async () => ({ geniusId: "cloud-teacher", role: "teacher" }) }));
vi.mock("@/lib/workspace", async original => ({ ...await original<object>(), workspaceContext: async () => ({}) }));
// Not about lessons: getLesson reads the lesson files here. See lesson-wiring.test.ts for the stored ones.
vi.mock("@/lib/lesson-scope", () => ({ enterLessonScope: () => {}, loadTaskLessons: async () => new Map() }));
vi.mock("@/lib/nosql", () => ({ getMedia: vi.fn() }));
import { GET, POST } from "@/app/api/material-gallery/route";
import { deckFixture, tinyImage } from "../fixtures/slides";

const scope = { classId: "ea-class-cloud", assignmentId: "task-cloud" };
const partition = `GALLERY_COPIES#${createHash("sha256").update(JSON.stringify([scope.classId, scope.assignmentId])).digest("hex")}`;
const templateId = "a1111111-1111-4111-8111-111111111111", copyId = "b1111111-1111-4111-8111-111111111111";
const source = { templateId, revision: 1, title: "Shared source", mode: "adapt" };
const origin = "https://engage.example";
const key = (row: Record<string, unknown>) => `${row.class_id}|${row.record_id}`;
const post = (body: object) => POST(new Request(`${origin}/api/material-gallery`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ ...scope, ...body }) }));
const load = () => GET(new Request(`${origin}/api/material-gallery?${new URLSearchParams({ ...scope, action: "saved-copy", copyId })}`));
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.clear(); mocks.failCommit = false;
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DYNAMODB_TABLE", "private-test-table"); vi.stubEnv("ENGAGE_S3_BUCKET", "private-test-bucket"); vi.stubEnv("ENGAGE_APP_URL", origin);
  const original = { class_id: "MATERIAL_GALLERY#v1", record_id: `SOURCE#${templateId}`, value: { id: templateId, revision: 1, format: "slides", lessonNumber: 3, strategy: "cognitive conflict", metadata: { title: source.title } } };
  const receipt = { class_id: partition, record_id: `COPY#${copyId}`, value: { id: copyId, templateId, ownerId: "cloud-teacher", ...scope, source, createdAt: new Date().toISOString() } };
  mocks.rows.set(key(original), original); mocks.rows.set(key(receipt), receipt);
  mocks.s3.mockResolvedValue({});
  mocks.db.mockImplementation(async command => {
    if (command.input.Key) {
      expect(command.input.ConsistentRead).toBe(true);
      return { Item: mocks.rows.get(key(command.input.Key)) };
    }
    const puts = command.input.TransactItems.map((item: { Put: { Item: Record<string, unknown>; ConditionExpression?: string } }) => item.Put);
    if (mocks.failCommit && puts.some((put: { Item: { record_id: string } }) => put.Item.record_id.startsWith("SAVE#"))) throw new Error("Injected atomic write failure");
    for (const put of puts) if (put.ConditionExpression && mocks.rows.has(key(put.Item))) throw new Error("ConditionalCheckFailed");
    for (const put of puts) mocks.rows.set(key(put.Item), put.Item);
    return {};
  });
});
afterEach(() => vi.unstubAllEnvs());

it("commits the revision guard, receipt, private snapshot and complete assets in one cloud transaction, preserving the prior save on failure", async () => {
  async function stage(expectedRevision: number, title: string) {
    const deck = deckFixture("cognitive conflict");
    const start = await post({ action: "start-save", copyId, expectedRevision, deck: { ...deck, id: copyId, gallerySource: source, draft: { ...deck.draft, title } },
      assets: { evidence: { width: 1, height: 1, digest: createHash("sha256").update(Buffer.from(tinyImage.split(",")[1], "base64")).digest("hex") } } });
    expect(start.status).toBe(200); const { saveId } = await start.json();
    expect((await post({ action: "upload-copy-asset", copyId, saveId, visualId: "evidence", asset: { data: tinyImage, width: 1, height: 1 } })).status).toBe(200);
    return saveId;
  }
  const first = await stage(0, "First saved version");
  expect((await post({ action: "commit-save", copyId, saveId: first })).status).toBe(200);
  const second = await stage(1, "Second saved version"); mocks.failCommit = true;
  const usageKey = `GALLERY_USAGE#${templateId}|TEACHER#${createHash("sha256").update("cloud-teacher").digest("hex")}`;
  const firstUsage = structuredClone(mocks.rows.get(usageKey));
  expect(firstUsage).toMatchObject({ value: { teacherId: "cloud-teacher", templateId, copyId } });
  expect((await post({ action: "commit-save", copyId, saveId: second })).status).toBe(503);
  expect(mocks.rows.get(usageKey)).toEqual(firstUsage);
  expect((await (await load()).json()).copy.deck.draft.title).toBe("First saved version");
  mocks.failCommit = false;
  expect((await post({ action: "commit-save", copyId, saveId: second })).status).toBe(200);
  const transaction = mocks.db.mock.calls.map(([command]) => command.input.TransactItems).filter(Boolean).at(-1);
  expect(transaction).toHaveLength(5);
  expect(transaction[0].Put).toMatchObject({ ConditionExpression: "attribute_not_exists(record_id)", Item: { class_id: partition, record_id: `SAVE#${copyId}#0000000002` } });
  expect(transaction.map((item: { Put: { Item: { record_id: string } } }) => item.Put.Item.record_id)).toEqual([
    `SAVE#${copyId}#0000000002`, `DRAFT#${second}`, `ASSET#${second}#evidence`, `COPY#${copyId}`, `TEACHER#${createHash("sha256").update("cloud-teacher").digest("hex")}`,
  ]);
  for (const { Put } of transaction.slice(0, 4)) { expect(Put.Item.expiresAt).toBeUndefined(); expect(Put.Item.class_id).toBe(partition); }
  expect(transaction[4].Put.Item.class_id).toBe(`GALLERY_USAGE#${templateId}`);
  expect((await (await load()).json()).revision).toBe(2);
  expect([...mocks.rows.keys()].some(id => id.includes("SHARED#"))).toBe(false);
});
