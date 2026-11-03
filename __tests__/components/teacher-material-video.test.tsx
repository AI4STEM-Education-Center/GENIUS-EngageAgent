// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import type { ContentItem, ImageState, Plan, VideoState } from "@/lib/types";
import { analogyActivity } from "../fixtures/material-activities";

// This suite exercises the teacher's material workflow; the slide editor has its own integration tests.
vi.mock("@/app/components/SlidesWorkspace", async () => {
  const { forwardRef } = await import("react");
  return { default: forwardRef(function UnusedSlideEditor() { return null; }) };
});
import TeacherView from "@/app/components/TeacherView";

const teacher: UserContext = {
  geniusId: "teacher-video", userId: "teacher-video", name: "Video teacher",
  email: null, role: "teacher", classId: "ea-class-video", assignmentId: "ea-task-video",
};
const plan: Plan = {
  name: "Lesson 3 cohort plan", strategy: "analogy", relevance: { analogy: 90 },
  overallRecommendation: "Compare familiar arrangements.", recommendationReason: "Cohort responses support analogy.",
  summary: "Compare a spring and folded paper.", tldr: "Use analogy.", rationale: "Start from familiar shapes.",
  tactics: ["Compare repeated units."], cadence: "Whole class", checks: ["Ask a question."],
};
const activity: Omit<ContentItem, "id"> = {
  type: "activity", title: "A spring and folded paper", body: "Compare the arrangement of repeated units.",
  strategy: "analogy", activity: analogyActivity,
};
const sourceImage = "https://example.com/source-spring.jpg";
const signedMedia = (path: string, signature: string, signedAt = Date.now()) => {
  const query = new URLSearchParams({ "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Signature": signature.repeat(64),
    "X-Amz-Date": new Date(signedAt).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z"), "X-Amz-Expires": "900" });
  return `https://materials.s3.us-east-2.amazonaws.com/${path}?${query}`;
};
const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const reply = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => data, text: async () => JSON.stringify(data),
}) as Response;

function seedDraft(content: ContentItem[] = [], images: Record<string, ImageState> = {}, videos: Record<string, VideoState> = {}) {
  localStorage.setItem(`engage-agent:draft:v3:${teacher.classId}:${teacher.assignmentId}`, JSON.stringify({
    version: 2, classId: teacher.classId, assignmentId: teacher.assignmentId,
    lessonNumber: 3, currentStep: 3, materialFormat: "video", plan,
    selectedStrategies: ["analogy"], annotationDecision: null, annotationReason: "", annotationStatus: "idle",
    content, images, videos, selectedForPublish: [], publishedContentIds: [],
  }));
}

function installApi(imageResponse: () => Promise<Response> = async () => reply({ url: sourceImage })) {
  fetchMock.mockImplementation(async (path) => {
    if (path.startsWith("/api/material-gallery")) return reply({ items: [] });
    if (path.startsWith("/api/lessons/")) {
      const number = Number(path.split("/").pop());
      return reply({ lesson_number: number, lesson_title: `Lesson ${number}`, learning_objective: "Observe changes in shape.", quiz_items: [] });
    }
    if (path.startsWith("/api/quiz-status?")) return reply({});
    if (path.startsWith("/api/content-publish?")) return reply({ items: [] });
    if (path.startsWith("/api/media?")) return reply({ results: [] });
    if (path === "/api/engagement-content") return reply({ items: [activity] });
    if (path === "/api/engagement-image") return imageResponse();
    if (path === "/api/engagement-video") return reply({ requestId: "video-operation-1" });
    throw new Error(`Unexpected request: ${path}`);
  });
}

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
const callsTo = (path: string) => fetchMock.mock.calls.filter(([url]) => url === path);
const requestBody = (path: string) => JSON.parse(String(callsTo(path)[0][1]?.body));

