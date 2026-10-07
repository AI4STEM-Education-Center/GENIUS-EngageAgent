// @vitest-environment jsdom
import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext as EmbeddedUserContext } from "@/lib/auth";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { deckFixture, slideFixture } from "../fixtures/slides";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn(), decode: vi.fn(), revoke: vi.fn(), publish: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/slides/export", () => ({ downloadPresentation: mocks.download, decodeSlideAsset: mocks.decode }));
vi.mock("@/lib/slides/draft-storage", async importOriginal => ({ ...await importOriginal<object>(), loadSlideDraft: mocks.load, saveSlideDraft: mocks.save }));
vi.mock("@/lib/slides/publish-client", () => ({ publishSlideDeck: mocks.publish }));
import SlidesWorkspace, { type SlidesWorkspaceHandle } from "@/app/components/SlidesWorkspace";
const user: UserContext = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher", classId: "ea-class-a", assignmentId: "ea-task-a" };
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data });
const lessons = reply({ lessons: [{ lessonNumber: 8, lessonTitle: "Energy", learningObjective: "Track energy" }], models: INITIAL_MODEL_CATALOG });
const asset = deckFixture("analogy").assets.target;
const preparedDataUri = "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEsDBA==";
beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockResolvedValue(null); mocks.save.mockResolvedValue(undefined); vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { revokeObjectURL: mocks.revoke }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ font: "", measureText: (text: string) => ({ width: text.length * 16 }) }) as never);
  mocks.decode.mockImplementation(async value => value); mocks.download.mockResolvedValue({ url: "blob:prepared-pptx", dataUri: preparedDataUri, fileName: "EngageAgent.pptx" });
  mocks.publish.mockResolvedValue({ publicationId: "published", contentItemId: "slides-deck" });
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: [] }) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy") }));
});

it("publishes a generated deck directly and republishes edited text without checking or reviewing", async () => {
  const onPublished = vi.fn();
  render(<SlidesWorkspace user={user} onPublished={onPublished} />);
  await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready to send.");
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(false);
  const calls = mocks.fetch.mock.calls.length;
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
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[1][0].id).toBe(sent.id);
  expect(mocks.publish.mock.calls[1][0].draft.slides[0].title).toBe("A revised student title");
  expect(mocks.fetch).toHaveBeenCalledTimes(calls);
});

