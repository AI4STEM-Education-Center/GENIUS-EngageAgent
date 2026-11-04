// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deckFixture } from "../fixtures/slides";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
import type { SlideDeck } from "@/lib/slides/model";

const mocks = vi.hoisted(() => ({ load: vi.fn(), cache: vi.fn(), publish: vi.fn(), download: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/slides/draft-storage", async original => ({ ...await original<object>(), loadSlideDraft: mocks.load, saveSlideDraft: mocks.cache }));
vi.mock("@/lib/slides/export", () => ({ downloadPresentation: mocks.download }));
vi.mock("@/lib/slides/publish-client", () => ({ publishSlideDeck: mocks.publish }));
vi.mock("@/lib/slides/publication-status", async original => ({ ...await original<object>(), isSlideDeckPublished: vi.fn().mockResolvedValue(false) }));
vi.mock("@/app/components/SlidePreview", () => ({ default: () => <div>Preview</div> }));
import SlidesWorkspace from "@/app/components/SlidesWorkspace";

const user = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher" as const, classId: "ea-class-a", assignmentId: "ea-task-a" };
const context = { lessonNumber: 3, strategy: "cognitive conflict" as const };
function copy(id = "copy-a") {
  const deck = deckFixture(context.strategy); deck.id = id;
  deck.gallerySource = { templateId: "template-one", revision: 1, title: "Shared contact", mode: "adapt" };
  return deck;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockResolvedValue(copy()); mocks.cache.mockResolvedValue(undefined);
  mocks.publish.mockResolvedValue({ publicationId: "published", contentItemId: "slides-copy" });
  mocks.download.mockResolvedValue({ url: "blob:prepared", fileName: "Slides.pptx" });
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ lessons: [{ lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Explore contact" }], models: INITIAL_MODEL_CATALOG }) });
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const canvas = { font: "", measureText: (text: string) => ({ width: text.length * Number(canvas.font.match(/(\d+)px/u)?.[1] ?? 16) * .53 }) };
    return canvas as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses the server copy, isolates local caching, and reports actual edits without generating", async () => {
  const deck = copy(); const changed = vi.fn();
  const view = render(<SlidesWorkspace user={user} embeddedContext={context} draftNamespace="gallery:copy-a" compactEditor onDraftChange={changed} />);
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  expect(mocks.load).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Slide title")).toBeNull();
  view.rerender(<SlidesWorkspace user={user} embeddedContext={context} draftNamespace="gallery:copy-a" compactEditor incomingDeck={deck} onDraftChange={changed} />);
  await screen.findByLabelText("Slide title");
  await waitFor(() => expect(mocks.cache).toHaveBeenCalledWith(expect.objectContaining({ draftNamespace: "gallery:copy-a", userId: user.geniusId, classId: user.classId, assignmentId: user.assignmentId }), deck));
  expect(changed).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "My independent edit" } });
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ draft: expect.objectContaining({ slides: expect.arrayContaining([expect.objectContaining({ title: "My independent edit" })]) }) }));
  expect(deck.draft.slides[0].title).not.toBe("My independent edit");
  view.rerender(<SlidesWorkspace user={user} embeddedContext={{ ...context }} draftNamespace="gallery:copy-a" compactEditor incomingDeck={{ ...deck }} onDraftChange={changed} />);
  expect(screen.getByLabelText("Slide title")).toHaveValue("My independent edit");
  expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  expect(mocks.cache.mock.calls.every(([scope]) => scope.draftNamespace === "gallery:copy-a")).toBe(true);
  await act(async () => {});
});

it("keeps editing and the main actions visible while Advanced is initially closed", async () => {
  render(<SlidesWorkspace user={user} embeddedContext={context} incomingDeck={copy()} draftNamespace="gallery:copy-a" compactEditor onSaveDraft={vi.fn()} />);
  await screen.findByLabelText("Slide title");
  for (const name of ["Save changes", "Send to students", "Download PPTX"]) expect(screen.getByRole("button", { name })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Revise with AI" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Check slides" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Share to Gallery" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Teacher notes" }));
  fireEvent.change(screen.getByLabelText("Slide teacher notes"), { target: { value: "New private teaching note" } });
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  for (const name of ["Revise with AI", "Check slides", "Share to Gallery"]) expect(screen.getByRole("button", { name })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  expect(screen.getByLabelText("Slide teacher notes")).toHaveValue("New private teaching note");
  await act(async () => {});
});

