import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { ClassProfile } from "@/lib/class-profile";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/lib-dynamodb", async original => ({
  ...await original<object>(),
  DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) },
}));

let items: Record<string, unknown>[];
beforeEach(() => {
  vi.stubEnv("DYNAMODB_TABLE", "class-profile-test");
  vi.resetModules();
  items = [];
  mocks.send.mockReset().mockImplementation(async command => {
    if (command instanceof PutCommand) {
      const item = command.input.Item!;
      items = items.filter(i => !(i.class_id === item.class_id && i.record_id === item.record_id)).concat(item);
      return {};
    }
    if (command instanceof GetCommand) {
      const key = command.input.Key!;
      return { Item: items.find(i => i.class_id === key.class_id && i.record_id === key.record_id) };
    }
    throw new Error("Unexpected database operation");
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const profile = (classId: string, overrides: Partial<ClassProfile> = {}): ClassProfile => ({
  class_id: classId, status: "saved", locale: "rural", groups: ["hispanic_latino", "white"], groupAlternative: null,
  classType: "honors", englishLearners: true, iepOr504: false, updated_by: "teacher-1", updated_at: "2026-11-03T00:00:00.000Z",
  ...overrides,
});

it("saves one class profile record per class and reads it back (#173)", async () => {
  const { getClassProfile, upsertClassProfile } = await import("@/lib/nosql");
  expect(await getClassProfile("ea-class-1")).toBeNull();

  await upsertClassProfile(profile("ea-class-1"));
  await upsertClassProfile(profile("ea-class-2", { locale: "city" }));
  expect(items.map(i => [i.class_id, i.record_id])).toEqual([["CLASS#ea-class-1", "CLASS_PROFILE"], ["CLASS#ea-class-2", "CLASS_PROFILE"]]);
  expect(await getClassProfile("ea-class-1")).toEqual(profile("ea-class-1"));

  await upsertClassProfile(profile("ea-class-1", { classType: "general", groups: [] }));
  expect(items).toHaveLength(2);
  expect(await getClassProfile("ea-class-1")).toMatchObject({ classType: "general", groups: [] });
  expect((await getClassProfile("ea-class-2"))?.locale).toBe("city");
});

it("reads a skipped profile with no answers (#173)", async () => {
  const { getClassProfile, upsertClassProfile } = await import("@/lib/nosql");
  await upsertClassProfile(profile("ea-class-1", {
    status: "skipped", locale: null, groups: [], classType: null, englishLearners: false, updated_by: undefined,
  }));
  expect(await getClassProfile("ea-class-1")).toMatchObject({
    status: "skipped", locale: null, groups: [], groupAlternative: null, classType: null, englishLearners: false, iepOr504: false,
  });
});