it("retains the draft and permits a manual retry after publishing fails", async () => {
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
  await screen.findByText("5 slides ready to send.");
  expect(screen.queryByRole("button", { name: "Published" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[1][0].id).toBe(originalId);
  expect(`slides-${mocks.publish.mock.calls[1][0].id}`).toBe(`slides-${originalId}`);
  fireEvent.click(screen.getByRole("button", { name: "Generate new slides" }));
  await screen.findByText("5 slides ready to send.");
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
  await screen.findByText("5 slides ready to send.");
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
afterEach(async () => { await act(async () => {}); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function generate() {
  render(<SlidesWorkspace user={user} />);
  await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready to send.");
}
it("keeps accessible optional review controls without making them a publish or download gate", async () => {
  await generate();
  const review = within(screen.getByRole("region", { name: "Review and publish" }));
  const checkbox = review.getByRole("checkbox", { name: "I have reviewed all 5 slides and their images." }) as HTMLButtonElement;
  const download = review.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement;
  const publish = review.getByRole("button", { name: "Send to students" }) as HTMLButtonElement;
  expect(checkbox.tagName).toBe("BUTTON");
  expect(checkbox.type).toBe("button");
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(checkbox.disabled).toBe(false);
  expect(download.disabled).toBe(false);
  expect(publish.disabled).toBe(false);
  const help = document.getElementById(checkbox.getAttribute("aria-describedby")!);
  expect(help).toBe(review.getByText(/The slides and images are ready/));

  fireEvent.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  expect(download.disabled).toBe(false);
  expect(publish.disabled).toBe(false);
  fireEvent.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(download.disabled).toBe(false);
  expect(publish.disabled).toBe(false);

  fireEvent.click(review.getByRole("button", { name: "Confirm review" }));
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  expect((review.getByRole("button", { name: "Review confirmed" }) as HTMLButtonElement).disabled).toBe(true);
  expect(download.disabled).toBe(false);
  expect(publish.disabled).toBe(false);
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("preserves review, prepared download and publication on unchanged student text interaction but invalidates an actual edit", async () => {
  await generate();
  const review = within(screen.getByRole("region", { name: "Review and publish" }));
  fireEvent.click(review.getByRole("button", { name: "Confirm review" }));
  fireEvent.click(review.getByRole("button", { name: "Download PPTX" }));
  await review.findByRole("link", { name: "Save PPTX file" });
  fireEvent.click(review.getByRole("button", { name: "Send to students" }));
  await review.findByRole("button", { name: "Published" });
  const requests = mocks.fetch.mock.calls.length;

  for (const name of ["Slide title", "Slide body", "Slide task"]) {
    const field = screen.getByLabelText(name) as HTMLTextAreaElement;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: field.value } });
    fireEvent.blur(field);
  }
  expect(review.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  expect((review.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  expect((review.getByRole("button", { name: "Published" }) as HTMLButtonElement).disabled).toBe(true);
  expect(review.getByRole("link", { name: "Save PPTX file" }).getAttribute("href")).toBe(preparedDataUri);
  expect(mocks.download).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledTimes(requests);
  expect(mocks.publish).toHaveBeenCalledOnce();
  expect(mocks.revoke).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "Where could the energy go?" } });
  expect(review.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  for (const name of ["Confirm review", "Download PPTX", "Send to students"]) {
    expect((review.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
  }
  expect(review.queryByRole("button", { name: "Published" })).toBeNull();
  expect(review.queryByRole("link", { name: "Save PPTX file" })).toBeNull();
  expect(review.queryByRole("button", { name: "Check slides to continue" })).toBeNull();
  expect(mocks.revoke).toHaveBeenCalledWith("blob:prepared-pptx");
  fireEvent.click(review.getByRole("button", { name: "Download PPTX" }));
  await review.findByRole("link", { name: "Save PPTX file" });
  expect(mocks.download.mock.calls[1][0].draft.slides[0].title).toBe("Where could the energy go?");
  expect(mocks.fetch).toHaveBeenCalledTimes(requests);
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

it("preserves the prepared save link when optional review is withdrawn but invalidates it on actual edits", async () => {
  await generate();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByRole("link", { name: "Save PPTX file" });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("link", { name: "Save PPTX file" }).getAttribute("href")).toBe(preparedDataUri);
  expect(mocks.revoke).not.toHaveBeenCalled();

  mocks.download.mockResolvedValueOnce({ url: "blob:edited-pptx", fileName: "Edited.pptx" });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByRole("link", { name: "Save PPTX file" });
  await act(async () => { fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "A changed title" } }); });
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
  await screen.findByText("5 slides ready to send.");
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
  fireEvent.change(screen.getByLabelText("Classroom context (optional)"), { target: { value: "Grade 10; familiar with board games." } });
  act(() => { ref.current?.generate(); });
  await screen.findByText("5 slides ready to send.");
  await act(async () => { fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "Keep my edited title" } }); });
  fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Keep the useful comparison." } });
  const calls = mocks.fetch.mock.calls.length;
  view.rerender(<div hidden><SlidesWorkspace ref={ref} user={user} embeddedContext={{ lessonNumber: 8, strategy: "analogy" }} onReadyChange={onReadyChange} /></div>);
  view.rerender(<div hidden={false}><SlidesWorkspace ref={ref} user={user} embeddedContext={{ lessonNumber: 8, strategy: "analogy" }} onReadyChange={onReadyChange} /></div>);
  expect(mocks.fetch).toHaveBeenCalledTimes(calls);
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Keep my edited title");
  expect((screen.getByLabelText("Revision request") as HTMLTextAreaElement).value).toBe("Keep the useful comparison.");
  expect(screen.queryByLabelText("Text model")).toBeNull();
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

it("downloads edited student text directly while still blocking actual rendering overflow", async () => {
  await generate();
  const download = screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement;
  expect(download.disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Connect the trays to a launcher");
  const requests = mocks.fetch.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "Nine counters" } });
  expect(download.disabled).toBe(false);
  fireEvent.click(download);
  await screen.findByText("PowerPoint ready. If downloading did not start, use Save PPTX file.");
  expect(mocks.download.mock.calls[0][0].draft.slides[1].title).toBe("Nine counters");
  expect(mocks.fetch).toHaveBeenCalledTimes(requests);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  fireEvent.change(screen.getByLabelText("Slide body"), { target: { value: "W".repeat(100) } });
  await waitFor(() => expect(download.disabled).toBe(true));
  expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes("Text token is too wide"))).toBe(true);
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(true);
});

it("retains a restored draft's prompt provenance through revisions and download without exposing controls", async () => {
  const provenance = { version: "reference" as const, revision: "test-revision", sourceSha256: "a".repeat(64) };
  const saved = deckFixture("analogy"); saved.promptProvenance = provenance;
  mocks.load.mockResolvedValue(saved);
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: [] }) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy"), promptProvenance: provenance }));
  render(<SlidesWorkspace user={user} />);
  await screen.findByText(/Saved draft restored/);
  expect(screen.queryByLabelText("Prompt version")).toBeNull();
  expect(screen.queryByText(/test-revision/)).toBeNull();
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready to send.");
  const requests = mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides").map(([, init]) => JSON.parse(init.body));
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ operation: "review", promptVersion: "reference", analogyMethod: "predict-transfer", draft: saved.draft });
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
  expect(screen.getAllByText(/· Missing/)).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Regenerate analogue image" })).toBeNull();
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check slides" }));
  await screen.findByText("Draft retained. Generate the missing images before sending.");
  expect(screen.queryByText("Quality checks complete. You can send the slides or optionally revise them.")).toBeNull();
  const review = within(screen.getByRole("region", { name: "Review and publish" }));
  const checkbox = review.getByRole("checkbox") as HTMLButtonElement;
  expect(checkbox.disabled).toBe(true);
  fireEvent.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(document.getElementById(checkbox.getAttribute("aria-describedby")!)).toBe(review.getByText("Images are missing. Use Image recovery below to generate or retry them."));
  for (const name of ["Confirm review", "Download PPTX", "Send to students"]) {
    const action = review.getByRole("button", { name }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
  }
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  fireEvent.click(review.getByRole("button", { name: "Go to image recovery" }));
  expect(screen.getByRole("region", { name: "Image recovery" })).toBeTruthy();
  mocks.fetch.mockResolvedValueOnce(reply({ asset }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate target image" }));
  await screen.findByText("Image updated. Review suggestions are optional.");
  expect(screen.getByText(/· Missing/)).toBeTruthy();
  expect(JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body).visualId).toBe("target");
  fireEvent.click(screen.getByRole("button", { name: "Regenerate variation image" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Image recovery" })).toBeNull());
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
it("uses server-current text/image defaults and optimized six-step generation without exposing configuration", async () => {
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  for (const label of ["Text model", "Image model", "Prompt version", "Analogy story"]) expect(screen.queryByLabelText(label)).toBeNull();
  expect((screen.getByLabelText("Classroom context (optional)") as HTMLTextAreaElement).value).toBe("");
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready to send.");
  const bodies = mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
  expect(bodies[0]).toMatchObject({ textModel: "current", promptVersion: "optimized", analogyMethod: "six-step" });
  expect(bodies[0].classroomContext).toBe("");
  expect(bodies.filter(body => body.imageModel).map(body => body.imageModel)).toEqual(["current", "current", "current"]);
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
  await screen.findByText("5 slides ready to send.");
  const originalRequests = mocks.fetch.mock.calls.filter(([path, init]) => init?.method === "POST" && (path === "/api/slides" || path.endsWith("/check"))).map(([, init]) => JSON.parse(init.body));
  expect(originalRequests).toHaveLength(5);
  for (const body of originalRequests) expect(body.classroomContext).toBe(originalContext);
  const count = mocks.fetch.mock.calls.length;
  fireEvent.change(contextInput, { target: { value: nextContext } });
  fireEvent.change(screen.getByLabelText("Strategy"), { target: { value: "experience bridging" } });
  expect(mocks.fetch).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole("button", { name: "Check slides" }));
  await screen.findByText("Quality checks complete. You can send the slides or optionally revise them.");
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready to send.");
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
  await screen.findByText("5 slides ready to send.");
  const newestGeneration = mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides").at(-1)!;
  expect(JSON.parse(newestGeneration[1].body).classroomContext).toBe(nextContext);
});
it("retains actual model metadata and private teacher notes in downloads without displaying them", async () => {
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: [] }) : path.endsWith("/image") ? reply({ asset: { ...asset, model: "gpt-image-1" } }) : reply({ draft: slideFixture("analogy"), model: "gpt-4.1" }));
  await generate(); fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.queryByText("Text: gpt-4.1")).toBeNull();
  expect(screen.queryByText("gpt-image-1")).toBeNull();
  expect(screen.queryByRole("region", { name: "Image recovery" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByRole("link", { name: "Save PPTX file" });
  const exported = mocks.download.mock.calls[0][0];
  expect(exported.textModel).toBe("gpt-4.1");
  expect(Object.values(exported.assets).map(asset => (asset as { model: string }).model)).toEqual(["gpt-image-1", "gpt-image-1", "gpt-image-1"]);
  expect(exported.draft.slides.map((slide: { teacherNotes: string[] }) => slide.teacherNotes)).toEqual(slideFixture("analogy").slides.map(slide => slide.teacherNotes));
  expect(mocks.save.mock.calls.at(-1)![1].draft.slides[0].teacherNotes).toEqual(exported.draft.slides[0].teacherNotes);
});

it("puts student-facing editing before revision and omits technical controls and private panels", async () => {
  await generate();
  const preview = screen.getByRole("region", { name: "Slide preview" });
  const editor = screen.getByRole("complementary", { name: "Slide editor" });
  const review = screen.getByRole("region", { name: "Review and publish" });
  const revision = screen.getByRole("region", { name: /Revise slides/ });
  for (const section of [preview, editor, review]) {
    expect(section.compareDocumentPosition(revision) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(within(revision).getByLabelText("Revision request")).toBeTruthy();
  expect(within(revision).getByRole("button", { name: "Revise with AI" })).toBeTruthy();
  for (const field of ["Slide title", "Slide body", "Slide task"]) expect(within(editor).getByLabelText(field)).toBeTruthy();
  for (const field of ["Text model", "Image model", "Prompt version", "Analogy story", "Teacher note 1", "Teacher note 2", "target prompt", "target caption", "target alt"]) expect(screen.queryByLabelText(field)).toBeNull();
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryByText("Teaching design for this comparison")).toBeNull();
  expect(screen.queryByRole("region", { name: "Image recovery" })).toBeNull();
});
it("uses the current text model and teacher feedback while preserving unchanged images", async () => {
  await generate();
  fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Keep the analogue independent." } });
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready to send.");
  const reviewCall = mocks.fetch.mock.calls.find(([, init]) => init?.body && JSON.parse(init.body).operation === "review");
  expect(JSON.parse(reviewCall![1].body)).toMatchObject({ textModel: "current", strategy: "analogy", lessonNumber: 8, feedback: "Keep the analogue independent." });
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(3);
});

it("stops unchanged automatic text repair but completes images and permits direct sending despite suggestions", async () => {
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check")
    ? reply({ issues: JSON.parse(String(init?.body)).visualId ? [] : ["Slide 2.body: remove the early energy mapping."], model: "test-review-model" })
    : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy") }));
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready to send.");
  expect(mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides")).toHaveLength(2);
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/check"))).toHaveLength(5);
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(3);
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Tracking energy transfers");
  expect(screen.getByText("Slide 2.body: remove the early energy mapping.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
});

it("bounds changing text repairs at two and still generates all images when only AI suggestions remain", async () => {
  let version = 0;
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/slides?")) return lessons;
    if (path.endsWith("/check")) return reply({ issues: JSON.parse(String(init?.body)).visualId ? [] : ["Slide 2.body: the task still repeats the supplied answer."], model: "test-review-model" });
    if (path.endsWith("/image")) return reply({ asset });
    const draft = slideFixture("analogy"); draft.title = `Draft ${++version}`;
    return reply({ draft });
  });
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready to send.");
  expect(mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides")).toHaveLength(3);
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(3);
  expect(screen.getByText("Draft 3")).toBeTruthy();
  expect(screen.getByText("Slide 2.body: the task still repeats the supplied answer.")).toBeTruthy();
  expect((screen.getByRole("checkbox") as HTMLButtonElement).disabled).toBe(false);
});

it("finishes images and publishes residual deterministic output-rule findings without refinement or confirmation", async () => {
  const draft = slideFixture("analogy");
  draft.slides[4].task = "Copy the correct answer.";
  const issue = "Slide 5.task: ask students to write their own scientific question.";
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check")
    ? reply({ issues: JSON.parse(String(init?.body)).visualId ? [] : [issue], model: "output-rules" })
    : path.endsWith("/image") ? reply({ asset }) : reply({ draft }));
  await generate();
  expect(mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides")).toHaveLength(2);
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(3);
  expect(screen.getAllByText(issue).length).toBeGreaterThan(0);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  const requests = mocks.fetch.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[0][0].draft.slides[4].task).toBe("Copy the correct answer.");
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByRole("link", { name: "Save PPTX file" });
  expect(mocks.fetch).toHaveBeenCalledTimes(requests);
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
  expect(screen.queryByText("5 slides ready to send.")).toBeNull();
});

it("shows image-review suggestions but permits direct download without confirmation or a written reason", async () => {
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: JSON.parse(String(init?.body)).visualId === "target" ? ["Image target: compressed spring is longer; correct the geometry."] : [] }) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy") }));
  render(<SlidesWorkspace user={user} />); await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready to send.");
  expect(screen.getByText(/Image target: compressed spring/)).toBeTruthy();
  const suggestions = within(screen.getByRole("region", { name: "AI review suggestions" }));
  expect(suggestions.getByText(/Refine with AI is optional/)).toBeTruthy();
  expect(suggestions.getByRole("button", { name: "Refine with AI" })).toBeTruthy();
  const review = within(screen.getByRole("region", { name: "Review and publish" }));
  const checkbox = review.getByRole("checkbox") as HTMLButtonElement;
  const help = document.getElementById(checkbox.getAttribute("aria-describedby")!);
  expect(help).toBe(review.getByText(/The slides and images are ready/));
  expect(checkbox.disabled).toBe(false);
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByLabelText("Teacher decision note")).toBeNull();
  expect(screen.queryByRole("button", { name: "Accept after teacher review" })).toBeNull();
  const calls = mocks.fetch.mock.calls.length;
  expect((review.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  expect((review.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(review.getByRole("button", { name: "Download PPTX" }));
  await review.findByRole("link", { name: "Save PPTX file" });
  expect(mocks.download).toHaveBeenCalledOnce();
  expect(mocks.download.mock.calls[0][0].teacherDecision).toBeUndefined();
  expect(mocks.fetch).toHaveBeenCalledTimes(calls);
  expect(mocks.publish).not.toHaveBeenCalled();
  const attempts = mocks.fetch.mock.calls.filter(([path, init]) => path.endsWith("/image") && JSON.parse(init.body).visualId === "target");
  expect(attempts).toHaveLength(2);
  expect(JSON.parse(attempts[1][1].body).feedback).toContain("compressed spring is longer");
  fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Keep the student questions concise." } });
  fireEvent.click(within(screen.getByRole("region", { name: "AI review suggestions" })).getByRole("button", { name: "Refine with AI" }));
  await screen.findByText("5 slides ready to send.");
  const revision = JSON.parse(mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides").at(-1)![1].body);
  expect(revision.operation).toBe("review");
  expect(revision.feedback).toContain("compressed spring is longer");
  expect(revision.feedback).toContain("Keep the student questions concise.");
});
it("publishes advisory findings and republishes edits without optional confirmation", async () => {
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ issues: JSON.parse(String(init?.body)).visualId === "target" ? ["Image target: possible contact ambiguity."] : [] }) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy") }));
  await generate();
  expect(screen.queryByLabelText("Teacher decision note")).toBeNull();
  const calls = mocks.fetch.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish).toHaveBeenCalledOnce();
  expect(mocks.publish.mock.calls[0][0].teacherDecision).toBeUndefined();
  await act(async () => { fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "A new title" } }); });
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByRole("button", { name: "Published" })).toBeNull();
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[1][0].draft.slides[0].title).toBe("A new title");
  expect(mocks.fetch).toHaveBeenCalledTimes(calls);
});

