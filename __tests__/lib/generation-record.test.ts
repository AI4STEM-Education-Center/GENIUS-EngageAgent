import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/workspace-store", () => ({ workspaceGet: vi.fn(async (p, k) => store.get(`${p}:${k}`) ?? null), workspacePut: vi.fn(async rows => { for (const r of rows) store.set(`${r.partition}:${r.key}`, structuredClone(r.value)); }) }));
import { recordGeneration, resolveGeneration } from "@/lib/generation-record-server";
const scope = { userId: "t1", classId: "c1", assignmentId: "a1" };
beforeEach(() => store.clear());
it("captures actual private inputs and exposes only a bounded teaching summary", async () => {
  const input = { lessonNumber: 1, strategy: "analogy", format: "slides" as const, operation: "generate", model: "test-model",
    prompt: { system: "teaching contract", user: JSON.stringify({ referenceVariables: { TOPIC: "Forces", LEARNER_CONTEXT: "private class detail", CURRENT_UNDERSTANDING: { studentIds: ["private-learner"] } } }) },
    settings: { gradeBand: "Middle school", experienceContext: "Soccer" } };
  const generation = await recordGeneration(scope, input);
  expect(generation.tags).toMatchObject({ TOPIC: "Forces", GRADE_LEVEL: "Middle school", MODEL: "test-model" });
  expect(JSON.stringify(generation)).not.toContain("private class detail");
  expect(JSON.stringify(generation)).not.toContain("private-learner");
  expect([...store.values()][0]).toMatchObject({ input, ownerId: "t1" });
  expect(await resolveGeneration("t1", { ...generation, tags: { TOPIC: "forged" } }, 1, "analogy")).toEqual(generation);
  await expect(resolveGeneration("t2", generation, 1, "analogy")).rejects.toThrow();
  await expect(resolveGeneration("t1", generation, 2, "analogy")).rejects.toThrow();
});

it("links only owned, compatible parents and prevents format substitution", async () => {
  const input = { lessonNumber: 1, strategy: "analogy", format: "slides" as const, operation: "generate", model: "test", prompt: { system: "contract", user: "draft" }, variables: { TOPIC: "Forces" } };
  const original = await recordGeneration(scope, input);
  const revised = await recordGeneration(scope, { ...input, variables: undefined, parentId: original.id, operation: "review" });
  expect(revised).toMatchObject({ parentId: original.id, tags: { TOPIC: "Forces" } });
  const other = await recordGeneration({ ...scope, userId: "t2" }, { ...input, variables: undefined, parentId: original.id });
  expect(other.parentId).toBeUndefined(); expect(other.tags.TOPIC).toBeUndefined();
  await expect(resolveGeneration("t1", original, 1, "analogy", undefined, "video")).rejects.toThrow();
});

it("returns the actual compatible lineage and safe media parameters without substituting a different teacher's parent", async () => {
  const { generationLineage } = await import("@/lib/generation-record-server");
  const input = { lessonNumber: 3, strategy: "cognitive conflict", format: "video" as const, operation: "generate", model: "text", prompt: { system: "", user: "PRIVATE input" } };
  const text = await recordGeneration(scope, input);
  const video = await recordGeneration(scope, { ...input, operation: "video", model: "video-model", parentId: text.id, parameters: { duration: 4, resolution: "480p", contentItemId: "PRIVATE item" } });
  expect(video.tags).toMatchObject({ DURATION: "4 seconds", RESOLUTION: "480p" });
  expect(JSON.stringify(video)).not.toContain("PRIVATE");
  expect((await generationLineage([scope.userId], video)).records.map(r => r.id)).toEqual([video.id, text.id]);
  expect(await generationLineage(["other-teacher"], video)).toMatchObject({ incomplete: true, records: [video] });
});
