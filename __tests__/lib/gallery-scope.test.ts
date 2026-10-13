import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn() }));
vi.mock("@aws-sdk/lib-dynamodb", async original => ({ ...await original<object>(), DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) } }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv("DYNAMODB_TABLE", "gallery-test"); vi.stubEnv("ENGAGE_S3_BUCKET", "test-private");
  mocks.sign.mockImplementation(async (_client, command) => `https://private.example/${command.input.Key}`);
  mocks.send.mockResolvedValue({ Items: [
    ["CLASS#other", "task", "foreign", "2026-10-13"],
    ["CLASS#owned", "other-task", "wrong-task", "2026-10-12"],
    ["CLASS#owned", "task", "first", "2026-10-11"],
    ["owned", "task", "second", "2026-10-10"],
  ].map(([class_id, assignment_id, media_id, created_at]) => ({ class_id, assignment_id, media_id, created_at,
    media_type: "image", record_type: "media", s3_bucket: "test-private", s3_key: media_id, content_item_id: media_id, mime_type: "image/png", student_id: "student" })) });
});
afterEach(() => vi.unstubAllEnvs());

it("filters authorized class/task before pagination and before signing private asset URLs", async () => {
  const { listAllMedia } = await import("@/lib/nosql");
  const options = { scope: { classIds: ["owned"], assignmentId: "task" }, limit: 1 };
  const first = await listAllMedia(options);
  expect(first.items.map(item => item.media_id)).toEqual(["first"]);
  expect(first.nextCursor).toBe("1");
  expect(mocks.sign.mock.calls.map(([, command]) => command.input.Key)).toEqual(["first"]);
  const next = await listAllMedia({ ...options, cursor: first.nextCursor! });
  expect(next.items.map(item => item.media_id)).toEqual(["second"]);
  expect(next.nextCursor).toBeNull();
  expect(mocks.sign.mock.calls.map(([, command]) => command.input.Key)).toEqual(["first", "second"]);
});

it("does not scan or sign any materials for a teacher with no owned classes", async () => {
  const { listAllMedia } = await import("@/lib/nosql");
  expect(await listAllMedia({ scope: { classIds: [] } })).toEqual({ items: [], nextCursor: null });
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
});
