// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import type { SlideDeck } from "@/lib/slides/model";
import { cognitiveConflictOpeningDeck, deckFixture, slideFixture } from "../fixtures/slides";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), fetch: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/slides/draft-storage", async importOriginal => ({ ...await importOriginal<object>(), loadSlideDraft: mocks.load, saveSlideDraft: mocks.save }));
vi.mock("@/lib/slides/export", () => ({ downloadPresentation: mocks.download, decodeSlideAsset: async (value: unknown) => value }));
vi.mock("@/lib/slides/publication-status", async original => ({ ...await original<object>(), isSlideDeckPublished: vi.fn().mockResolvedValue(false) }));
import SlidesWorkspace, { type SlidesWorkspaceHandle } from "@/app/components/SlidesWorkspace";

const user: UserContext = { geniusId: "teacher-a", userId: "teacher-a", role: "teacher", name: "Teacher", email: null, classId: "ea-class-a", assignmentId: "ea-task-a" };
const context = { lessonNumber: 3, strategy: "cognitive conflict" as const, classroomContext: "Grade 9; familiar with bouncing balls." };
const reply = (data: unknown) => ({ ok: true, json: async () => data });
const posts = () => mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockResolvedValue(null); mocks.save.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const canvas = { font: "", measureText: (text: string) => ({ width: text.length * Number(canvas.font.match(/(\d+)px/u)?.[1] ?? 16) * .53 }) };
    return canvas as never;
  });
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?")
    ? reply({ lessons: [{ lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Explore contact" }], models: INITIAL_MODEL_CATALOG })
    : path.endsWith("/check") ? reply({ issues: [] }) : path.endsWith("/image") ? reply({ asset: deckFixture(context.strategy).assets.evidence })
      : reply({ draft: slideFixture(context.strategy) }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("restores a saved deck ready to send without fresh human confirmation or paid requests", async () => {
  const saved = deckFixture(context.strategy); mocks.load.mockResolvedValue(saved);
  render(<SlidesWorkspace user={user} embeddedContext={context} />);
  await screen.findByText(/Saved draft restored/);
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe(saved.draft.slides[0].title);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  expect(posts()).toHaveLength(0);
  expect(mocks.load).toHaveBeenCalledWith({ userId: user.geniusId, classId: user.classId, assignmentId: user.assignmentId, lessonNumber: 3, strategy: context.strategy });
  expect(screen.queryByRole("region", { name: "Image recovery" })).toBeNull();
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(mocks.save.mock.calls.at(-1)![1].assets).toEqual(saved.assets);
});

it("commits the latest generated image and edit, then restores them when the editor remounts", async () => {
  const storage: { deck: SlideDeck | null } = { deck: null };
  mocks.load.mockImplementation(async () => storage.deck);
  mocks.save.mockImplementation(async (_scope, deck) => { storage.deck = structuredClone(deck); });
  const ref = createRef<SlidesWorkspaceHandle>(); const ready = vi.fn();
  const view = render(<SlidesWorkspace ref={ref} user={user} embeddedContext={context} onReadyChange={ready} />);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(context.strategy, true));
  act(() => ref.current?.generate()); await screen.findByText("5 slides ready to send.");
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "The teacher's latest title" } });
  await waitFor(() => expect(storage.deck?.draft.slides[0].title).toBe("The teacher's latest title"));
  expect(storage.deck?.assets.evidence.data).toBe(deckFixture(context.strategy).assets.evidence.data);
  const requestCount = posts().length;
  view.unmount(); render(<SlidesWorkspace user={user} embeddedContext={context} />);
  await screen.findByText(/Saved draft restored/);
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("The teacher's latest title");
  expect(posts()).toHaveLength(requestCount);
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(false);
});

it("ignores a late restore from the previous user/task and does not overwrite the new workspace", async () => {
  let resolveOld: (value: SlideDeck) => void = () => {};
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(null);
  const ref = createRef<SlidesWorkspaceHandle>(); const ready = vi.fn();
  const view = render(<SlidesWorkspace ref={ref} user={user} embeddedContext={context} onReadyChange={ready} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
  act(() => ref.current?.generate()); expect(posts()).toHaveLength(0);
  const secondUser = { ...user, geniusId: "teacher-b", assignmentId: "ea-task-b" };
  view.rerender(<SlidesWorkspace ref={ref} user={secondUser} embeddedContext={context} onReadyChange={ready} />);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(context.strategy, true));
  await act(async () => resolveOld(deckFixture(context.strategy)));
  expect(screen.queryByLabelText("Slide title")).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(posts()).toHaveLength(0);
});

it("aborts an old task's generation and ignores its late provider response after a task switch", async () => {
  const ref = createRef<SlidesWorkspaceHandle>(); const ready = vi.fn();
  const view = render(<SlidesWorkspace ref={ref} user={user} embeddedContext={context} onReadyChange={ready} />);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(context.strategy, true));
  let finish: (value: unknown) => void = () => {};
  mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => ref.current?.generate());
  const providerSignal = mocks.fetch.mock.calls.at(-1)![1].signal as AbortSignal;
  view.rerender(<SlidesWorkspace ref={ref} user={{ ...user, assignmentId: "ea-task-b" }} embeddedContext={context} onReadyChange={ready} />);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(context.strategy, true));
  expect(providerSignal.aborted).toBe(true);
  await act(async () => finish(reply({ draft: slideFixture(context.strategy) })));
  expect(screen.queryByLabelText("Slide title")).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(posts()).toHaveLength(1);
});

