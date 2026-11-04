import { afterEach, expect, it, vi } from "vitest";
import { listMaterialGallery, copyGalleryMaterial, previewGalleryMaterial, refreshGalleryCopyMedia, saveGalleryCopy, loadSavedGalleryCopy, listSavedGalleryCopies } from "@/lib/material-gallery-client";
import { deckFixture, tinyImage } from "../fixtures/slides";
import type { GalleryCopy } from "@/lib/material-gallery";
import { createHash } from "node:crypto";
const scope = { classId: "ea-class-one", assignmentId: "ea-task-one" };
afterEach(() => { vi.unstubAllGlobals(); });

it.each([{}, { items: undefined }, { items: [{ id: "bad" }] }, { items: [], nextCursor: {} }])("rejects malformed list responses without passing unusable data to the UI: %j", async data => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
  await expect(listMaterialGallery(scope)).rejects.toThrow("incomplete data");
});
it("treats a valid empty Gallery as empty rather than an error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));
  expect(await listMaterialGallery(scope)).toEqual({ items: [] });
});
it("does not hydrate or hand a malformed copied deck to the editor", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ format: "slides", deck: {} }) }); vi.stubGlobal("fetch", fetch);
  await expect(copyGalleryMaterial(scope, "template")).rejects.toThrow("incomplete data"); expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects malformed preview responses and preserves server error messages", async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Teacher access required." }) });
  vi.stubGlobal("fetch", fetch);
  await expect(previewGalleryMaterial(scope, "template")).rejects.toThrow("incomplete data");
  await expect(listMaterialGallery(scope)).rejects.toThrow("Teacher access required.");
});
it("refreshes a copy using a scoped read without copying or publishing again", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ media: { video: "https://saved.example/fresh-video", image: "https://saved.example/fresh-image" } }) });
  vi.stubGlobal("fetch", fetch);
  const id = "gallery-copy-02e5ce78-a55c-41ea-b866-69e7313fa9c3";
  expect(await refreshGalleryCopyMedia(scope, id)).toEqual({ video: "https://saved.example/fresh-video", image: "https://saved.example/fresh-image" });
  const [url, init] = fetch.mock.calls[0]; const params = new URL(url, "https://app.example").searchParams;
  expect(Object.fromEntries(params)).toEqual({ ...scope, action: "copy-media", copyId: id.slice(13) });
  expect(init.method).toBe("GET"); expect(init.cache).toBe("no-store");
});
it.each([{}, { media: {} }, { media: { video: "" } }, { media: { video: "/video", image: 1 } }])("rejects incomplete refreshed media: %j", async data => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
  await expect(refreshGalleryCopyMedia(scope, "gallery-copy-02e5ce78-a55c-41ea-b866-69e7313fa9c3")).rejects.toThrow("incomplete data");
});

const attribution = { templateId: "source-template", revision: 1, title: "Source ball", mode: "adapt" as const };
const saved = { copyId: "copy-id", revision: 1, savedAt: "2026-11-04T12:00:00Z", title: "Saved ball", format: "slides", lessonNumber: 3, strategy: "cognitive conflict", source: attribution };
const reply = (data: unknown) => ({ ok: true, json: async () => data });
const editableCopy = (): Extract<GalleryCopy, { format: "slides" }> => ({ format: "slides", source: attribution, deck: { ...deckFixture("cognitive conflict"), id: "copy-id", gallerySource: attribution } });

it("uploads a private slide snapshot in bounded parts before committing and passes the expected revision", async () => {
  const copy = editableCopy();
  copy.deck.assets.evidence.sourcePrompt = "The old, still applicable plan";
  const fetch = vi.fn().mockResolvedValueOnce(reply({ saveId: "save-id" })).mockResolvedValueOnce(reply({})).mockResolvedValueOnce(reply({ saved }));
  vi.stubGlobal("fetch", fetch);
  expect(await saveGalleryCopy(scope, copy, 0)).toEqual(saved);
  const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(bodies.map(b => b.action)).toEqual(["start-save", "upload-copy-asset", "commit-save"]);
  expect(bodies[0]).toMatchObject({ ...scope, copyId: "copy-id", expectedRevision: 0, assets: { evidence: { sourcePrompt: "The old, still applicable plan" } } });
  expect(JSON.stringify(bodies[0])).not.toContain("data:image");
  expect(bodies[0].metadata).toBeUndefined();
  expect(bodies[1].asset.data).toBe(tinyImage);
  expect(bodies[2]).toMatchObject({ copyId: "copy-id", saveId: "save-id" });
});

it("never commits a failed image upload and surfaces conflicts without silently retrying stale edits", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ saveId: "stage" })).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "Upload unavailable" }) });
  vi.stubGlobal("fetch", fetch);
  await expect(saveGalleryCopy(scope, editableCopy(), 0)).rejects.toThrow("Upload unavailable");
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockClear().mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "This copy has a newer saved version." }) });
  await expect(saveGalleryCopy(scope, editableCopy(), 0)).rejects.toThrow("newer saved version");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("restores images from one exact saved revision and retains their original plan instead of certifying edited prompts", async () => {
  const copy = editableCopy(); copy.deck.assets = {};
  copy.deck.draft.visuals[0].prompt = "An edited drawing plan";
  const ref = createHash("sha256").update(Buffer.from(tinyImage.split(",")[1], "base64")).digest("hex");
  const fetch = vi.fn().mockResolvedValueOnce(reply({ copy, revision: 3, savedAt: saved.savedAt, visualIds: ["evidence"] }))
    .mockResolvedValueOnce(reply({ asset: { data: tinyImage, width: 1, height: 1, sourcePrompt: "The previous drawing plan" }, referenceDigest: ref }));
  vi.stubGlobal("fetch", fetch);
  const loaded = await loadSavedGalleryCopy(scope, "copy-id");
  expect(loaded.revision).toBe(3);
  expect(loaded.copy.format).toBe("slides");
  if (loaded.copy.format === "slides") expect(loaded.copy.deck.assets.evidence).toEqual({ data: tinyImage, width: 1, height: 1, sourcePrompt: "The previous drawing plan", referenceData: tinyImage });
  const params = new URL(fetch.mock.calls[1][0], "https://app.example").searchParams;
  expect(Object.fromEntries(params)).toEqual({ ...scope, action: "saved-asset", copyId: "copy-id", revision: "3", visualId: "evidence" });
});

it("lists only validated saved summaries and refuses malformed saved material responses", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ items: [saved] })).mockResolvedValueOnce(reply({ items: [{}] })).mockResolvedValueOnce(reply({ copy: {}, revision: 1 }));
  vi.stubGlobal("fetch", fetch);
  expect(await listSavedGalleryCopies(scope)).toEqual({ items: [saved] });
  await expect(listSavedGalleryCopies(scope)).rejects.toThrow("incomplete data");
  await expect(loadSavedGalleryCopy(scope, "copy-id")).rejects.toThrow("incomplete data");
});
