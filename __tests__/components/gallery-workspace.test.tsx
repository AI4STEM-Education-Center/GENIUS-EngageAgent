// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GalleryCopy, SavedGalleryCopy, SavedGalleryCopySummary } from "@/lib/material-gallery";
import type { SlideDeck } from "@/lib/slides/model";
import { deckFixture } from "../fixtures/slides";

const mocks = vi.hoisted(() => ({ list: vi.fn(), load: vi.fn(), save: vi.fn(), renew: vi.fn(), publish: vi.fn(), shared: null as GalleryCopy | null }));
vi.mock("@/lib/material-gallery-client", () => ({ listSavedGalleryCopies: mocks.list, loadSavedGalleryCopy: mocks.load,
  saveGalleryCopy: mocks.save, refreshGalleryCopyMedia: mocks.renew }));
vi.mock("@/lib/client-auth", () => ({ scopedTaskFetch: mocks.publish }));
vi.mock("@/app/components/MaterialGalleryPanel", () => ({ default: ({ onUse, disabled }: { onUse: (copy: GalleryCopy) => void; disabled?: boolean }) =>
  <button disabled={disabled} onClick={() => onUse(structuredClone(mocks.shared!))}>Adapt shared material</button> }));
vi.mock("@/app/components/SlidesWorkspace", async () => {
  const { useEffect, useState } = await import("react");
  return { default: function SlideEditor({ incomingDeck, draftNamespace, compactEditor, onDraftChange, onSaveDraft, onBusyChange }: {
    incomingDeck: SlideDeck; draftNamespace: string; compactEditor: boolean;
    onDraftChange: (deck: SlideDeck) => void; onSaveDraft: (deck: SlideDeck) => Promise<void>;
    onBusyChange: (strategy: string, busy: boolean) => void;
  }) {
    const [deck, setDeck] = useState(incomingDeck);
    useEffect(() => { onDraftChange(deck); }, [deck, onDraftChange]);
    return <section aria-label="Gallery slide editor" data-namespace={draftNamespace} data-compact={String(compactEditor)}>
      <label>Gallery slide title<input value={deck.draft.slides[0].title} onChange={event => setDeck({ ...deck, draft: { ...deck.draft,
        slides: deck.draft.slides.map((slide, index) => index === 0 ? { ...slide, title: event.target.value } : slide) } })} /></label>
      <button onClick={async () => { onBusyChange(deck.strategy, true); try { await onSaveDraft(deck); } catch { /* Parent shows save failures. */ } finally { onBusyChange(deck.strategy, false); } }}>Save slide changes</button>
    </section>;
  } };
});
import GalleryWorkspace from "@/app/components/GalleryWorkspace";

const user = { geniusId: "teacher-a", userId: "teacher-a", name: "Teacher", email: null, role: "teacher" as const,
  classId: "ea-class-a", assignmentId: "ea-task-a", className: "Physics" };
const scope = { classId: user.classId, assignmentId: user.assignmentId };
const source = { templateId: "shared-original", revision: 2, title: "Shared bouncing ball", mode: "adapt" as const };
const server = new Map<string, SavedGalleryCopy>();
const idOf = (copy: GalleryCopy) => copy.format === "slides" ? copy.deck.id : copy.item.id.replace(/^gallery-copy-/, "");
const summary = (value: SavedGalleryCopy): SavedGalleryCopySummary => ({ copyId: idOf(value.copy), revision: value.revision, savedAt: value.savedAt,
  format: value.copy.format, title: value.copy.format === "slides" ? value.copy.deck.draft.title : value.copy.item.title,
  lessonNumber: value.copy.format === "slides" ? value.copy.deck.lessonNumber : value.copy.item.lessonNumber!,
  strategy: value.copy.format === "slides" ? value.copy.deck.strategy : value.copy.item.strategy, source: value.copy.source });
