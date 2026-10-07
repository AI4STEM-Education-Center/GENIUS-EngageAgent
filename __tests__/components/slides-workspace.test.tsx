// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { deckFixture, slideFixture } from "../fixtures/slides";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn(), decode: vi.fn(), revoke: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/slides/export", () => ({ downloadPresentation: mocks.download, decodeSlideAsset: mocks.decode }));
vi.mock("@/lib/slides/publish-client", () => ({ publishSlideDeck: mocks.publish }));
import SlidesWorkspace, { type SlidesWorkspaceHandle } from "@/app/components/SlidesWorkspace";
const user: UserContext = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher", classId: "ea-class-a", assignmentId: "ea-task-a" };
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data });
const lessons = reply({ lessons: [{ lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Track energy" }], models: INITIAL_MODEL_CATALOG });
const asset = deckFixture("analogy").assets.target;
const preparedDataUri = "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEsDBA==";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { revokeObjectURL: mocks.revoke }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ font: "", measureText: (text: string) => ({ width: text.length * 16 }) }) as never);
  mocks.decode.mockImplementation(async value => value); mocks.download.mockResolvedValue({ url: "blob:prepared-pptx", dataUri: preparedDataUri, fileName: "EngageAgent.pptx" });
  mocks.publish.mockResolvedValue({ publicationId: "published", contentItemId: "slides-deck" });
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: [] }) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy") }));
});

it("publishes only a checked and reviewed deck, then requires another publication after editing", async () => {
  const onPublished = vi.fn();
  render(<SlidesWorkspace user={user} onPublished={onPublished} />);
  await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready for review.");
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  expect((await screen.findByRole("button", { name: "Published" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onPublished).toHaveBeenCalledOnce();
  expect(mocks.publish).toHaveBeenCalledOnce();
  expect(mocks.publish.mock.calls[0][1]).toEqual({ classId: user.classId, assignmentId: user.assignmentId });
  expect(mocks.publish.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  expect(mocks.download).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  const sent = mocks.publish.mock.calls[0][0];
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "A revised student title" } });
  expect(screen.queryByRole("button", { name: "Published" })).toBeNull();
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check slides" }));
  await screen.findByText("Quality checks complete. Teacher review pending.");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[1][0].id).toBe(sent.id);
  expect(mocks.publish.mock.calls[1][0].draft.slides[0].title).toBe("A revised student title");
});

it("retains the reviewed draft and permits a manual retry after publishing fails", async () => {
  await generate();
  mocks.publish.mockRejectedValueOnce(new Error("Image storage unavailable."));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByText("Image storage unavailable.");
  expect(screen.queryByRole("button", { name: "Published" })).toBeNull();
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish).toHaveBeenCalledTimes(2);
});

