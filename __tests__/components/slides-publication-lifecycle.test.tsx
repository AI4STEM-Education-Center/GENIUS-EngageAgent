// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deckFixture } from "../fixtures/slides";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
const mocks = vi.hoisted(() => ({ publish: vi.fn(), download: vi.fn(), load: vi.fn(), previewMounted: vi.fn(), status: vi.fn() }));
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
vi.mock("@/lib/slides/publication-status", async original => ({ ...await original<object>(), isSlideDeckPublished: mocks.status }));
import SlidesWorkspace from "@/app/components/SlidesWorkspace";
const user = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher" as const, classId: "ea-class-a", assignmentId: "ea-task-a" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.previewMounted.mockReset(); mocks.status.mockReset().mockResolvedValue(false);
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

it("restores the server-confirmed Published state without resending the browser draft", async () => {
  mocks.status.mockResolvedValue(true);
  render(<SlidesWorkspace user={user} />);
  expect((await screen.findByRole("button", { name: "Published" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.status).toHaveBeenCalledWith(expect.objectContaining({ id: "test-deck" }),
    { classId: user.classId, assignmentId: user.assignmentId }, expect.any(AbortSignal));
});

it("keeps Published after AI rechecking unchanged content but enables sending a student-facing edit", async () => {
  mocks.status.mockResolvedValue(true);
  render(<SlidesWorkspace user={user} />);
  await screen.findByRole("button", { name: "Published" });
  const calls = mocks.status.mock.calls.length;
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ issues: ["Optional teaching suggestion"] }) } as Response);
  fireEvent.click(screen.getByRole("button", { name: "Check slides" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Check slides" }) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole("button", { name: "Published" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.status).toHaveBeenCalledTimes(calls);
  mocks.status.mockResolvedValue(false);
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "A new student title" } });
  await waitFor(() => expect(mocks.status.mock.calls.length).toBeGreaterThan(calls));
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(false);
});

it("does not mark an edited draft published when an earlier status request resolves late", async () => {
  let finish: (matches: boolean) => void = () => {};
  mocks.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(false);
  render(<SlidesWorkspace user={user} />);
  await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());
  const signal = mocks.status.mock.calls[0][2] as AbortSignal;
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "Edited while status loads" } });
  await act(async () => finish(true));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole("button", { name: "Published" })).toBeNull();
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps direct sending available when publication status is unavailable", async () => {
  mocks.status.mockRejectedValue(new Error("Gateway unavailable"));
  render(<SlidesWorkspace user={user} />);
  await screen.findByText(/Publication status could not be checked/);
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish).toHaveBeenCalledOnce();
});
