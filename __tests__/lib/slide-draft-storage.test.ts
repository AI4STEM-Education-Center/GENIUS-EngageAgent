import { afterEach, expect, it, vi } from "vitest";
import { loadSlideDraft, restoreSlideDraft, saveSlideDraft, slideDraftKey, type SlideDraftScope } from "@/lib/slides/draft-storage";
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