it("uses shared classroom context for new decks while restored revisions retain their original context", async () => {
  const saved = deckFixture(context.strategy); saved.classroomContext = "Earlier classroom context";
  mocks.load.mockResolvedValue(saved);
  const ref = createRef<SlidesWorkspaceHandle>(); const ready = vi.fn();
  render(<SlidesWorkspace ref={ref} user={user} embeddedContext={context} onReadyChange={ready} />);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(context.strategy, true));
  expect(screen.queryByLabelText("Classroom context (optional)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready to send.");
  expect(posts().find(body => body.operation === "review")?.classroomContext).toBe("Earlier classroom context");
  act(() => ref.current?.generate()); await screen.findByText("5 slides ready to send.");
  expect(posts().find(body => body.operation === "generate")?.classroomContext).toBe(context.classroomContext);
});

it("retains the visible draft when storage or the deployed gateway fails and offers actionable errors", async () => {
  const saved = deckFixture(context.strategy); mocks.load.mockResolvedValue(saved); mocks.save.mockRejectedValue(new Error("Quota exceeded"));
  render(<SlidesWorkspace user={user} embeddedContext={context} />);
  await screen.findByText(/could not be saved on this device/);
  mocks.fetch.mockResolvedValueOnce({ ok: false, status: 504, json: async () => { throw new SyntaxError("HTML gateway body"); } });
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText(/HTTP 504/);
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe(saved.draft.slides[0].title);
  expect(posts()).toHaveLength(1);
});

it("continues the native slide pipeline after asynchronous draft polling without submitting twice", async () => {
  const ref = createRef<SlidesWorkspaceHandle>(); const ready = vi.fn();
  render(<SlidesWorkspace ref={ref} user={user} embeddedContext={context} onReadyChange={ready} />);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(context.strategy, true));
  const defaultFetch = mocks.fetch.getMockImplementation()!; let polls = 0;
  const pending = { ...reply({ job: { id: "job-ui", pollAfterMs: 2000 } }), status: 202 };
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => path === "/api/slides" ? pending
    : path === "/api/slides/jobs" ? ++polls === 1 ? pending : { ...reply({ draft: slideFixture(context.strategy) }), status: 200 }
      : defaultFetch(path, init));
  vi.useFakeTimers();
  act(() => ref.current?.generate());
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(screen.getByText("5 slides ready to send.")).toBeTruthy();
  expect(mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides")).toHaveLength(1);
  expect(polls).toBe(2);
});