async function openMaterials() {
  render(<TeacherView user={teacher} />);
  await waitFor(() => expect((screen.getByRole("button", { name: /Generate new (slide deck|animated video)/ }) as HTMLButtonElement).disabled).toBe(false));
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  installApi();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("explicit Video generation runs content, image, then one video with the native lesson and cohort context", async () => {
  let finishImage: (response: Response) => void = () => {};
  installApi(() => new Promise((resolve) => { finishImage = resolve; }));
  seedDraft();
  await openMaterials();
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  expect(posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /Generate new (slide deck|animated video)/ }));

  await waitFor(() => expect(callsTo("/api/engagement-image")).toHaveLength(1));
  expect(callsTo("/api/engagement-content")).toHaveLength(1);
  expect(callsTo("/api/engagement-video")).toHaveLength(0);
  expect(screen.getByText("Waiting for the source image.")).toBeTruthy();

  await act(async () => { finishImage(reply({ url: sourceImage })); });
  await waitFor(() => expect(callsTo("/api/engagement-video")).toHaveLength(1));
  expect(posts().map(([path]) => path)).toEqual([
    "/api/engagement-content", "/api/engagement-image", "/api/engagement-video",
  ]);
  const context = { classId: teacher.classId, assignmentId: teacher.assignmentId, lessonNumber: 3 };
  expect(requestBody("/api/engagement-content")).toMatchObject({ ...context, selectedStrategies: ["analogy"] });
  expect(requestBody("/api/engagement-image")).toMatchObject({ ...context, studentId: "cohort" });
  expect(requestBody("/api/engagement-video")).toMatchObject({
    ...context, studentId: "cohort", imageUrl: sourceImage, plan, answers: {},
    item: { ...activity, id: expect.any(String) },
  });

  fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  expect(callsTo("/api/engagement-video")).toHaveLength(1);
});