it("keeps the published deck identity through AI revision and creates a new item only for new generation", async () => {
  await generate();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  const originalId = mocks.publish.mock.calls[0][0].id;
  fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Clarify the opening." } });
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready for review.");
  expect(screen.queryByRole("button", { name: "Published" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[1][0].id).toBe(originalId);
  expect(`slides-${mocks.publish.mock.calls[1][0].id}`).toBe(`slides-${originalId}`);
  fireEvent.click(screen.getByRole("button", { name: "Generate new slides" }));
  await screen.findByText("5 slides ready for review.");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[2][0].id).not.toBe(originalId);
});

it("aborts a pending publication on task change and ignores its late completion", async () => {
  const onPublished = vi.fn();
  const view = render(<SlidesWorkspace user={user} onPublished={onPublished} />);
  await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready for review.");
  let finish: (value: unknown) => void = () => {};
  mocks.publish.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  const signal = mocks.publish.mock.calls[0][2] as AbortSignal;
  view.rerender(<SlidesWorkspace user={{ ...user, assignmentId: "ea-task-b" }} onPublished={onPublished} />);
  expect(signal.aborted).toBe(true);
  await act(async () => { finish({ publicationId: "late" }); });
  expect(onPublished).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Published" })).toBeNull();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function generate() {
  render(<SlidesWorkspace user={user} />);
  await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready for review.");
}
it("toggles review with the accessible full-row button and also accepts Confirm review", async () => {
  await generate();
  const review = within(screen.getByRole("region", { name: "Review and publish" }));
  const checkbox = review.getByRole("checkbox", { name: "I have reviewed all 5 slides and their images." }) as HTMLButtonElement;
  const download = review.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement;
  const publish = review.getByRole("button", { name: "Send to students" }) as HTMLButtonElement;
  expect(checkbox.tagName).toBe("BUTTON");
  expect(checkbox.type).toBe("button");
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(checkbox.disabled).toBe(false);
  expect(download.disabled).toBe(true);
  expect(publish.disabled).toBe(true);
  const help = document.getElementById(checkbox.getAttribute("aria-describedby")!);
  expect(help).toBe(review.getByText(/The slides and images are ready/));

  fireEvent.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  expect(download.disabled).toBe(false);
  expect(publish.disabled).toBe(false);
  fireEvent.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(download.disabled).toBe(true);
  expect(publish.disabled).toBe(true);

  fireEvent.click(review.getByRole("button", { name: "Confirm review" }));
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  expect((review.getByRole("button", { name: "Review confirmed" }) as HTMLButtonElement).disabled).toBe(true);
  expect(download.disabled).toBe(false);
  expect(publish.disabled).toBe(false);
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("preserves review, prepared download and publication on unchanged Notes blur but invalidates an actual note edit", async () => {
  await generate();
  const review = within(screen.getByRole("region", { name: "Review and publish" }));
  fireEvent.click(review.getByRole("button", { name: "Confirm review" }));
  fireEvent.click(review.getByRole("button", { name: "Download PPTX" }));
  await review.findByRole("link", { name: "Save PPTX file" });
  fireEvent.click(review.getByRole("button", { name: "Send to students" }));
  await review.findByRole("button", { name: "Published" });
  const requests = mocks.fetch.mock.calls.length;

  fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
  for (const name of ["Teacher note 1", "Teacher note 2"]) {
    const note = screen.getByLabelText(name);
    fireEvent.focus(note);
    fireEvent.blur(note);
  }
  expect(review.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  expect((review.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  expect((review.getByRole("button", { name: "Published" }) as HTMLButtonElement).disabled).toBe(true);
  expect(review.getByRole("link", { name: "Save PPTX file" }).getAttribute("href")).toBe(preparedDataUri);
  expect(mocks.download).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledTimes(requests);
  expect(mocks.publish).toHaveBeenCalledOnce();
  expect(mocks.revoke).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Teacher note 1"), { target: { value: "Ask students to justify their prediction before showing the next page." } });
  fireEvent.blur(screen.getByLabelText("Teacher note 1"));
  expect(review.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  expect((review.getByRole("button", { name: "Confirm review" }) as HTMLButtonElement).disabled).toBe(true);
  expect((review.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(true);
  expect((review.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(true);
  expect(review.queryByRole("button", { name: "Published" })).toBeNull();
  expect(review.queryByRole("link", { name: "Save PPTX file" })).toBeNull();
  expect(review.getByText(/The current text or images need checking/)).toBeTruthy();
  fireEvent.click(review.getByRole("button", { name: "Check slides to continue" }));
  await screen.findByText("Quality checks complete. Teacher review pending.");
  expect((review.getByRole("button", { name: "Confirm review" }) as HTMLButtonElement).disabled).toBe(false);
  expect(review.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
});

it("retains a native save link without regenerating and releases replaced files on export and unmount", async () => {
  await generate();
  fireEvent.click(screen.getByRole("checkbox"));
  const requests = mocks.fetch.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  const link = await screen.findByRole("link", { name: "Save PPTX file" });
  expect(link.getAttribute("href")).toBe(preparedDataUri);
  expect(link.getAttribute("download")).toBe("EngageAgent.pptx");
  expect(link.getAttribute("target")).toBeNull();
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(requests);
  expect(mocks.revoke).not.toHaveBeenCalled();

  mocks.download.mockResolvedValueOnce({ url: "blob:replacement-pptx", fileName: "Replacement.pptx" });
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  expect(screen.queryByRole("link", { name: "Save PPTX file" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("link", { name: "Save PPTX file" }).getAttribute("href")).toBe("blob:replacement-pptx"));
  expect(mocks.revoke).toHaveBeenCalledWith("blob:prepared-pptx");
  expect(mocks.fetch).toHaveBeenCalledTimes(requests);
  cleanup();
  expect(mocks.revoke).toHaveBeenCalledWith("blob:replacement-pptx");
});

it("removes the prepared save link when review is withdrawn or the deck is edited", async () => {
  await generate();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByRole("link", { name: "Save PPTX file" });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.queryByRole("link", { name: "Save PPTX file" })).toBeNull();
  expect(mocks.revoke).toHaveBeenCalledWith("blob:prepared-pptx");

  mocks.download.mockResolvedValueOnce({ url: "blob:edited-pptx", fileName: "Edited.pptx" });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByRole("link", { name: "Save PPTX file" });
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "A changed title" } });
  expect(screen.queryByRole("link", { name: "Save PPTX file" })).toBeNull();
  expect(mocks.revoke).toHaveBeenCalledWith("blob:edited-pptx");
});

it("prefers an HTTP attachment save link while retaining and revoking only its local Blob", async () => {
  mocks.download.mockResolvedValueOnce({ url: "blob:http-backed-pptx", dataUri: preparedDataUri, httpUrl: "https://files.example.test/lesson.pptx", fileName: "Lesson.pptx" });
  await generate(); fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  const link = await screen.findByRole("link", { name: "Save PPTX file" });
  expect(link.getAttribute("href")).toBe("https://files.example.test/lesson.pptx");
  expect(mocks.download.mock.calls[0][2]).toEqual({ classId: user.classId, assignmentId: user.assignmentId });
  expect(mocks.download.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
  expect(screen.getByText(/Save link expires in 10 minutes/)).toBeTruthy();
  cleanup(); expect(mocks.revoke).toHaveBeenCalledWith("blob:http-backed-pptx");
  expect(mocks.revoke).not.toHaveBeenCalledWith("https://files.example.test/lesson.pptx");
});

it("releases a file that finishes preparing after the workspace closes", async () => {
  await generate();
  let finish: (file: { url: string; fileName: string }) => void = () => {};
  mocks.download.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  expect(screen.queryByRole("link", { name: "Save PPTX file" })).toBeNull();
  const signal = mocks.download.mock.calls[0][3] as AbortSignal;
  cleanup();
  expect(signal.aborted).toBe(true);
  await act(async () => { finish({ url: "blob:closed-workspace", fileName: "Closed.pptx" }); });
  expect(mocks.revoke).toHaveBeenCalledWith("blob:closed-workspace");
});

it("waits for its catalog and generates with the parent lesson and strategy through its handle", async () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => {
    const context = { font: "", measureText: (text: string) => ({ width: text.length * Number(context.font.match(/(\d+)px/u)?.[1] ?? 16) * .53 }) };
    return context as never;
  });
  let resolveCatalog: (value: unknown) => void = () => {};
  const catalog = new Promise(resolve => { resolveCatalog = resolve; });
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? catalog : path.endsWith("/check") ? reply({ issues: [] }) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("cognitive conflict") }));
  const ref = createRef<SlidesWorkspaceHandle>();
  const onReadyChange = vi.fn();
  const onBusyChange = vi.fn();
  render(<SlidesWorkspace ref={ref} user={user} embeddedContext={{ lessonNumber: 3, strategy: "cognitive conflict" }} onReadyChange={onReadyChange} onBusyChange={onBusyChange} />);
  expect(screen.getByRole("region", { name: "Cognitive conflict slides" })).toBeTruthy();
  expect(screen.queryByRole("main")).toBeNull();
  expect(screen.queryByLabelText("Lesson")).toBeNull();
  expect(screen.queryByLabelText("Strategy")).toBeNull();
  expect(screen.queryByRole("button", { name: "Generate slides" })).toBeNull();
  act(() => { ref.current?.generate(); });
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  await act(async () => { resolveCatalog(reply({ lessons: [
    { lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Track energy" },
    { lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Observe contact" },
  ], models: INITIAL_MODEL_CATALOG })); });
  await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith("cognitive conflict", true));
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  act(() => { ref.current?.generate(); ref.current?.generate(); });
  await screen.findByText("5 slides ready for review.");
  const requests = mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
  expect(requests.filter(body => body.operation === "generate")).toHaveLength(1);
  for (const body of requests) expect(body).toMatchObject({ classId: user.classId, assignmentId: user.assignmentId, lessonNumber: 3, strategy: "cognitive conflict" });
  expect(onBusyChange).toHaveBeenCalledWith("cognitive conflict", true);
  expect(onBusyChange).toHaveBeenLastCalledWith("cognitive conflict", false);
});

it("preserves an embedded draft and settings while hidden without generating or reloading", async () => {
  const ref = createRef<SlidesWorkspaceHandle>();
  const onReadyChange = vi.fn();
  const view = render(<div hidden={false}><SlidesWorkspace ref={ref} user={user} embeddedContext={{ lessonNumber: 8, strategy: "analogy" }} onReadyChange={onReadyChange} /></div>);
  await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith("analogy", true));
  fireEvent.change(screen.getByLabelText("Text model"), { target: { value: "gpt-4.1" } });
  fireEvent.change(screen.getByLabelText("Classroom context (optional)"), { target: { value: "Grade 10; familiar with board games." } });
  act(() => { ref.current?.generate(); });
  await screen.findByText("5 slides ready for review.");
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "Keep my edited title" } });
  fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Keep the useful comparison." } });
  const calls = mocks.fetch.mock.calls.length;
  view.rerender(<div hidden><SlidesWorkspace ref={ref} user={user} embeddedContext={{ lessonNumber: 8, strategy: "analogy" }} onReadyChange={onReadyChange} /></div>);
  view.rerender(<div hidden={false}><SlidesWorkspace ref={ref} user={user} embeddedContext={{ lessonNumber: 8, strategy: "analogy" }} onReadyChange={onReadyChange} /></div>);
  expect(mocks.fetch).toHaveBeenCalledTimes(calls);
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Keep my edited title");
  expect((screen.getByLabelText("Revision request") as HTMLTextAreaElement).value).toBe("Keep the useful comparison.");
  expect((screen.getByLabelText("Text model") as HTMLSelectElement).value).toBe("gpt-4.1");
  expect((screen.getByLabelText("Classroom context (optional)") as HTMLTextAreaElement).value).toBe("Grade 10; familiar with board games.");
});

it("does not generate on embedded context changes and clears readiness and busy state on unmount", async () => {
  const ref = createRef<SlidesWorkspaceHandle>();
  const onReadyChange = vi.fn();
  const onBusyChange = vi.fn();
  const props = { ref, user, onReadyChange, onBusyChange };
  const view = render(<SlidesWorkspace {...props} embeddedContext={{ lessonNumber: 8, strategy: "analogy" }} />);
  await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith("analogy", true));
  view.rerender(<SlidesWorkspace {...props} embeddedContext={{ lessonNumber: 99, strategy: "experience bridging" }} />);
  await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith("experience bridging", false));
  act(() => { ref.current?.generate(); });
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  view.rerender(<SlidesWorkspace {...props} embeddedContext={{ lessonNumber: 8, strategy: "analogy" }} />);
  await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith("analogy", true));
  let signal: AbortSignal | null = null;
  mocks.fetch.mockImplementation(async (_path: string, init: RequestInit) => { signal = init.signal ?? null; return new Promise(() => {}); });
  act(() => { ref.current?.generate(); });
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith("analogy", true));
  view.unmount();
  expect((signal as AbortSignal | null)?.aborted).toBe(true);
  expect(onBusyChange).toHaveBeenLastCalledWith("analogy", false);
  expect(onReadyChange).toHaveBeenLastCalledWith("analogy", false);
  expect(ref.current).toBeNull();
});