function slides(): GalleryCopy {
  return { format: "slides", deck: { ...deckFixture("cognitive conflict"), id: "slide-copy-a", gallerySource: { ...source } }, source: { ...source } };
}
function video(): GalleryCopy {
  return { format: "video", item: { id: "gallery-copy-video-a", type: "Video", title: "Bouncing ball video", body: "Watch the ball during contact.",
    strategy: "cognitive conflict", lessonNumber: 3, gallerySource: { ...source } },
    media: { video: "https://media.test/ball.mp4?signature=old", image: "https://media.test/ball.png?signature=old" }, source: { ...source } };
}
function seed(copy: GalleryCopy, revision = 4) {
  const value = { copy: structuredClone(copy), revision, savedAt: "2026-11-04T14:00:00Z" };
  server.set(idOf(copy), value); return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function openShared(copy = slides()) {
  mocks.shared = copy;
  fireEvent.click(await screen.findByRole("button", { name: "Adapt shared material" }));
  await screen.findByRole("button", { name: "Back to Gallery" });
  await act(async () => {});
}
async function openSaved(format: "slides" | "video") {
  fireEvent.click(screen.getByRole("button", { name: "My saved materials" }));
  fireEvent.click(screen.getByRole("button", { name: format === "slides" ? "Slides" : "Video" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open" }));
  await screen.findByRole("button", { name: "Back to Gallery" });
  await act(async () => {});
}
async function editVideo(title: string, body?: string) {
  fireEvent.click(screen.getByRole("button", { name: "Edit material" }));
  const dialog = within(screen.getByRole("dialog", { name: "Edit video material" }));
  fireEvent.change(dialog.getByLabelText("Material title"), { target: { value: title } });
  if (body) fireEvent.change(dialog.getByLabelText("Activity text"), { target: { value: body } });
  fireEvent.click(dialog.getByRole("button", { name: "Apply changes" }));
  await act(async () => {});
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); server.clear(); mocks.shared = slides();
  mocks.list.mockImplementation(async () => ({ items: Array.from(server.values(), summary) }));
  mocks.load.mockImplementation(async (_scope, id: string) => structuredClone(server.get(id)!));
  mocks.save.mockImplementation(async (_scope, copy: GalleryCopy, revision: number) => {
    const saved = seed(copy, revision + 1); return summary(saved);
  });
  mocks.renew.mockResolvedValue({ video: "https://media.test/ball.mp4?signature=fresh", image: "https://media.test/ball.png?signature=fresh" });
  mocks.publish.mockResolvedValue({ ok: true, json: async () => ({ published: true }) });
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); });
});
const originalNavigation = Object.getOwnPropertyDescriptor(window, "navigation");
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers();
  if (originalNavigation) Object.defineProperty(window, "navigation", originalNavigation);
  else Reflect.deleteProperty(window, "navigation");
});

function browserHistory() {
  const navigation = new EventTarget();
  const emit = (key: string, options: { cancelable?: boolean; sameDocument?: boolean; navigationType?: string } = {}) => {
    const event = new Event("navigate", { cancelable: options.cancelable ?? true });
    Object.assign(event, { navigationType: options.navigationType ?? "traverse", destination: { key, sameDocument: options.sameDocument ?? true } });
    act(() => navigation.dispatchEvent(event));
    return event;
  };
  const traverseTo = vi.fn((key: string) => {
    expect(emit(key).defaultPrevented).toBe(false);
    return { committed: Promise.resolve(), finished: Promise.resolve() };
  });
  Object.defineProperty(window, "navigation", { configurable: true, value: Object.assign(navigation, { traverseTo }) });
  return { emit, traverseTo };
}