it("switching material types with an existing image never starts a video or regenerates content", async () => {
  const saved = { ...activity, id: "saved-selector-only" };
  seedDraft([saved], { [saved.id]: { status: "ready", url: sourceImage } });
  await openMaterials();

  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  expect(screen.getByRole("button", { name: /Generate video/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  expect(screen.getByRole("button", { name: /Generate video/ })).toBeTruthy();
  expect(posts()).toHaveLength(0);
});

it("does not start a queued video when both source-image attempts fail", async () => {
  installApi(async () => reply({ error: "Image provider unavailable." }, 503));
  seedDraft();
  await openMaterials();
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  fireEvent.click(screen.getByRole("button", { name: /Generate new (slide deck|animated video)/ }));

  await screen.findByText("Image provider unavailable.");
  expect(callsTo("/api/engagement-content")).toHaveLength(1);
  expect(callsTo("/api/engagement-image")).toHaveLength(2);
  expect(callsTo("/api/engagement-video")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /Generate video/ })).toBeNull();
  expect((screen.getByRole("button", { name: /Generate new (slide deck|animated video)/ }) as HTMLButtonElement).disabled).toBe(false);
});

it("manually generates a video from a restored image without paying for content or image regeneration", async () => {
  const saved = { ...activity, id: "saved-manual-video" };
  seedDraft([saved], { [saved.id]: { status: "ready", url: sourceImage } });
  await openMaterials();
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  fireEvent.click(screen.getByRole("button", { name: /Generate video/ }));

  await waitFor(() => expect(callsTo("/api/engagement-video")).toHaveLength(1));
  expect(posts().map(([path]) => path)).toEqual(["/api/engagement-video"]);
  expect(requestBody("/api/engagement-video")).toMatchObject({
    item: saved, imageUrl: sourceImage, classId: teacher.classId,
    assignmentId: teacher.assignmentId, lessonNumber: 3, studentId: "cohort",
  });
});

it("keeps a restored Gallery video's original lesson, focus and source when saving the teacher draft", async () => {
  const saved: ContentItem = {
    ...activity, id: "gallery-video-copy", lessonNumber: 3, focus: { coreIdeas: [0] },
    gallerySource: { templateId: "shared-video", revision: 2, title: "Original shared video", mode: "adapt" },
  };
  seedDraft([saved], { [saved.id]: { status: "ready", url: sourceImage } });
  await openMaterials();
  fireEvent.click(screen.getByRole("button", { name: /^Select$/ }));
  await waitFor(() => {
    const draft = JSON.parse(localStorage.getItem(`engage-agent:draft:v3:${teacher.classId}:${teacher.assignmentId}`)!);
    expect(draft.selectedForPublish).toContain(saved.id);
    expect(draft.content[0]).toMatchObject(saved);
  });
  expect(posts()).toHaveLength(0);
});

it("refreshes an unpublished Gallery video's expired draft links and renews after returning to the task", async () => {
  const id = "gallery-copy-02e5ce78-a55c-41ea-b866-69e7313fa9c3";
  const saved: ContentItem = { ...activity, id, lessonNumber: 3, focus: { coreIdeas: [0] },
    gallerySource: { templateId: "shared-video", revision: 1, title: "Shared video", mode: "adapt" } };
  const now = Date.now();
  const expiredImage = signedMedia("material-gallery/source/image.png", "a", now - 16 * 60_000);
  const renewedImage = signedMedia("material-gallery/source/image.png", "b", now);
  const expiredVideo = signedMedia("material-gallery/source/video.mp4", "a", now - 16 * 60_000);
  const renewedVideo = signedMedia("material-gallery/source/video.mp4", "b", now);
  const laterVideo = signedMedia("material-gallery/source/video.mp4", "c", now + 16 * 60_000);
  seedDraft([saved], { [id]: { status: "ready", url: expiredImage } }, { [id]: { status: "ready", url: expiredVideo } });
  const original = fetchMock.getMockImplementation()!; let refreshed = 0;
  fetchMock.mockImplementation(async (path, init) => path.includes("action=copy-media")
    ? reply({ media: { video: ++refreshed === 1 ? renewedVideo : laterVideo, image: renewedImage } }) : original(path, init));
  await openMaterials();
  await waitFor(() => expect(screen.getByLabelText("Activity video").getAttribute("src")).toBe(renewedVideo));
  expect(screen.getByAltText(saved.title).getAttribute("src")).toBe(renewedImage);
  const refresh = fetchMock.mock.calls.find(([path]) => path.includes("action=copy-media"))!;
  expect(Object.fromEntries(new URL(refresh[0], "https://app.example").searchParams)).toEqual({ classId: teacher.classId, assignmentId: teacher.assignmentId, action: "copy-media", copyId: id.slice(13) });
  expect(refresh[1]?.method).toBe("GET"); expect(posts()).toHaveLength(0);
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 16 * 60_000);
  try {
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(screen.getByLabelText("Activity video").getAttribute("src")).toBe(laterVideo));
  } finally { clock.mockRestore(); }
  expect(posts()).toHaveLength(0);
});

it("keeps the current Gallery draft on a refresh failure and offers a retry without regeneration", async () => {
  const id = "gallery-copy-02e5ce78-a55c-41ea-b866-69e7313fa9c3";
  const oldVideo = signedMedia("material-gallery/source/video.mp4", "a", Date.now() - 16 * 60_000);
  const recoveredVideo = signedMedia("material-gallery/source/video.mp4", "b");
  seedDraft([{ ...activity, id, lessonNumber: 3 }], {}, { [id]: { status: "ready", url: oldVideo } });
  const original = fetchMock.getMockImplementation()!; let fail = true;
  fetchMock.mockImplementation(async (path, init) => path.includes("action=copy-media")
    ? fail ? reply({ error: "Temporary storage failure." }, 503) : reply({ media: { video: recoveredVideo } }) : original(path, init));
  await openMaterials();
  expect(await screen.findByText(/Some saved video links could not refresh/)).toBeTruthy();
  expect(screen.getByLabelText("Activity video").getAttribute("src")).toBe(oldVideo);
  fail = false; fireEvent.click(screen.getByRole("button", { name: "Refresh saved videos" }));
  await waitFor(() => expect(screen.getByLabelText("Activity video").getAttribute("src")).toBe(recoveredVideo));
  expect(screen.queryByText(/Some saved video links could not refresh/)).toBeNull(); expect(posts()).toHaveLength(0);
});

