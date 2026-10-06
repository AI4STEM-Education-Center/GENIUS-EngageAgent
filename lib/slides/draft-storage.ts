import { isSlideAsset, parseDraft, type SlideCheck, type SlideDeck, type SlideDraft, type SlideStrategy } from "./model";
import { isSlidePromptVersion } from "./prompt-versions";
import { isAnalogyMethod } from "./analogy-methods";

export type SlideDraftScope = { userId: string; classId: string; assignmentId: string; lessonNumber: number; strategy: SlideStrategy };
const DATABASE = "engageagent-slide-drafts";
const STORE = "drafts";
const VERSION = 1;
const writes = new Map<string, Promise<void>>();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const shortText = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;

export const slideDraftKey = (scope: SlideDraftScope) => JSON.stringify([scope.userId, scope.classId, scope.assignmentId, scope.lessonNumber, scope.strategy]);

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("Browser draft storage is unavailable.")); return; }
    const request = indexedDB.open(DATABASE, VERSION);
    let finished = false;
    const timer = setTimeout(() => fail(), 10_000);
    function fail() {
      if (finished) return;
      finished = true; clearTimeout(timer);
      reject(new Error("Browser draft storage is unavailable."));
    }
    request.onblocked = fail;
    request.onerror = fail;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      finished = true; clearTimeout(timer);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

// An empty field can be an unfinished teacher edit. Validate its shape and bounds
// with a placeholder, while retaining the exact unfinished text in the snapshot.
function editableDraft(value: unknown, strategy: SlideStrategy): SlideDraft {
  if (!record(value) || !Array.isArray(value.slides) || !Array.isArray(value.visuals)) throw new Error("Invalid saved draft.");
  const nonempty = (text: unknown) => typeof text === "string" && !text.trim() ? "Draft" : text;
  const placeholder = (entry: unknown, fields: string[]) => record(entry) ? Object.fromEntries(Object.entries(entry).map(([key, item]) => [key,
    fields.includes(key) ? nonempty(item) : key === "teacherNotes" && Array.isArray(item) ? item.map(nonempty) : item])) : entry;
  parseDraft({ ...value, title: nonempty(value.title), slides: value.slides.map(slide => placeholder(slide, ["title", "body", "task"])),
    visuals: value.visuals.map(visual => placeholder(visual, ["prompt", "caption", "alt"])) }, strategy, true);
  return value as SlideDraft;
}

function check(value: unknown): SlideCheck | undefined {
  if (!record(value) || !shortText(value.key, 25_000_000) || !Array.isArray(value.issues) || value.issues.length > 50
    || !value.issues.every(issue => shortText(issue, 4000)) || (value.model !== undefined && !shortText(value.model, 160))
    || (value.imageData !== undefined && !shortText(value.imageData, 12_000_000))) return;
  return { key: value.key, issues: value.issues as string[], ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.imageData === "string" ? { imageData: value.imageData } : {}) };
}

export function restoreSlideDraft(value: unknown, scope: SlideDraftScope): SlideDeck | null {
  if (value === undefined) return null;
  if (!record(value) || value.version !== VERSION || value.key !== slideDraftKey(scope) || !record(value.deck)) throw new Error("The saved slide draft could not be restored.");
  const saved = value.deck;
  if (saved.lessonNumber !== scope.lessonNumber || saved.strategy !== scope.strategy || !shortText(saved.id, 160) || !saved.id || !record(saved.assets)) throw new Error("The saved slide draft does not match this workspace.");
  const draft = editableDraft(saved.draft, scope.strategy);
  const assets = Object.fromEntries(draft.visuals.flatMap(visual => {
    const asset = (saved.assets as Record<string, unknown>)[visual.id];
    if (asset === undefined) return [];
    if (!isSlideAsset(asset) || (asset.sourcePrompt !== undefined && !shortText(asset.sourcePrompt, 50_000))
      || (asset.referenceData !== undefined && !shortText(asset.referenceData, 12_000_000))
      || (asset.model !== undefined && !shortText(asset.model, 160))) throw new Error("A saved slide image is invalid.");
    return [[visual.id, asset]];
  }));
  const deck: SlideDeck = { id: saved.id, lessonNumber: scope.lessonNumber, strategy: scope.strategy, draft, assets };
  if (saved.classroomContext !== undefined) {
    if (!shortText(saved.classroomContext, 1200)) throw new Error("Saved classroom context is invalid.");
    deck.classroomContext = saved.classroomContext;
  }
  if (record(saved.modelSelection) && shortText(saved.modelSelection.textModel, 160) && shortText(saved.modelSelection.imageModel, 160)) {
    deck.modelSelection = { textModel: saved.modelSelection.textModel, imageModel: saved.modelSelection.imageModel };
  }
  if (shortText(saved.textModel, 160)) deck.textModel = saved.textModel;
  const provenance = saved.promptProvenance;
  if (record(provenance) && isSlidePromptVersion(provenance.version) && shortText(provenance.revision, 160)
    && typeof provenance.sourceSha256 === "string" && /^[a-f0-9]{64}$/u.test(provenance.sourceSha256)) {
    deck.promptProvenance = { version: provenance.version, revision: provenance.revision, sourceSha256: provenance.sourceSha256,
      ...(isAnalogyMethod(provenance.analogyMethod) ? { analogyMethod: provenance.analogyMethod } : {}) };
  }
  if (record(saved.checks) && record(saved.checks.images)) {
    const images = saved.checks.images;
    deck.checks = { text: check(saved.checks.text), images: Object.fromEntries(draft.visuals.flatMap(visual => {
      const restored = check(images[visual.id]);
      return restored ? [[visual.id, restored]] : [];
    })) };
  }
  // Review snapshots remain keyed to exact content. Human acceptance is renewed
  // after restoring; a stored object cannot silently approve a later export.
  return deck;
}

export async function loadSlideDraft(scope: SlideDraftScope): Promise<SlideDeck | null> {
  const key = slideDraftKey(scope);
  await writes.get(key)?.catch(() => {});
  const db = await openDatabase();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error("The saved slide draft could not be read."));
    });
    return restoreSlideDraft(value, scope);
  } finally { db.close(); }
}

export function saveSlideDraft(scope: SlideDraftScope, deck: SlideDeck): Promise<void> {
  const key = slideDraftKey(scope);
  const value = { key, version: VERSION, deck };
  // Validate before replacing the last good snapshot; preserve incomplete edits.
  try { restoreSlideDraft(value, scope); } catch (error) { return Promise.reject(error); }
  const previous = writes.get(key);
  const pending = (previous?.catch(() => {}) ?? Promise.resolve()).then(async () => {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(value, key);
        // A successful put request is not durable until the transaction commits.
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(new Error("The slide draft could not be saved on this device."));
      });
    } finally { db.close(); }
  });
  writes.set(key, pending);
  void pending.finally(() => { if (writes.get(key) === pending) writes.delete(key); }).catch(() => {});
  return pending;
}