it("opens and edits a Gallery slide copy without leaving Gallery or changing the Step 3 draft, then saves without publishing", async () => {
  const back = vi.fn(); const published = vi.fn();
  const draftKey = `engage-agent:draft:v3:${user.classId}:${user.assignmentId}`;
  const originalDraft = JSON.stringify({ currentStep: 2, materialFormat: "video", selectedStrategies: ["analogy"], content: [{ id: "original-class-material" }] });
  localStorage.setItem(draftKey, originalDraft);
  render(<GalleryWorkspace user={user} onBack={back} onPublished={published} />);
  const shared = slides(); await openShared(shared);
  expect(screen.getByRole("heading", { name: "Gallery" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Gallery slide editor" })).toHaveAttribute("data-namespace", "gallery:slide-copy-a");
  expect(screen.getByRole("region", { name: "Gallery slide editor" })).toHaveAttribute("data-compact", "true");
  fireEvent.change(screen.getByLabelText("Gallery slide title"), { target: { value: "My saved opening" } });
  fireEvent.click(screen.getByRole("button", { name: "Save slide changes" }));
  await screen.findByText("Saved to your materials. Students see it only when you send it.");
  expect(mocks.save).toHaveBeenCalledWith(scope, expect.objectContaining({ format: "slides", deck: expect.objectContaining({ id: "slide-copy-a",
    gallerySource: source, draft: expect.objectContaining({ slides: expect.arrayContaining([expect.objectContaining({ title: "My saved opening" })]) }) }) }), 0, expect.any(AbortSignal));
  expect(localStorage.getItem(draftKey)).toBe(originalDraft);
  expect(shared.format === "slides" && shared.deck.draft.slides[0].title).not.toBe("My saved opening");
  expect(back).not.toHaveBeenCalled(); expect(published).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
});

it("reopens saved slides with the server revision and preserves edits after a conflicting save", async () => {
  seed(slides(), 7);
  const view = render(<GalleryWorkspace user={user} onBack={vi.fn()} />);
  await openSaved("slides");
  fireEvent.change(screen.getByLabelText("Gallery slide title"), { target: { value: "First saved revision" } });
  fireEvent.click(screen.getByRole("button", { name: "Save slide changes" }));
  await screen.findByText("Saved to your materials. Students see it only when you send it.");
  expect(mocks.save.mock.calls[0][2]).toBe(7);
  view.unmount(); render(<GalleryWorkspace user={user} onBack={vi.fn()} />);
  await openSaved("slides");
  expect(screen.getByLabelText("Gallery slide title")).toHaveValue("First saved revision");
  fireEvent.change(screen.getByLabelText("Gallery slide title"), { target: { value: "Keep my conflicting edit" } });
  mocks.save.mockRejectedValueOnce(new Error("A newer revision was saved elsewhere. Reopen this material."));
  fireEvent.click(screen.getByRole("button", { name: "Save slide changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("newer revision");
  expect(mocks.save.mock.calls.at(-1)?.[2]).toBe(8);
  expect(screen.getByLabelText("Gallery slide title")).toHaveValue("Keep my conflicting edit");
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(screen.queryByText("Saved to your materials. Students see it only when you send it.")).toBeNull();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("saves edited video text and renewed media first, then publishes exactly that saved copy without a public revision field", async () => {
  const published = vi.fn(); render(<GalleryWorkspace user={user} onBack={vi.fn()} onPublished={published} />);
  await openShared(video()); await editVideo("Our video title", "Our own contact activity.");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved to your materials. Students see it only when you send it.");
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.save.mock.calls[0][2]).toBe(0);
  const pending = deferred<SavedGalleryCopySummary>();
  mocks.save.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  expect(mocks.save.mock.calls[1][2]).toBe(1);
  expect(mocks.publish).not.toHaveBeenCalled();
  const copy = mocks.save.mock.calls[1][1] as GalleryCopy;
  await act(async () => pending.resolve(summary(seed(copy, 2))));
  await screen.findByText("Sent to students in this task.");
  expect(mocks.publish).toHaveBeenCalledOnce();
  const [publishedScope, endpoint, init] = mocks.publish.mock.calls[0];
  expect(publishedScope).toEqual(scope); expect(endpoint).toBe("/api/content-publish");
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ ...scope, publishedBy: user.userId, contentItems: [{ id: "gallery-copy-video-a", title: "Our video title", body: "Our own contact activity.", media: { video: "https://media.test/ball.mp4?signature=fresh" } }] });
  expect(body.contentItems).toHaveLength(1); expect(body.contentItems[0]).not.toHaveProperty("gallerySavedRevision");
  expect(published).toHaveBeenCalledOnce();
});

it("blocks video publication after a failed save and keeps edited text available for retry", async () => {
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />);
  await openShared(video()); await editVideo("Retain this video edit");
  mocks.save.mockRejectedValueOnce(new Error("Storage temporarily unavailable."));
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage temporarily unavailable");
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Retain this video edit" })).toBeVisible();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(screen.queryByText("Sent to students in this task.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByText("Sent to students in this task."); expect(mocks.publish).toHaveBeenCalledOnce();
});

it("offers keep editing, discard, and save-and-leave without implicitly publishing", async () => {
  const back = vi.fn(); render(<GalleryWorkspace user={user} onBack={back} />);
  await openShared(video()); await editVideo("Unsaved Gallery changes");
  fireEvent.click(screen.getByRole("button", { name: "Back to Gallery" }));
  const prompt = await screen.findByRole("alertdialog", { name: "Save your Gallery changes" });
  fireEvent.click(within(prompt).getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByRole("heading", { name: "Unsaved Gallery changes" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to Gallery" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.queryByRole("button", { name: "Back to Gallery" })).toBeNull();
  expect(screen.getByRole("button", { name: "My saved materials" })).toHaveAttribute("aria-pressed", "true");
  expect(mocks.save).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Browse materials" })); await openShared(video());
  await editVideo("Save before exiting");
  fireEvent.click(screen.getByRole("button", { name: "Back to task" }));
  const pending = deferred<SavedGalleryCopySummary>(); mocks.save.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  expect(back).not.toHaveBeenCalled();
  await act(async () => pending.resolve(summary(seed(mocks.save.mock.calls[0][1], 1))));
  await waitFor(() => expect(back).toHaveBeenCalledOnce());
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("retains the leave dialog and current copy if save-and-leave fails", async () => {
  const back = vi.fn(); render(<GalleryWorkspace user={user} onBack={back} />);
  await openShared(slides()); fireEvent.change(screen.getByLabelText("Gallery slide title"), { target: { value: "Keep this opening" } });
  fireEvent.click(screen.getByRole("button", { name: "Back to task" }));
  mocks.save.mockRejectedValueOnce(new Error("Save interrupted."));
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  await screen.findByText("Save interrupted.");
  expect(screen.getByRole("alertdialog")).toBeVisible(); expect(back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Gallery slide title")).toHaveValue("Keep this opening");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("registers the same dirty guard for external navigation and unregisters on unmount", async () => {
  const register = vi.fn(); const navigate = vi.fn();
  const view = render(<GalleryWorkspace user={user} onBack={vi.fn()} registerLeaveGuard={register} />);
  await openShared(slides());
  act(() => register.mock.calls.at(-1)![0](navigate));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(navigate).toHaveBeenCalledOnce();
  view.unmount(); expect(register).toHaveBeenLastCalledWith(null);
});

it("aborts a pending saved-copy load when switching task scope and ignores the late old copy", async () => {
  seed(slides()); const pending = deferred<SavedGalleryCopy>(); mocks.load.mockReturnValueOnce(pending.promise);
  const view = render(<GalleryWorkspace key="task-a" user={user} onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "My saved materials" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open" }));
  const signal = mocks.load.mock.calls[0][2] as AbortSignal;
  mocks.list.mockResolvedValue({ items: [] });
  view.rerender(<GalleryWorkspace key="task-b" user={{ ...user, classId: "ea-class-b", assignmentId: "ea-task-b" }} onBack={vi.fn()} />);
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(seed(slides())));
  expect(screen.queryByRole("region", { name: "Gallery slide editor" })).toBeNull();
  expect(mocks.list).toHaveBeenLastCalledWith({ classId: "ea-class-b", assignmentId: "ea-task-b" }, expect.any(AbortSignal));
  expect(mocks.save).not.toHaveBeenCalled();
});

it("aborts pending video send on unmount and never publishes after its save completes late", async () => {
  const published = vi.fn(); const pending = deferred<SavedGalleryCopySummary>();
  const view = render(<GalleryWorkspace user={user} onBack={vi.fn()} onPublished={published} />);
  await openShared(video()); mocks.save.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  const signal = mocks.save.mock.calls[0][3] as AbortSignal; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(summary(seed(mocks.save.mock.calls[0][1], 1))));
  expect(mocks.publish).not.toHaveBeenCalled(); expect(published).not.toHaveBeenCalled();
});

it("does not execute an old leave destination after the saving workspace is unmounted", async () => {
  const back = vi.fn(); const pending = deferred<SavedGalleryCopySummary>();
  const view = render(<GalleryWorkspace user={user} onBack={back} />);
  await openShared(slides()); fireEvent.click(screen.getByRole("button", { name: "Back to task" }));
  mocks.save.mockReturnValueOnce(pending.promise); fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  const signal = mocks.save.mock.calls[0][3] as AbortSignal; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(summary(seed(mocks.save.mock.calls[0][1], 1))));
  expect(back).not.toHaveBeenCalled();
});

it("renews saved video media without replacing unsaved text with the older server version", async () => {
  const original = video(); seed(original, 5);
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openSaved("video");
  await editVideo("My unsaved video title", "My unsaved activity wording.");
  const refreshed = structuredClone(original);
  if (refreshed.format !== "video") throw new Error("Expected video fixture");
  refreshed.media = { video: "https://media.test/ball.mp4?signature=renewed", image: "https://media.test/ball.png?signature=renewed" };
  mocks.load.mockResolvedValueOnce({ copy: refreshed, revision: 5, savedAt: "2026-11-04T14:00:00Z" });
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(screen.getByLabelText("Gallery video")).toHaveAttribute("src", refreshed.media.video));
  expect(screen.getByRole("heading", { name: "My unsaved video title" })).toBeVisible();
  expect(screen.getByText("My unsaved activity wording.", { selector: "p" })).toBeVisible();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved to your materials. Students see it only when you send it.");
  expect(mocks.save).toHaveBeenCalledWith(scope, expect.objectContaining({ item: expect.objectContaining({ title: "My unsaved video title", body: "My unsaved activity wording." }), media: refreshed.media }), 5, expect.any(AbortSignal));
});

it("keeps text being typed in the video dialog when media links renew", async () => {
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openShared(video());
  fireEvent.click(screen.getByRole("button", { name: "Edit material" }));
  const dialog = within(screen.getByRole("dialog", { name: "Edit video material" }));
  fireEvent.change(dialog.getByLabelText("Activity text"), { target: { value: "Still typing this activity." } });
  mocks.renew.mockResolvedValueOnce({ video: "https://media.test/ball.mp4?signature=latest" });
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(dialog.getByLabelText("Video being adapted")).toHaveAttribute("src", "https://media.test/ball.mp4?signature=latest"));
  expect(dialog.getByLabelText("Activity text")).toHaveValue("Still typing this activity.");
  fireEvent.click(dialog.getByRole("button", { name: "Apply changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved to your materials. Students see it only when you send it.");
  expect(mocks.save.mock.calls[0][1]).toMatchObject({ item: { body: "Still typing this activity." }, media: { video: "https://media.test/ball.mp4?signature=latest" } });
});

it.each(["previous-task-entry", "next-task-entry"])("guards browser traversal to %s without modifying or trapping history", async destination => {
  const history = browserHistory();
  const push = vi.spyOn(window.history, "pushState"), replace = vi.spyOn(window.history, "replaceState"), go = vi.spyOn(window.history, "go");
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openShared(slides());
  fireEvent.change(screen.getByLabelText("Gallery slide title"), { target: { value: "Unsaved history edit" } });
  expect(history.emit(destination).defaultPrevented).toBe(true);
  expect(history.traverseTo).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Gallery slide title")).toHaveValue("Unsaved history edit");
  expect(history.emit(destination).defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(history.traverseTo).toHaveBeenCalledExactlyOnceWith(destination);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(go).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
});

it("saves the current copy before resuming browser traversal and freezes slide editing during the save", async () => {
  const history = browserHistory(), pending = deferred<SavedGalleryCopySummary>();
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openShared(slides());
  fireEvent.change(screen.getByLabelText("Gallery slide title"), { target: { value: "Save before browser Back" } });
  history.emit("previous-entry"); mocks.save.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  expect(screen.getByLabelText("Gallery slide title")).toBeDisabled();
  expect(history.traverseTo).not.toHaveBeenCalled();
  const savedCopy = mocks.save.mock.calls[0][1] as GalleryCopy;
  expect(savedCopy.format === "slides" && savedCopy.deck.draft.slides[0].title).toBe("Save before browser Back");
  await act(async () => pending.resolve(summary(seed(savedCopy, 1))));
  expect(history.traverseTo).toHaveBeenCalledExactlyOnceWith("previous-entry");
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("leaves clean browser history alone and removes its guard on save and unmount", async () => {
  const history = browserHistory(); seed(slides());
  const view = render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openSaved("slides");
  expect(history.emit("clean-entry").defaultPrevented).toBe(false);
  fireEvent.change(screen.getByLabelText("Gallery slide title"), { target: { value: "Changed" } });
  expect(history.emit("dirty-entry").defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Save slide changes" }));
  await screen.findByText("Saved to your materials. Students see it only when you send it.");
  expect(history.emit("saved-entry").defaultPrevented).toBe(false);
  fireEvent.change(screen.getByLabelText("Gallery slide title"), { target: { value: "Another change" } });
  view.unmount();
  expect(history.emit("after-unmount").defaultPrevented).toBe(false);
  expect(history.traverseTo).not.toHaveBeenCalled();
});

it.each([{ cancelable: false }, { sameDocument: false }, { navigationType: "push" }, { navigationType: "reload" }])("does not counterfeit cancellation for an unsupported traversal: %j", async options => {
  const history = browserHistory();
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openShared(slides());
  expect(history.emit("destination", options).defaultPrevented).toBe(false);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(history.traverseTo).not.toHaveBeenCalled();
});

it("retains edits and permits retry when the selected history entry can no longer be reached", async () => {
  const history = browserHistory();
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openShared(video());
  await editVideo("Keep this after navigation failure");
  history.emit("removed-entry");
  history.traverseTo.mockReturnValueOnce({ committed: Promise.reject(new Error("Entry removed")), finished: Promise.reject(new Error("Entry removed")) });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Navigation could not finish");
  expect(screen.getByRole("heading", { name: "Keep this after navigation failure" })).toBeVisible();
  expect(history.emit("available-entry").defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("holds a cancelable traversal while a save is in flight without adding history entries", async () => {
  const history = browserHistory(), pending = deferred<SavedGalleryCopySummary>();
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openShared(slides());
  mocks.save.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Save slide changes" }));
  expect(history.emit("previous-entry").defaultPrevented).toBe(true);
  expect(screen.getByText("Wait for the current operation to finish.")).toBeVisible();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await act(async () => pending.resolve(summary(seed(mocks.save.mock.calls[0][1], 1))));
  expect(history.emit("previous-entry").defaultPrevented).toBe(false);
  expect(history.traverseTo).not.toHaveBeenCalled();
});

it("retains native full-page leave protection when the Navigation API is unavailable", async () => {
  Reflect.deleteProperty(window, "navigation");
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openShared(slides());
  const event = new Event("beforeunload", { cancelable: true });
  act(() => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("protects unapplied video modal text and never offers to save the older parent copy", async () => {
  const history = browserHistory(), register = vi.fn(), leave = vi.fn();
  seed(video());
  render(<GalleryWorkspace user={user} onBack={vi.fn()} registerLeaveGuard={register} />); await openSaved("video");
  fireEvent.click(screen.getByRole("button", { name: "Edit material" }));
  const dialog = within(screen.getByRole("dialog", { name: "Edit video material" }));
  fireEvent.change(dialog.getByLabelText("Activity text"), { target: { value: "My unapplied video wording." } });
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send to students" })).toBeDisabled();
  expect(dialog.getByRole("button", { name: "Apply changes" })).toBeEnabled();
  expect(history.emit("previous-task").defaultPrevented).toBe(true);
  act(() => register.mock.calls.at(-1)![0](leave));
  expect(leave).not.toHaveBeenCalled();
  expect(screen.getByText(/Finish editing the video before leaving/)).toBeVisible();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(dialog.getByLabelText("Activity text")).toHaveValue("My unapplied video wording.");
  const unload = new Event("beforeunload", { cancelable: true });
  act(() => window.dispatchEvent(unload)); expect(unload.defaultPrevented).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();

  fireEvent.click(dialog.getByRole("button", { name: "Apply changes" }));
  expect(history.emit("previous-task").defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  await waitFor(() => expect(history.traverseTo).toHaveBeenCalledExactlyOnceWith("previous-task"));
  expect(mocks.save.mock.calls[0][1]).toMatchObject({ item: { body: "My unapplied video wording." } });
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("releases modal leave protection after explicitly cancelling an unchanged saved video", async () => {
  const history = browserHistory(); seed(video());
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openSaved("video");
  fireEvent.click(screen.getByRole("button", { name: "Edit material" }));
  const dialog = within(screen.getByRole("dialog", { name: "Edit video material" }));
  fireEvent.change(dialog.getByLabelText("Material title"), { target: { value: "Discard this modal title" } });
  expect(history.emit("previous-task").defaultPrevented).toBe(true);
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText(/Finish editing the video/)).toBeNull();
  expect(screen.getByRole("heading", { name: "Bouncing ball video" })).toBeVisible();
  expect(history.emit("previous-task").defaultPrevented).toBe(false);
  const unload = new Event("beforeunload", { cancelable: true });
  act(() => window.dispatchEvent(unload)); expect(unload.defaultPrevented).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
});

it("shows the leave confirmation as a focused modal and treats Escape as keep editing", async () => {
  const back = vi.fn(); render(<GalleryWorkspace user={user} onBack={back} />); await openShared(slides());
  fireEvent.change(screen.getByLabelText("Gallery slide title"), { target: { value: "Keep the long deck edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Back to task" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Save your Gallery changes" });
  expect(dialog.tagName).toBe("DIALOG"); expect(dialog).toHaveAttribute("open");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(within(dialog).getByRole("button", { name: "Keep editing" })).toHaveFocus();
  const escape = new Event("cancel", { cancelable: true }); fireEvent(dialog, escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByLabelText("Gallery slide title")).toHaveValue("Keep the long deck edit");
  expect(back).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});

it("cancels the leave intent on Escape while allowing an in-flight save to finish", async () => {
  const back = vi.fn(), pending = deferred<SavedGalleryCopySummary>();
  render(<GalleryWorkspace user={user} onBack={back} />); await openShared(slides());
  fireEvent.click(screen.getByRole("button", { name: "Back to task" }));
  mocks.save.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await act(async () => pending.resolve(summary(seed(mocks.save.mock.calls[0][1], 1))));
  expect(screen.getByText("Saved to your materials. Students see it only when you send it.")).toBeVisible();
  expect(back).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
});

it("protects full-page exits while a clean saved slide editor is busy", async () => {
  seed(slides()); const pending = deferred<SavedGalleryCopySummary>();
  render(<GalleryWorkspace user={user} onBack={vi.fn()} />); await openSaved("slides");
  const before = new Event("beforeunload", { cancelable: true });
  act(() => window.dispatchEvent(before)); expect(before.defaultPrevented).toBe(false);
  mocks.save.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Save slide changes" }));
  const during = new Event("beforeunload", { cancelable: true });
  act(() => window.dispatchEvent(during)); expect(during.defaultPrevented).toBe(true);
  await act(async () => pending.resolve(summary(seed(mocks.save.mock.calls[0][1], 5))));
  const after = new Event("beforeunload", { cancelable: true });
  act(() => window.dispatchEvent(after)); expect(after.defaultPrevented).toBe(false);
});