it("generates, previews, edits, requires teacher review and downloads the current deck", async () => {
  await generate();
  const download = screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement;
  expect(download.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Next slide" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Connect the trays to a launcher");
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "Nine counters" } });
  expect(download.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check slides" }));
  await screen.findByText("Quality checks complete. Teacher review pending.");
  fireEvent.click(screen.getByRole("checkbox"));
  expect(download.disabled).toBe(false);
  fireEvent.click(download);
  await screen.findByText("PowerPoint ready. If downloading did not start, use Save PPTX file.");
  expect(mocks.download.mock.calls[0][0].draft.slides[1].title).toBe("Nine counters");
  fireEvent.change(screen.getByLabelText("Slide body"), { target: { value: "word ".repeat(30) } });
  await waitFor(() => expect(download.disabled).toBe(true));
  expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes("Slide 2.body"))).toBe(true);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
});
it("retains the generated prompt version through dropdown changes, revisions and download", async () => {
  const provenance = { version: "reference", revision: "test-revision", sourceSha256: "a".repeat(64) };
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: [] }) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy"), promptProvenance: provenance }));
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  fireEvent.change(screen.getByLabelText("Prompt version"), { target: { value: "reference" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready for review.");
  const count = mocks.fetch.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Prompt version"), { target: { value: "optimized" } });
  expect(mocks.fetch).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready for review.");
  const requests = mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides").map(([, init]) => JSON.parse(init.body));
  expect(requests.map(body => body.promptVersion)).toEqual(["reference", "reference"]);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByText("PowerPoint ready. If downloading did not start, use Save PPTX file.");
  expect(mocks.download.mock.calls[0][0].promptProvenance).toEqual(provenance);
});
it("keeps the previous draft when text regeneration fails", async () => {
  await generate();
  mocks.fetch.mockResolvedValueOnce(reply({ error: "Provider unavailable" }, false));
  fireEvent.click(screen.getByRole("button", { name: "Generate new slides" }));
  await screen.findByText("Provider unavailable");
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Tracking energy transfers");
});
it("keeps text and successful images when one image fails and permits a focused retry", async () => {
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/slides?")) return lessons;
    if (path.endsWith("/check")) return reply({ issues: [] });
    if (path.endsWith("/image")) return JSON.parse(String(init?.body)).visualId === "target" ? reply({ error: "Image unavailable" }, false) : reply({ asset });
    return reply({ draft: slideFixture("analogy") });
  });
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("Slide text ready. Some images need a retry.");
  expect(screen.getAllByText("Missing")).toHaveLength(2); expect(screen.getByText("Ready")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Check slides" }));
  await screen.findByText("Draft retained. Generate the missing images before teacher review.");
  expect(screen.queryByText("Quality checks complete. Teacher review pending.")).toBeNull();
  const review = within(screen.getByRole("region", { name: "Review and publish" }));
  const checkbox = review.getByRole("checkbox") as HTMLButtonElement;
  expect(checkbox.disabled).toBe(true);
  fireEvent.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(document.getElementById(checkbox.getAttribute("aria-describedby")!)).toBe(review.getByText("Images are missing. Open Images to generate or retry them."));
  for (const name of ["Confirm review", "Download PPTX", "Send to students"]) {
    const action = review.getByRole("button", { name }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
  }
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  fireEvent.click(review.getByRole("button", { name: "Open images" }));
  expect(screen.getByRole("tab", { name: "Images" }).getAttribute("aria-selected")).toBe("true");
  mocks.fetch.mockResolvedValueOnce(reply({ asset }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate target image" }));
  await screen.findByText("Image updated.");
  expect(screen.getByText("Missing")).toBeTruthy();
  expect(JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body).visualId).toBe("target");
  fireEvent.click(screen.getByRole("button", { name: "Regenerate variation image" }));
  await waitFor(() => expect(screen.queryByText("Missing")).toBeNull());
});
it("ignores a late response from cancelled generation", async () => {
  let resolve: (value: unknown) => void = () => {};
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : new Promise(r => { resolve = r; }));
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel generation" }));
  resolve(reply({ draft: slideFixture("analogy") }));
  await screen.findByText("Generation cancelled.");
  expect(screen.queryByLabelText("Slide title")).toBeNull();
  expect(screen.getByText("No slide draft yet.")).toBeTruthy();
});
it("keeps current defaults and sends explicit text/image selections for generation", async () => {
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  expect((screen.getByLabelText("Text model") as HTMLSelectElement).value).toBe("current");
  expect((screen.getByLabelText("Image model") as HTMLSelectElement).value).toBe("current");
  expect((screen.getByLabelText("Classroom context (optional)") as HTMLTextAreaElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("Text model"), { target: { value: "gpt-4.1" } });
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "gpt-image-2" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready for review.");
  const bodies = mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
  expect(bodies[0].textModel).toBe("gpt-4.1");
  expect(bodies[0].classroomContext).toBe("");
  expect(bodies.filter(body => body.imageModel).map(body => body.imageModel)).toEqual(["gpt-image-2", "gpt-image-2", "gpt-image-2"]);
  expect(bodies.filter(body => body.asset)).toHaveLength(3);
  expect(JSON.stringify(bodies)).not.toContain("apiKey");
});
it("keeps the draft classroom context through changed inputs, checks, AI revisions and download", async () => {
  const originalContext = "Grade 9; familiar with bicycle brakes; no lab equipment.";
  const nextContext = "Grade 11; familiar with laboratory carts.";
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  const contextInput = screen.getByLabelText("Classroom context (optional)") as HTMLTextAreaElement;
  expect(contextInput.maxLength).toBe(1200);
  fireEvent.change(contextInput, { target: { value: ` ${originalContext} ` } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready for review.");
  const originalRequests = mocks.fetch.mock.calls.filter(([path, init]) => init?.method === "POST" && (path === "/api/slides" || path.endsWith("/check"))).map(([, init]) => JSON.parse(init.body));
  expect(originalRequests).toHaveLength(5);
  for (const body of originalRequests) expect(body.classroomContext).toBe(originalContext);
  const count = mocks.fetch.mock.calls.length;
  fireEvent.change(contextInput, { target: { value: nextContext } });
  fireEvent.change(screen.getByLabelText("Strategy"), { target: { value: "experience bridging" } });
  expect(mocks.fetch).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole("button", { name: "Check slides" }));
  await screen.findByText("Quality checks complete. Teacher review pending.");
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready for review.");
  const followingRequests = mocks.fetch.mock.calls.slice(count).filter(([path, init]) => init?.method === "POST" && (path === "/api/slides" || path.endsWith("/check"))).map(([, init]) => JSON.parse(init.body));
  expect(followingRequests.some(body => body.operation === "review")).toBe(true);
  expect(followingRequests.filter(body => body.asset)).toHaveLength(3);
  for (const body of followingRequests) expect(body).toMatchObject({ classroomContext: originalContext, strategy: "analogy" });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByText("PowerPoint ready. If downloading did not start, use Save PPTX file.");
  expect(mocks.download.mock.calls[0][0].classroomContext).toBe(originalContext);
  fireEvent.change(screen.getByLabelText("Strategy"), { target: { value: "analogy" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate new slides" }));
  await screen.findByText("5 slides ready for review.");
  const newestGeneration = mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides").at(-1)!;
  expect(JSON.parse(newestGeneration[1].body).classroomContext).toBe(nextContext);
});
it("switching a dropdown alone does not regenerate, invalidate, or relabel existing output", async () => {
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: [] }) : path.endsWith("/image") ? reply({ asset: { ...asset, model: "gpt-image-1" } }) : reply({ draft: slideFixture("analogy"), model: "gpt-4.1" }));
  await generate(); fireEvent.click(screen.getByRole("checkbox"));
  const calls = mocks.fetch.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Text model"), { target: { value: "gpt-5-mini" } });
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "gpt-image-2" } });
  expect(mocks.fetch).toHaveBeenCalledTimes(calls);
  expect(screen.getByText("Text: gpt-4.1")).toBeTruthy();
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "Images" }));
  expect(screen.getAllByText("gpt-image-1")).toHaveLength(3);
  mocks.fetch.mockResolvedValueOnce(reply({ asset: { ...asset, model: "gpt-image-2" } }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate target image" }));
  await screen.findByText("Image updated.");
  expect(JSON.parse(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image")).at(-1)![1].body).imageModel).toBe("gpt-image-2");
  expect(screen.getAllByText("gpt-image-1")).toHaveLength(2);
  expect(screen.getByText("gpt-image-2")).toBeTruthy();
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
});
it("uses selected text model and teacher feedback while preserving unchanged images", async () => {
  await generate();
  fireEvent.change(screen.getByLabelText("Text model"), { target: { value: "gpt-5-mini" } });
  fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Keep the analogue independent." } });
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready for review.");
  const reviewCall = mocks.fetch.mock.calls.find(([, init]) => init?.body && JSON.parse(init.body).operation === "review");
  expect(JSON.parse(reviewCall![1].body)).toMatchObject({ textModel: "gpt-5-mini", strategy: "analogy", lessonNumber: 8, feedback: "Keep the analogue independent." });
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(3);
});

it("stops automatic text repair when the model returns an unchanged draft", async () => {
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: ["Slide 2.body: remove the early energy mapping."] }) : reply({ draft: slideFixture("analogy") }));
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("Draft retained. Teaching-content corrections needed.");
  expect(mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides")).toHaveLength(2);
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/check"))).toHaveLength(2);
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(0);
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Tracking energy transfers");
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(true);
});

