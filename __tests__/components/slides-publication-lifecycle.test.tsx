// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deckFixture } from "../fixtures/slides";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
const mocks = vi.hoisted(() => ({ publish: vi.fn(), download: vi.fn(), load: vi.fn(), previewMounted: vi.fn() }));
vi.mock("@/lib/slides/export", () => ({ downloadPresentation: mocks.download }));
vi.mock("@/lib/slides/publish-client", () => ({ publishSlideDeck: mocks.publish }));
vi.mock("@/lib/slides/draft-storage", async importOriginal => ({ ...await importOriginal<object>(), loadSlideDraft: mocks.load, saveSlideDraft: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/app/components/SlidePreview", async () => {
  const { useLayoutEffect } = await import("react");
  return { default: function Preview() {
    // Exercise an already-enabled control in the interval between DOM commit
    // and cleanup of the previous deck's passive effects.
    useLayoutEffect(() => { mocks.previewMounted(); }, []);
    return null;
  } };
});
import SlidesWorkspace from "@/app/components/SlidesWorkspace";
const user = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher" as const, classId: "ea-class-a", assignmentId: "ea-task-a" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(deckFixture("analogy"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lessons: [{ lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Track energy" }], models: INITIAL_MODEL_CATALOG }) }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ font: "", measureText: (text: string) => ({ width: text.length * 16 }) }) as never);
  mocks.publish.mockResolvedValue({ publicationId: "published", contentItemId: "slides-deck" });
  mocks.download.mockResolvedValue({ url: "blob:prepared", dataUri: "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEsDBA==", fileName: "Slides.pptx" });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps a publication started from the restored deck alive before passive restoration cleanup", async () => {
  mocks.previewMounted.mockImplementation(() => {
    screen.getByRole("button", { name: "Send to students" }).click();
  });
  render(<SlidesWorkspace user={user} />);
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(mocks.publish.mock.calls[0][2].aborted).toBe(false);
  await screen.findByRole("button", { name: "Published" });
});

it("keeps an export started from the restored deck alive before passive restoration cleanup", async () => {
  mocks.previewMounted.mockImplementation(() => {
    screen.getByRole("button", { name: "Download PPTX" }).click();
  });
  render(<SlidesWorkspace user={user} />);
  await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(mocks.download.mock.calls[0][3].aborted).toBe(false);
  await screen.findByRole("link", { name: "Save PPTX file" });
});
