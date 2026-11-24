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

it("preserves the originally selected lesson labels and identifiers and distinguishes a derived asset from a new selection", async () => {
  const input = { lessonNumber: 3, strategy: "analogy", format: "video" as const, operation: "generate", model: "test",
    prompt: { system: "", user: "PRIVATE lesson context" },
    focus: { kind: "coreIdeas" as const, items: ["Original third idea", "Original first idea"] },
    focusSelection: { coreIdeas: [2, 0] } };
  const first = await recordGeneration(scope, input);
  expect(first.focus).toEqual({ kind: "coreIdeas", origin: "operation", items: [
    { id: "Core idea 3", label: "Original third idea" }, { id: "Core idea 1", label: "Original first idea" }] });
  const media = await recordGeneration(scope, { ...input, operation: "video", parentId: first.id, focus: undefined, focusSelection: undefined });
  expect(media.focus).toEqual({ ...first.focus, origin: "source-material" });
  const adapted = await recordGeneration(scope, { ...input, parentId: first.id, operation: "adapt", focus: { kind: "coreIdeas", items: ["New second idea"] }, focusSelection: { coreIdeas: [1] } });
  expect(adapted.focus?.items).toEqual([{ id: "Core idea 2", label: "New second idea" }]);
  const other = await recordGeneration({ ...scope, userId: "other" }, { ...input, operation: "video", parentId: first.id, focus: undefined });
  expect(other.focus).toBeUndefined();
  expect(JSON.stringify(media)).not.toContain("PRIVATE");
});

it("recovers a retained legacy focus from its own receipt without assigning it today's curriculum IDs", async () => {
  const { generationLineage } = await import("@/lib/generation-record-server");
  const original = await recordGeneration(scope, { lessonNumber: 3, strategy: "cognitive conflict", format: "video", operation: "generate", model: "test",
    prompt: { system: "", user: "" }, focus: { kind: "misconceptions", items: ["Original lesson wording"] }, focusSelection: { misconceptions: ["a"] } });
  expect(original.focus?.items[0].id).toBe("MC08");
  const stored = [...store.values()][0] as { summary: typeof original; input: { focusSelection?: unknown; focus?: unknown } };
  delete stored.summary.focus; delete stored.input.focusSelection;
  const { focus: _newField, ...legacy } = original;
  expect(_newField).toBeDefined();
  expect((await generationLineage([scope.userId], legacy)).records[0].focus?.items).toEqual([{ label: "Original lesson wording" }]);
  expect((await generationLineage(["someone-else"], legacy)).records[0].focus).toBeUndefined();
  delete stored.input.focus;
  expect((await generationLineage([scope.userId], legacy)).records[0].focus).toBeUndefined();
});