it("bounds changing text repairs at two and never generates images for unresolved text", async () => {
  let version = 0;
  mocks.fetch.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/slides?")) return lessons;
    if (path.endsWith("/check")) return reply({ issues: ["Slide 2.body: the task still repeats the supplied answer."] });
    const draft = slideFixture("analogy"); draft.title = `Draft ${++version}`;
    return reply({ draft });
  });
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("Draft retained. Teaching-content corrections needed.");
  expect(mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides")).toHaveLength(3);
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(0);
  expect(screen.getByText("Draft 3")).toBeTruthy();
});

it("automatically corrects a rejected baseline before generating its dependent variation", async () => {
  let targetChecks = 0;
  let targetImages = 0;
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/slides?")) return lessons;
    const body = JSON.parse(String(init?.body));
    if (path.endsWith("/check")) return reply({ issues: body.visualId === "target" && ++targetChecks === 1 ? ["Image target: fix the contact gap."] : [] });
    if (path.endsWith("/image")) return reply({ asset: body.visualId === "target" && ++targetImages === 2 ? { ...asset, data: "data:image/jpeg;base64,/9j/4AA=" } : asset });
    return reply({ draft: slideFixture("analogy") });
  });
  await generate();
  const images = mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image")).map(([, init]) => JSON.parse(init.body));
  expect(images.map(body => body.visualId)).toEqual(["analogue", "target", "target", "variation"]);
  expect(images[2].feedback).toBe("Image target: fix the contact gap.");
  expect(images[3].referenceAsset.data).toBe("data:image/jpeg;base64,/9j/4AA=");
  expect(targetChecks).toBe(2);
});