it("keeps the restored draft when an asynchronous revision fails at the provider", async () => {
  const saved = deckFixture(context.strategy); mocks.load.mockResolvedValue(saved);
  const ready = vi.fn();
  render(<SlidesWorkspace user={user} embeddedContext={context} onReadyChange={ready} />);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(context.strategy, true));
  mocks.fetch.mockResolvedValueOnce({ ...reply({ job: { id: "job-failed", pollAfterMs: 2000 } }), status: 202 })
    .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: "The provider could not finish this revision.", jobFailure: true }) })
    .mockResolvedValue(reply({ cancelled: true }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText("The provider could not finish this revision.")).toBeTruthy();
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe(saved.draft.slides[0].title);
  expect(posts().filter(body => body.operation === "review")).toHaveLength(1);
  expect(posts().filter(body => body.jobId === "job-failed" && !body.operation)).toHaveLength(1);
});


it("imports a Gallery copy without generation and ignores an older pending draft restore", async () => {
  let restore!: (value: SlideDeck) => void;
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { restore = resolve; }));
  const view = render(<SlidesWorkspace user={user} embeddedContext={context} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  const incoming = deckFixture(context.strategy);
  incoming.id = "new-gallery-copy";
  incoming.focus = { misconceptions: ["a"] };
  incoming.gallerySource = { templateId: "template", revision: 1, title: "Shared bounce", mode: "use" };
  incoming.draft.slides[0].title = "Copied opening";
  view.rerender(<SlidesWorkspace user={user} embeddedContext={context} incomingDeck={incoming} />);
  await screen.findByText(/Gallery material copied into this task/);
  await act(async () => restore(deckFixture(context.strategy)));
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Copied opening");
  expect(posts()).toHaveLength(0);
  await waitFor(() => expect(mocks.save.mock.calls.at(-1)![1].gallerySource).toEqual(incoming.gallerySource));
  expect(mocks.save.mock.calls.at(-1)![1].focus).toEqual(incoming.focus);
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "My class copy" } });
    view.rerender(<SlidesWorkspace user={user} embeddedContext={{ ...context }} incomingDeck={{ ...incoming }} />);
  });
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("My class copy");
  expect(incoming.draft.slides[0].title).toBe("Copied opening");
});

it("passes the teacher's focus into new generation and persists it with the deck", async () => {
  const ref = createRef<SlidesWorkspaceHandle>(); const ready = vi.fn();
  const focus = { misconceptions: ["a"] };
  render(<SlidesWorkspace ref={ref} user={user} embeddedContext={{ ...context, focus }} onReadyChange={ready} />);
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(context.strategy, true));
  act(() => ref.current?.generate());
  await screen.findByText("5 slides ready to send.");
  expect(posts().find(body => body.operation === "generate")?.focus).toEqual(focus);
  await waitFor(() => expect(mocks.save.mock.calls.at(-1)![1].focus).toEqual(focus));
});


it("retains old model images and uses the current supported model when recovering a saved draft", async () => {
  const saved = cognitiveConflictOpeningDeck();
  saved.modelSelection = { textModel: "current", imageModel: "gpt-image-1" };
  saved.assets.phenomenon.model = "gpt-image-1";
  delete saved.assets.evidence;
  mocks.load.mockResolvedValue(saved);
  render(<SlidesWorkspace user={user} embeddedContext={context} />);
  await screen.findByText(/Saved draft restored/);
  expect(posts()).toHaveLength(0);
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(mocks.save.mock.calls.at(-1)![1].assets.phenomenon).toEqual(saved.assets.phenomenon);
  fireEvent.click(screen.getByRole("button", { name: "Regenerate evidence image" }));
  await screen.findByText("Image updated. Review suggestions are optional.");
  const images = mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides/image");
  expect(images).toHaveLength(1);
  expect(JSON.parse(images[0][1].body)).toMatchObject({ imageModel: "current", visualId: "evidence" });
  await waitFor(() => expect(mocks.save.mock.calls.at(-1)![1].modelSelection.imageModel).toBe("current"));
  expect(mocks.save.mock.calls.at(-1)![1].assets.phenomenon).toEqual(saved.assets.phenomenon);
});
