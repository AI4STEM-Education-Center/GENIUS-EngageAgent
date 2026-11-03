import { afterEach, expect, it, vi } from "vitest";
import { listMaterialGallery, copyGalleryMaterial, previewGalleryMaterial } from "@/lib/material-gallery-client";
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