it("repairs layout before spending requests on images and retains an unresolved overflow", async () => {
  const draft = slideFixture("analogy");
  draft.slides[4].body = "W".repeat(50);
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: [] }) : reply({ draft }));
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("Draft retained. Layout corrections needed.");
  const generation = mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides");
  expect(generation).toHaveLength(2);
  expect(JSON.parse(generation[1][1].body).feedback).toContain("Text token is too wide");
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(0);
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("5 slides ready for review.")).toBeNull();
});

it("explains unresolved image findings beside review and blocks confirmation, export and publication", async () => {
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: JSON.parse(String(init?.body)).visualId === "target" ? ["Image target: compressed spring is longer; correct the geometry."] : [] }) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy") }));
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("Draft retained. Quality corrections needed.");
  expect(screen.getByText(/Image target: compressed spring/)).toBeTruthy();
  const review = within(screen.getByRole("region", { name: "Review and publish" }));
  const checkbox = review.getByRole("checkbox") as HTMLButtonElement;
  const help = review.getByText("AI review found issues. Revise the slides, or review the findings below and record a teacher decision before confirming.");
  expect(document.getElementById(checkbox.getAttribute("aria-describedby")!)).toBe(help);
  expect(checkbox.disabled).toBe(true);
  fireEvent.click(checkbox);
  expect(review.getByRole("button", { name: "Fix slides with AI" })).toBeTruthy();
  for (const name of ["Confirm review", "Download PPTX", "Send to students"]) {
    const action = review.getByRole("button", { name }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
  }
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  const attempts = mocks.fetch.mock.calls.filter(([path, init]) => path.endsWith("/image") && JSON.parse(init.body).visualId === "target");
  expect(attempts).toHaveLength(2);
  expect(JSON.parse(attempts[1][1].body).feedback).toContain("compressed spring is longer");
});
it("requires a written teacher decision to accept AI findings and invalidates it after edits", async () => {
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: JSON.parse(String(init?.body)).visualId === "target" ? ["Image target: possible contact ambiguity."] : [] }) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy") }));
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("Draft retained. Quality corrections needed.");
  const accept = screen.getByRole("button", { name: "Accept after teacher review" }) as HTMLButtonElement;
  expect(accept.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Teacher decision note"), { target: { value: "I inspected the picture; the spring visibly touches the cart." } });
  fireEvent.click(accept);
  expect(screen.getByText("Teacher decision recorded for this version.")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByText("PowerPoint ready. If downloading did not start, use Save PPTX file.");
  expect(mocks.download.mock.calls[0][0].teacherDecision.reason).toContain("spring visibly touches");
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "A new title" } });
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("Teacher decision recorded for this version.")).toBeNull();
});