it("does not claim a server save from device caching and retains edits across a failed save and retry", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("Connection lost. Try saving again.")).mockResolvedValue(undefined);
  render(<SlidesWorkspace user={user} embeddedContext={context} incomingDeck={copy()} draftNamespace="gallery:copy-a" compactEditor onSaveDraft={save} />);
  fireEvent.change(await screen.findByLabelText("Slide title"), { target: { value: "Keep my edited title" } });
  await waitFor(() => expect(mocks.cache).toHaveBeenCalled());
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(screen.getByLabelText("Slide title")).toHaveValue("Keep my edited title");
  expect(mocks.publish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Changes saved.");
  expect(screen.getByText("Saved changes")).toBeVisible();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].draft.slides[0].title).toBe("Keep my edited title");
});

it("keeps a newly copied deck unsaved until its first server save, even after device caching completes", async () => {
  const save = vi.fn().mockResolvedValue(undefined); const deck = copy();
  render(<SlidesWorkspace user={user} embeddedContext={context} incomingDeck={deck} incomingDeckSaved={false}
    draftNamespace="gallery:copy-a" compactEditor onSaveDraft={save} />);
  await screen.findByLabelText("Slide title");
  await waitFor(() => expect(mocks.cache).toHaveBeenCalled());
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(screen.queryByText("Saved changes")).toBeNull();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Changes saved.");
  expect(screen.getByText("Saved changes")).toBeVisible();
  expect(save).toHaveBeenCalledExactlyOnceWith(deck);
  expect(mocks.publish).not.toHaveBeenCalled();
});

it.each([true, false])("delegates leave protection only for the compact Gallery editor (compact: %s)", async compactEditor => {
  // An unfinished device save remains protected in the original Step 3 editor.
  mocks.cache.mockReturnValue(new Promise<void>(() => {}));
  render(<SlidesWorkspace user={user} embeddedContext={context} incomingDeck={copy()}
    {...(compactEditor ? { draftNamespace: "gallery:copy-a" } : {})} compactEditor={compactEditor} />);
  fireEvent.change(await screen.findByLabelText("Slide title"), { target: { value: "An unsaved edit" } });
  const leave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave);
  expect(leave.defaultPrevented).toBe(!compactEditor);
  await act(async () => {});
});

it("waits for saving the exact current deck before sending and never publishes on save failure", async () => {
  let finish!: () => void;
  const save = vi.fn().mockRejectedValueOnce(new Error("Save failed before publishing.")).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<SlidesWorkspace user={user} embeddedContext={context} incomingDeck={copy()} draftNamespace="gallery:copy-a" compactEditor onSaveDraft={save} />);
  fireEvent.change(await screen.findByLabelText("Slide title"), { target: { value: "The version to publish" } });
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByText("Save failed before publishing.");
  expect(mocks.publish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  expect(save).toHaveBeenCalledTimes(2);
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Slide title")).toBeDisabled();
  await act(async () => finish());
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish).toHaveBeenCalledOnce();
  expect(mocks.publish.mock.calls[0][0]).toBe(save.mock.calls[1][0]);
  expect(mocks.publish.mock.calls[0][0].draft.slides[0].title).toBe("The version to publish");
});

it("does not send a previous copy after its pending save resolves following a namespace switch", async () => {
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = copy(); const second = copy("copy-b"); second.draft.slides[0].title = "Second copy";
  const view = render(<SlidesWorkspace user={user} embeddedContext={context} incomingDeck={first} draftNamespace="gallery:copy-a" compactEditor onSaveDraft={save} />);
  fireEvent.click(await screen.findByRole("button", { name: "Send to students" }));
  expect(save).toHaveBeenCalledOnce();
  view.rerender(<SlidesWorkspace user={user} embeddedContext={context} incomingDeck={second} draftNamespace="gallery:copy-b" compactEditor onSaveDraft={save} />);
  await act(async () => finish());
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Slide title")).toHaveValue("Second copy");
  expect(screen.getByRole("button", { name: "Send to students" })).toBeEnabled();
  expect(mocks.cache.mock.calls.at(-1)?.[0].draftNamespace).toBe("gallery:copy-b");
});

it("allows offline editing and download but never reports successful save or send without a save callback", async () => {
  render(<SlidesWorkspace user={user} embeddedContext={context} incomingDeck={copy()} draftNamespace="gallery:copy-a" compactEditor />);
  fireEvent.change(await screen.findByLabelText("Slide title"), { target: { value: "Offline edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Saving is unavailable");
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("before sending"));
  expect(mocks.publish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByRole("link", { name: "Save PPTX file" });
  expect((mocks.download.mock.calls[0][0] as SlideDeck).draft.slides[0].title).toBe("Offline edit");
});