it("aborts an in-flight copy-media refresh when the teacher task changes", async () => {
  const id = "gallery-copy-02e5ce78-a55c-41ea-b866-69e7313fa9c3";
  seedDraft([{ ...activity, id, lessonNumber: 3 }], {}, { [id]: { status: "ready", url: "https://saved.example/old-video" } });
  let finish: (response: Response) => void = () => {};
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (path, init) => path.includes("action=copy-media") ? new Promise(resolve => { finish = resolve; }) : original(path, init));
  const view = render(<TeacherView user={teacher} />);
  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.includes("action=copy-media"))).toBe(true));
  const signal = fetchMock.mock.calls.find(([path]) => path.includes("action=copy-media"))![1]?.signal;
  view.rerender(<TeacherView user={{ ...teacher, classId: "ea-class-different", assignmentId: "ea-task-different" }} />);
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish(reply({ media: { video: "https://saved.example/stale-scope-video" } })); });
  expect(document.querySelector('video[src="https://saved.example/stale-scope-video"]')).toBeNull();
});

it("keeps a selected image history version when refresh returns the previous server version before its debounced save", async () => {
  const id = "gallery-copy-9f065d8d-5f8e-40b8-8cb7-6a536622abcc";
  const saved: ContentItem = { ...activity, id, lessonNumber: 3 };
  const now = Date.now();
  const first = signedMedia("media/copied-image_v0.png", "a", now - 16 * 60_000);
  const second = signedMedia("media/copied-image_v1.png", "b", now - 16 * 60_000);
  const renewedSecond = signedMedia("media/copied-image_v1.png", "c", now);
  const staleServerSecond = signedMedia("media/copied-image_v1.png", "d", now + 6 * 60_000);
  const renewedFirst = signedMedia("media/copied-image_v0.png", "e", now + 6 * 60_000);
  const video = signedMedia("material-gallery/source/video.mp4", "a", now);
  seedDraft([saved], { [id]: { status: "ready", url: second, historyIndex: 1,
    history: [{ url: first, createdAt: "2026-11-02T00:00:00Z" }, { url: second, createdAt: "2026-11-03T00:00:00Z" }] } }, { [id]: { status: "ready", url: video } });
  const original = fetchMock.getMockImplementation()!;
  let refreshCount = 0; let finishPut: (response: Response) => void = () => {};
  const sequence: string[] = [];
  fetchMock.mockImplementation(async (path, init) => {
    if (path.includes("action=copy-media")) {
      refreshCount++;
      if (refreshCount > 1) sequence.push(refreshCount === 2 ? "refresh returned previous version" : "selected version renewed");
      return reply({ media: { video, image: refreshCount === 1 ? renewedSecond : refreshCount === 2 ? staleServerSecond : renewedFirst } });
    }
    if (path === "/api/media" && init?.method === "PUT") {
      sequence.push("save started");
      return new Promise(resolve => { finishPut = resolve; });
    }
    return original(path, init);
  });
  await openMaterials();
  await waitFor(() => expect(screen.getByAltText(saved.title).getAttribute("src")).toBe(renewedSecond));
  // Let the initial refreshed draft settle before controlling just the version-save debounce.
  await waitFor(() => expect(JSON.parse(localStorage.getItem(`engage-agent:draft:v3:${teacher.classId}:${teacher.assignmentId}`)!).images[id].url).toBe(renewedSecond));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60_000);
  try {
    fireEvent.click(screen.getByRole("button", { name: "←" })); sequence.push("selected previous version");
    expect(screen.getByAltText(saved.title).getAttribute("src")).toBe(first);
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(refreshCount).toBe(2); expect(sequence).toEqual(["selected previous version", "refresh returned previous version"]);
    expect(screen.getByAltText(saved.title).getAttribute("src")).toBe(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(sequence.at(-1)).toBe("save started");
    const put = fetchMock.mock.calls.find(([path, init]) => path === "/api/media" && init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]?.body))).toMatchObject({ contentItemId: id, versionIndex: 0 });
    await act(async () => { finishPut(reply({ updated: true })); });
    expect(refreshCount).toBe(3); expect(sequence.at(-1)).toBe("selected version renewed");
    expect(screen.getByAltText(saved.title).getAttribute("src")).toBe(renewedFirst);
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    const persisted = JSON.parse(localStorage.getItem(`engage-agent:draft:v3:${teacher.classId}:${teacher.assignmentId}`)!).images[id];
    expect(persisted.historyIndex).toBe(0); expect(persisted.url).toBe(renewedFirst);
    expect(persisted.history.map((entry: { url: string }) => entry.url)).toEqual([renewedFirst, renewedSecond]);
  } finally { clock.mockRestore(); vi.useRealTimers(); }
});

