import { afterEach, expect, it, vi } from "vitest";
import { loadSlideDraft, restoreSlideDraft, saveSlideDraft, slideDraftKey, type SlideDraftScope } from "@/lib/slides/draft-storage";
import { STRATEGIES } from "@/lib/slides/model";
import { imageCheckKey, textCheckKey } from "@/lib/slides/quality";
import { deckFixture } from "../fixtures/slides";

const scope: SlideDraftScope = { userId: "teacher-a", classId: "ea-class-a", assignmentId: "ea-task-a", lessonNumber: 3, strategy: "cognitive conflict" };
const stored = () => ({ version: 1, key: slideDraftKey(scope), deck: deckFixture(scope.strategy) });
afterEach(() => vi.unstubAllGlobals());

it("round-trips generated images, content and keyed checks without retaining teacher acceptance", () => {
  const value = stored();
  value.deck.teacherDecision = { reason: "Reviewed in class", draftKey: "key", checks: value.deck.checks!, assets: value.deck.assets };
  const restored = restoreSlideDraft(structuredClone(value), scope)!;
  expect(restored.draft).toEqual(value.deck.draft);
  expect(restored.assets).toEqual(value.deck.assets);
  expect(restored.checks).toEqual(value.deck.checks);
  expect(restored.teacherDecision).toBeUndefined();
});

it.each(STRATEGIES)("retains valid %s reviews when job provenance arrives in a different field order", strategy => {
  const deck = deckFixture(strategy);
  // DynamoDB-backed job metadata need not retain the producer's field order.
  deck.promptProvenance = { sourceSha256: "a".repeat(64), ...(strategy === "analogy" ? { analogyMethod: "predict-transfer" as const } : {}),
    revision: "test-revision", version: "optimized" };
  deck.checks!.text = { key: textCheckKey(deck), issues: [], model: "review-model" };
  const context = { ...scope, lessonNumber: deck.lessonNumber, strategy };
  const value = { version: 1, key: slideDraftKey(context), deck };
  const restored = restoreSlideDraft(structuredClone(value), context)!;
  expect(Object.keys(restored.promptProvenance!)).toEqual(Object.keys(deck.promptProvenance));
  expect(restored.checks!.text!.key).toBe(textCheckKey(restored));
  for (const visual of restored.draft.visuals) {
    expect(restored.checks!.images[visual.id].key).toBe(imageCheckKey(restored, visual.id));
  }

  value.deck.draft.slides[0].title = "A new teacher edit";
  const edited = restoreSlideDraft(structuredClone(value), context)!;
  expect(edited.checks!.text!.key).toBe(deck.checks!.text!.key);
  expect(edited.checks!.text!.key).not.toBe(textCheckKey(edited));
});

it("restores only validated provenance fields without trusting extra properties", () => {
  const value = stored();
  const provenance = JSON.parse('{"sourceSha256":"' + "a".repeat(64) + '","__proto__":{"approved":true},"revision":"test","analogyMethod":"unsupported","version":"optimized","approved":true}');
  value.deck.promptProvenance = provenance;
  const restored = restoreSlideDraft(value, scope)!;
  expect(Object.keys(restored.promptProvenance!)).toEqual(["sourceSha256", "revision", "version"]);
  expect(restored.promptProvenance).toEqual({ sourceSha256: "a".repeat(64), revision: "test", version: "optimized" });
  provenance.sourceSha256 = "invalid";
  expect(restoreSlideDraft(value, scope)!.promptProvenance).toBeUndefined();
});

it.each([
  { userId: "another-teacher" }, { classId: "ea-class-b" }, { assignmentId: "ea-task-b" },
  { lessonNumber: 8 }, { strategy: "experience bridging" as const },
])("never restores across a changed workspace identity: %j", change => {
  expect(() => restoreSlideDraft(stored(), { ...scope, ...change })).toThrow();
});

it("rejects a mismatched deck even if its envelope key is correct", () => {
  const value = stored(); value.deck.lessonNumber = 8;
  expect(() => restoreSlideDraft(value, scope)).toThrow("does not match");
});

it("retains unfinished blank teacher edits but rejects malformed text and non-inline images", () => {
  const value = stored(); value.deck.draft.slides[0].title = ""; value.deck.draft.slides[0].teacherNotes = [""];
  expect(restoreSlideDraft(value, scope)?.draft.slides[0].title).toBe("");
  value.deck.assets.evidence.data = "https://example.test/unsafe.png";
  expect(() => restoreSlideDraft(value, scope)).toThrow("image");
  const malformed = stored(); (malformed.deck.draft.slides[0] as unknown as Record<string, unknown>).body = null;
  expect(() => restoreSlideDraft(malformed, scope)).toThrow();
});

it("discards malformed review snapshots so they cannot bypass a fresh check", () => {
  const value = stored();
  (value.deck.checks!.text as unknown as Record<string, unknown>).issues = "not an array";
  expect(restoreSlideDraft(value, scope)?.checks?.text).toBeUndefined();
});

it("fails explicitly when storage is unavailable instead of claiming that a draft was saved", async () => {
  vi.stubGlobal("indexedDB", undefined);
  await expect(saveSlideDraft(scope, stored().deck)).rejects.toThrow("unavailable");
  await expect(loadSlideDraft(scope)).rejects.toThrow("unavailable");
});

it("serializes writes per scope and waits for transaction commit before reporting a save", async () => {
  const rows = new Map<string, unknown>();
  const pending: (() => void)[] = [];
  const database = {
    close: vi.fn(),
    transaction: vi.fn((_store: string, mode: string) => {
      const transaction = { oncomplete: () => {}, onabort: () => {}, onerror: () => {}, objectStore: () => ({
        put: (value: unknown, key: string) => { pending.push(() => { rows.set(key, structuredClone(value)); transaction.oncomplete(); }); },
        get: (key: string) => { const request = { result: rows.get(key) }; queueMicrotask(() => transaction.oncomplete()); return request; },
      }) };
      expect(["readwrite", "readonly"]).toContain(mode);
      return transaction;
    }),
  };
  vi.stubGlobal("indexedDB", { open: () => {
    const request = { result: database, onsuccess: () => {} };
    queueMicrotask(() => request.onsuccess()); return request;
  } });
  const first = stored().deck; const second = structuredClone(first); second.draft.slides[0].title = "Latest teacher edit";
  let saved = false;
  const firstSave = saveSlideDraft(scope, first).then(() => { saved = true; });
  const secondSave = saveSlideDraft(scope, second);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  expect(saved).toBe(false);
  expect(rows.size).toBe(0);
  pending.shift()!(); await firstSave;
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending.shift()!(); await secondSave;
  expect((await loadSlideDraft(scope))?.draft.slides[0].title).toBe("Latest teacher edit");
});
