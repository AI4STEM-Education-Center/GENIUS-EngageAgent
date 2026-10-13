import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isSlideDeckPublished, slidePublicationContentKey } from "@/lib/slides/publication-status";
import { projectPublishedSlides } from "@/lib/slides/publication";
import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext } from "@/lib/auth";
import { deckFixture } from "../fixtures/slides";

const scope = { classId: "host-class", assignmentId: "host-task" };
const deck = deckFixture("cognitive conflict");
const id = "4e96360b-17a4-4a54-84da-df0c5d2ef012";
const snapshot = () => ({ published: true, publicationId: id, contentItemId: `slides-${deck.id}`,
  slides: { publicationId: id, lessonNumber: deck.lessonNumber, slideCount: deck.draft.slides.length },
  manifest: projectPublishedSlides(deck), assets: Object.fromEntries(Object.entries(deck.assets).map(([name, asset]) => [name,
    { width: asset.width, height: asset.height, digest: createHash("sha256").update(Buffer.from(asset.data.split(",")[1], "base64")).digest("hex") }])) });
const fetchMock = vi.fn();
const check = (value = deck) => isSlideDeckPublished(value, scope, new AbortController().signal);
beforeEach(() => { fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => snapshot() }); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); clearVerifiedClientAuth(); });

it("recognizes exact published content with only an authenticated read and no asset upload", async () => {
  setVerifiedClientAuth("status-token", scope as UserContext);
  expect(await check()).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/slides/publication?classId=host-class&assignmentId=host-task&deckId=${deck.id}`);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer status-token" }, cache: "no-store" });
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
});

it("ignores review findings and teacher notes but distinguishes text and image revisions", async () => {
  const changed = structuredClone(deck);
  changed.checks = { images: {}, text: { key: "review", issues: ["Optional advice"] } };
  changed.draft.slides[0].teacherNotes = ["Private revised facilitation note"];
  expect(slidePublicationContentKey(changed)).toBe(slidePublicationContentKey(deck));
  expect(await check(changed)).toBe(true);
  changed.draft.slides[0].title = "Different student-facing title";
  expect(slidePublicationContentKey(changed)).not.toBe(slidePublicationContentKey(deck));
  expect(await check(changed)).toBe(false);
  const image = structuredClone(deck); image.assets.evidence.data = "data:image/png;base64,Y2hhbmdlZA==";
  expect(await check(image)).toBe(false);
});

it("accepts server object attribute reordering while preserving meaningful slide order", async () => {
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => reorder(snapshot()) });
  expect(await check()).toBe(true);
  const changed = snapshot(); changed.manifest.pages.reverse();
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => changed });
  expect(await check()).toBe(false);
});

it("does not treat unpublished, foreign, invalid, or failed status responses as published", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ published: false }) });
  expect(await check()).toBe(false);
  for (const result of [{ ...snapshot(), contentItemId: "slides-other" }, { lessons: [] }]) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => result });
    await expect(check()).rejects.toThrow();
  }
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Sign in" }) });
  await expect(check()).rejects.toThrow("Unable to verify");
});