it("does not write a newly saved refinement into the old history slot before its generation response arrives", async () => {
  const id = "gallery-copy-a25110e2-8143-448b-84d4-bd9eb60a206e";
  const saved: ContentItem = { ...activity, id, lessonNumber: 3 };
  const now = Date.now();
  const originalImage = signedMedia("media/refined-copy_image_v0.png", "a", now);
  const newImage = signedMedia("media/refined-copy_image_v1.png", "b", now + 6 * 60_000);
  const video = signedMedia("material-gallery/refined-source/video.mp4", "a", now);
  seedDraft([saved], { [id]: { status: "ready", url: originalImage, historyIndex: 0, history: [{ url: originalImage, createdAt: "2026-11-03T00:00:00Z" }] } }, { [id]: { status: "ready", url: video } });
  const original = fetchMock.getMockImplementation()!; let refreshCount = 0;
  let finishRefine: (response: Response) => void = () => {};
  fetchMock.mockImplementation(async (path, init) => {
    if (path.includes("action=copy-media")) return reply({ media: { video, image: ++refreshCount === 1 ? originalImage : newImage } });
    if (path === "/api/engagement-image") return new Promise(resolve => { finishRefine = resolve; });
    return original(path, init);
  });
  await openMaterials(); await waitFor(() => expect(refreshCount).toBe(1));
  fireEvent.click(screen.getAllByRole("button", { name: "Refine" })[0]);
  fireEvent.change(screen.getByPlaceholderText("Describe how you'd like to modify this image..."), { target: { value: "Make the gaps clearer." } });
  fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  await waitFor(() => expect(callsTo("/api/engagement-image")).toHaveLength(1));
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60_000);
  try {
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(refreshCount).toBe(2); expect(screen.getAllByAltText(saved.title).map(image => image.getAttribute("src"))).toEqual([originalImage, originalImage]);
    await act(async () => { finishRefine(reply({ url: newImage })); });
    expect(screen.getAllByAltText(saved.title).map(image => image.getAttribute("src"))).toEqual([newImage, newImage]);
    await waitFor(() => {
      const image = JSON.parse(localStorage.getItem(`engage-agent:draft:v3:${teacher.classId}:${teacher.assignmentId}`)!).images[id];
      expect(image.historyIndex).toBe(1); expect(image.history.map((entry: { url: string }) => entry.url)).toEqual([originalImage, newImage]);
    });
  } finally { clock.mockRestore(); }
});

it("uses saved classroom edits when generating a video for an adapted material", async () => {
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); });
  const saved: ContentItem = { ...activity, id: "adapted-video", lessonNumber: 3, focus: { coreIdeas: [0] } };
  seedDraft([saved], { [saved.id]: { status: "ready", url: sourceImage } });
  await openMaterials();
  fireEvent.click(screen.getByRole("button", { name: "Edit material" }));
  const editor = within(screen.getByRole("dialog", { name: "Edit video material" }));
  fireEvent.change(editor.getByLabelText("Material title"), { target: { value: "Our adapted activity" } });
  fireEvent.change(editor.getByLabelText("Activity text"), { target: { value: "Compare our classroom models." } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  fireEvent.click(screen.getByRole("button", { name: /Generate video/ }));
  await waitFor(() => expect(callsTo("/api/engagement-video")).toHaveLength(1));
  expect(requestBody("/api/engagement-video")).toMatchObject({
    item: { ...saved, title: "Our adapted activity", body: "Compare our classroom models." }, imageUrl: sourceImage,
  });
  expect(posts().map(([path]) => path)).toEqual(["/api/engagement-video"]);
});