it("retains the old picture after editing its plan, regenerates only that picture and requires fresh checks", async () => {
  await generate(); fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("tab", { name: "Images" }));
  fireEvent.change(screen.getByLabelText("target prompt"), { target: { value: "One cart touching a visibly short compressed spring, no release panel." } });
  expect(screen.getAllByText("Plan changed")).toHaveLength(2);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Regenerate target image" }));
  await screen.findByText("Image updated. Quality check needs attention.");
  const images = mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"));
  expect(images).toHaveLength(4);
  expect(JSON.parse(images[3][1].body).draft.visuals[1].prompt).toContain("visibly short");
  fireEvent.click(screen.getByRole("button", { name: "Check slides" }));
  await waitFor(() => expect((screen.getByRole("checkbox") as HTMLButtonElement).disabled).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate variation image" }));
  await screen.findByText("Image updated.");
  expect((screen.getByRole("checkbox") as HTMLButtonElement).disabled).toBe(false);
});

it("does not erase text or mark quality checks passed when checking fails", async () => {
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ error: "Quality service unavailable" }, false) : reply({ draft: slideFixture("analogy") }));
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("Quality service unavailable");
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Tracking energy transfers");
  expect((screen.getByRole("checkbox") as HTMLButtonElement).disabled).toBe(true);
});