it("allows restored decks with stale image plans to publish and keeps regeneration optional", async () => {
  const saved = deckFixture("analogy");
  saved.draft.visuals[1].prompt = "One cart touching a visibly short compressed spring, no release panel.";
  delete saved.checks;
  mocks.load.mockResolvedValue(saved);
  render(<SlidesWorkspace user={user} />);
  await screen.findByText(/Saved draft restored/);
  expect(screen.getAllByText(/· Needs update/)).toHaveLength(2);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByLabelText("target prompt")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[0][0].assets).toEqual(saved.assets);
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Regenerate target image" }));
  await screen.findByText(/Image updated/);
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  const images = mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"));
  expect(images).toHaveLength(1);
  expect(JSON.parse(images[0][1].body).draft.visuals[1].prompt).toContain("visibly short");
  expect(JSON.parse(images[0][1].body).imageModel).toBe("current");
});

it("continues image generation and direct publishing when the optional AI review service fails", async () => {
  mocks.fetch.mockImplementation(async (path: string) => path.startsWith("/api/slides?") ? lessons : path.endsWith("/check") ? reply({ error: "Quality service unavailable" }, false) : path.endsWith("/image") ? reply({ asset }) : reply({ draft: slideFixture("analogy") }));
  await generate();
  expect(screen.getByText(/Text review could not finish/)).toBeTruthy();
  expect(screen.getAllByText(/image review could not finish/)).toHaveLength(3);
  await waitFor(() => expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Tracking energy transfers");
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(3);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[0][0].checks).toBeUndefined();
});

it.each(["missing", "stale"] as const)("directly publishes restored decks with %s review snapshots without new model requests", async state => {
  const saved = deckFixture("analogy");
  if (state === "missing") delete saved.checks;
  else {
    saved.checks!.text!.key = "earlier draft";
    Object.values(saved.checks!.images).forEach(check => { check.key = "earlier image review"; });
  }
  mocks.load.mockResolvedValue(saved);
  render(<SlidesWorkspace user={user} />);
  await screen.findByText(/Saved draft restored/);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[0][0]).toEqual(saved);
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
});

it("blocks direct sending and export for an invalid required image asset", async () => {
  const saved = deckFixture("analogy");
  saved.assets.target.data = "not-an-image";
  mocks.load.mockResolvedValue(saved);
  render(<SlidesWorkspace user={user} />);
  await screen.findByText(/Saved draft restored/);
  for (const name of ["Download PPTX", "Send to students"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.download).not.toHaveBeenCalled();
});

it("keeps the generated draft and completes images when an automatic text refinement fails", async () => {
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/slides?")) return lessons;
    const body = JSON.parse(String(init?.body));
    if (path.endsWith("/check")) return reply({ issues: body.visualId ? [] : ["Consider a clearer opening question."] });
    if (path.endsWith("/image")) return reply({ asset });
    if (body.operation === "review") return reply({ error: "Refinement provider unavailable" }, false);
    return reply({ draft: slideFixture("analogy") });
  });
  await generate();
  expect(screen.getByText(/Automatic text refinement could not finish/)).toBeTruthy();
  expect(mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides")).toHaveLength(2);
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(3);
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Tracking energy transfers");
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[0][0].draft).toEqual(slideFixture("analogy"));
});

it("retains the first image and permits sending when optional automatic image refinement fails", async () => {
  let targetAttempts = 0;
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/slides?")) return lessons;
    const body = JSON.parse(String(init?.body));
    if (path.endsWith("/check")) return reply({ issues: body.visualId === "target" ? ["Consider clarifying the contact point."] : [] });
    if (path.endsWith("/image")) return body.visualId === "target" && ++targetAttempts === 2
      ? reply({ error: "Refinement provider unavailable" }, false) : reply({ asset });
    return reply({ draft: slideFixture("analogy") });
  });
  await generate();
  expect(screen.getByText(/The existing image is retained; refinement is optional/)).toBeTruthy();
  expect(mocks.fetch.mock.calls.filter(([path]) => path.endsWith("/image"))).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Send to students" }));
  await screen.findByRole("button", { name: "Published" });
  expect(mocks.publish.mock.calls[0][0].assets.target.data).toBe(asset.data);
  expect(mocks.publish.mock.calls[0][0].assets.variation.referenceData).toBe(asset.data);
});

afterEach(clearVerifiedClientAuth);

it("loads and generates GENIUS slides using verified class/task authorization and keeps text editing", async () => {
  const host: EmbeddedUserContext = { ...user, classId: "host-class", assignmentId: "host-task" };
  setVerifiedClientAuth("workspace-token", host);
  render(<SlidesWorkspace user={host} />);
  await screen.findByRole("option", { name: "8. Energy" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready to send.");
  expect(mocks.fetch.mock.calls.length).toBeGreaterThan(3);
  for (const [url, init] of mocks.fetch.mock.calls) {
    expect(init.headers.Authorization).toBe("Bearer workspace-token");
    expect(url).not.toContain("workspace-token");
  }
  await act(async () => { fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "Embedded teacher edit" } }); });
  expect((screen.getByLabelText("Slide title") as HTMLInputElement).value).toBe("Embedded teacher edit");
  expect((screen.getByRole("button", { name: "Send to students" }) as HTMLButtonElement).disabled).toBe(false);
});
