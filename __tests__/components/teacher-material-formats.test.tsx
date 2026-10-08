// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import type { UserContext } from "@/lib/auth";
import type { SlideStrategy } from "@/lib/slides/model";
import type { SlidesWorkspaceHandle } from "@/app/components/SlidesWorkspace";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), generate: vi.fn(), mount: vi.fn(), unmount: vi.fn(), download: vi.fn(), revoke: vi.fn() }));

type EmbeddedProps = {
  user: UserContext;
  embeddedContext?: { lessonNumber: number; strategy: SlideStrategy; classroomContext?: string };
  onReadyChange?: (strategy: SlideStrategy, ready: boolean) => void;
  onBusyChange?: (strategy: SlideStrategy, busy: boolean) => void;
};

vi.mock("@/app/components/SlidesWorkspace", async () => {
  const { forwardRef, useEffect, useImperativeHandle, useState } = await import("react");
  return {
    default: forwardRef<SlidesWorkspaceHandle, EmbeddedProps>(function EmbeddedSlides({ user, embeddedContext, onReadyChange, onBusyChange }, ref) {
      const [draft, setDraft] = useState("No draft yet");
      const strategy = embeddedContext?.strategy;
      useEffect(() => {
        if (!strategy) return;
        mocks.mount(strategy);
        return () => { mocks.unmount(strategy); };
      }, [strategy]);
      useEffect(() => {
        if (!strategy) return;
        onReadyChange?.(strategy, true);
        onBusyChange?.(strategy, false);
        return () => { onReadyChange?.(strategy, false); onBusyChange?.(strategy, false); };
      }, [strategy, onReadyChange, onBusyChange]);
      useImperativeHandle(ref, () => ({
        generate() {
          mocks.generate({ ...embeddedContext, classId: user.classId, assignmentId: user.assignmentId });
          setDraft(`Generated ${strategy} draft`);
        },
      }));
      return <section aria-label={`${strategy} slide draft`}>
        <p>{`Slide context: lesson ${embeddedContext?.lessonNumber}, ${strategy}`}</p>
        <label>Draft for {strategy}<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      </section>;
    }),
  };
});

vi.mock("@/lib/material-export", () => ({ downloadStudentMaterial: mocks.download }));

import TeacherView from "@/app/components/TeacherView";

const user: UserContext = {
  geniusId: "teacher", userId: "teacher", name: "Test teacher", email: null,
  role: "teacher", classId: "ea-class-materials", assignmentId: "ea-task-materials",
};
const draftKey = `engage-agent:draft:v3:${user.classId}:${user.assignmentId}`;
const supportedStrategies: SlideStrategy[] = ["analogy", "cognitive conflict", "experience bridging"];
const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
const postCalls = (path?: string) => mocks.fetch.mock.calls.filter(([input, init]) => init?.method === "POST" && (!path || input === path));

function seedDraft(overrides: Record<string, unknown> = {}) {
  localStorage.setItem(draftKey, JSON.stringify({
    version: 2, classId: user.classId, assignmentId: user.assignmentId,
    lessonNumber: 8, currentStep: 3, plan: null, selectedStrategies: ["analogy"],
    annotationDecision: null, annotationReason: "", annotationStatus: "idle", content: [],
    ...overrides,
  }));
}

async function ready() {
  await screen.findByText("Lesson 8: Energy");
  return screen.getByRole("button", { name: "Generate materials" });
}

async function openSavedActivities() {
  fireEvent.click(await screen.findByRole("button", { name: "View saved activities" }));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { revokeObjectURL: mocks.revoke }));
  mocks.download.mockResolvedValue({ url: "blob:material", dataUri: "data:text/html;charset=utf-8;base64,aGVsbG8=", fileName: "Shared-activity.html" });
  mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/lessons/")) {
      const lesson = Number(input.split("/").pop());
      return reply({ lesson_number: lesson, lesson_title: lesson === 8 ? "Energy" : `Lesson ${lesson}`, learning_objective: "Track energy", core_ideas: [], misconceptions: {}, quiz_items: [] });
    }
    if (input === "/api/engagement-content") {
      const body = JSON.parse(String(init?.body));
      return reply({ items: body.selectedStrategies.map((strategy: string) => ({
        type: "phenomenon", title: `${strategy} activity`, body: "Compare the two observations.", strategy,
      })) });
    }
    if (input === "/api/engagement-image") return reply({ url: "https://example.test/activity.png" });
    if (input === "/api/engagement-video") return reply({ requestId: "video-request" });
    if (input.startsWith("/api/engagement-video/status?")) return reply({ done: true, url: "https://example.test/activity.mp4" });
    return reply({});
  });
});

afterEach(() => { clearVerifiedClientAuth(); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("opens a Slides entry with only the last valid saved strategy without generating", async () => {
  seedDraft({ currentStep: 1, materialFormat: "video", selectedStrategies: supportedStrategies });
  render(<TeacherView user={user} initialMaterialFormat="slides" />);
  await ready();
  expect(screen.getByRole("radio", { name: "Slides" })).toBeChecked();
  expect(screen.getByText("Slide context: lesson 8, experience bridging")).toBeVisible();
  expect(screen.queryByText("Slide context: lesson 8, analogy")).toBeNull();
  expect(screen.queryByText("Slide context: lesson 8, cognitive conflict")).toBeNull();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(postCalls()).toHaveLength(0);
});

it("defaults new material generation to Slides and offers only Slides and Video", async () => {
  render(<TeacherView user={user} />);
  fireEvent.click(await screen.findByRole("button", { name: /Energy/ }));
  fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
  fireEvent.click(screen.getByRole("button", { name: "Analogy" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to material generation" }));
  await ready();
  expect(screen.getAllByRole("radio").map(input => input.getAttribute("value"))).toEqual(["slides", "video"]);
  expect(screen.getByRole("radio", { name: "Slides" })).toBeChecked();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(postCalls().filter(([input]) => input.startsWith("/api/engagement-"))).toHaveLength(0);
});

it.each([undefined, "text-image"])("migrates legacy format %s to Slides while preserving readable material across reload and format switches", async (materialFormat) => {
  seedDraft({
    materialFormat,
    content: [{ id: "saved-activity", type: "phenomenon", title: "Existing activity", body: "Keep this material.", strategy: "analogy" }],
    images: { "saved-activity": { status: "ready", url: "https://example.test/saved.png" } },
  });
  const view = render(<TeacherView user={user} />);
  await ready();
  expect(screen.getByRole("radio", { name: "Slides" })).toBeChecked();
  expect(screen.queryByRole("radio", { name: "Text + Image" })).toBeNull();
  await openSavedActivities();
  await screen.findByRole("img", { name: "Existing activity" });
  for (const format of ["Video", "Slides", "Video", "Slides"]) {
    fireEvent.click(screen.getByRole("radio", { name: format }));
    expect(screen.getByRole("radio", { name: format })).toBeChecked();
  }
  expect(screen.getByText("Keep this material.")).toBeVisible();
  await waitFor(() => {
    const saved = JSON.parse(localStorage.getItem(draftKey)!);
    expect(saved.materialFormat).toBe("slides");
    expect(saved.content[0].body).toBe("Keep this material.");
    expect(saved.images["saved-activity"].url).toBe("https://example.test/saved.png");
  });
  view.unmount();
  render(<TeacherView user={user} />);
  await ready();
  expect(screen.getByRole("radio", { name: "Slides" })).toBeChecked();
  await openSavedActivities();
  expect(screen.getByText("Keep this material.")).toBeVisible();
  expect(screen.getByRole("img", { name: "Existing activity" })).toHaveAttribute("src", "https://example.test/saved.png");
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(postCalls()).toHaveLength(0);
});

it("generates the selected slide strategy with inherited context and retains its edited draft across formats and steps", async () => {
  const strategy = "experience bridging";
  seedDraft({ selectedStrategies: [strategy] });
  render(<TeacherView user={user} />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
  const generate = screen.getByRole("button", { name: "Generate materials" });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  expect(mocks.generate.mock.calls.map(([context]) => context)).toEqual([{
    lessonNumber: 8, strategy, classroomContext: "", classId: user.classId, assignmentId: user.assignmentId,
  }]);
  fireEvent.change(screen.getByRole("textbox", { name: `Draft for ${strategy}` }), { target: { value: `Teacher edit: ${strategy}` } });
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
  expect(screen.queryByRole("radio", { name: "Slides" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Content generation/ }));
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Slides" })); });
  expect(screen.getByRole("textbox", { name: `Draft for ${strategy}` })).toHaveValue(`Teacher edit: ${strategy}`);
  expect(mocks.mount).toHaveBeenCalledTimes(1);
  expect(mocks.unmount).not.toHaveBeenCalled();
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(postCalls()).toHaveLength(0);
});

it("persists the chosen material format for the same class and task", async () => {
  seedDraft();
  const view = render(<TeacherView user={user} />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey)!).materialFormat).toBe("video"));
  view.unmount();
  render(<TeacherView user={user} />);
  await ready();
  expect(screen.getByRole("radio", { name: "Video" })).toBeChecked();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(postCalls()).toHaveLength(0);
});

it("switches A to B exclusively, keeps B selected on another click, and restores only B for generation", async () => {
  seedDraft({ currentStep: 2 });
  const view = render(<TeacherView user={user} />);
  const analogy = await screen.findByRole("button", { name: "Analogy · Selected" });
  expect(analogy).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Cognitive Conflict" }));
  expect(analogy).toHaveAttribute("aria-pressed", "false");
  const conflict = screen.getByRole("button", { name: "Cognitive Conflict · Selected" });
  expect(conflict).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(conflict);
  expect(conflict).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Continue to material generation" })).toBeEnabled();
  await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey)!).selectedStrategies).toEqual(["cognitive conflict"]));
  expect(postCalls()).toHaveLength(0);

  view.unmount();
  render(<TeacherView user={user} />);
  expect(await screen.findByRole("button", { name: "Cognitive Conflict · Selected" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Analogy" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Continue to material generation" }));
  const generate = await ready();
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  await waitFor(() => expect(generate).toBeEnabled());
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(generate); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  vi.useRealTimers();
  expect(postCalls("/api/engagement-image")).toHaveLength(1);
  expect(JSON.parse(postCalls("/api/engagement-content")[0][1].body).selectedStrategies).toEqual(["cognitive conflict"]);
  expect(JSON.parse(postCalls("/api/engagement-image")[0][1].body).item.strategy).toBe("cognitive conflict");
  fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ strategy: "cognitive conflict" }));
});

it("normalizes an old multi-strategy draft to its last valid selection without deleting earlier materials", async () => {
  const content = [
    { id: "existing-analogy", type: "phenomenon", title: "Saved analogy", body: "Keep this comparison.", strategy: "analogy" },
    { id: "existing-experience", type: "phenomenon", title: "Saved experience", body: "Keep this experience.", strategy: "experience bridging" },
  ];
  seedDraft({ currentStep: 2, selectedStrategies: ["analogy", "experience bridging", "cognitive conflict", "retired strategy"], content,
    images: Object.fromEntries(content.map(item => [item.id, { status: "ready", url: `https://example.test/${item.id}.png` }])) });
  render(<TeacherView user={user} />);
  expect(await screen.findByRole("button", { name: "Cognitive Conflict · Selected" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Analogy" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Experience Bridging" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Continue to material generation" }));
  await ready();
  await openSavedActivities();
  for (const item of content) {
    expect(screen.getByText(item.body)).toBeVisible();
    expect(screen.getByRole("img", { name: item.title })).toBeVisible();
  }
  await waitFor(() => {
    const saved = JSON.parse(localStorage.getItem(draftKey)!);
    expect(saved.selectedStrategies).toEqual(["cognitive conflict"]);
    expect(saved.content).toEqual(expect.arrayContaining(content.map(item => expect.objectContaining(item))));
  });
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(postCalls()).toHaveLength(0);
});

it("restores published materials from multiple strategies while selecting only one for future generation", async () => {
  const content = [
    { id: "published-a", type: "phenomenon", title: "Published comparison", body: "Keep the published comparison.", strategy: "analogy" },
    { id: "published-b", type: "phenomenon", title: "Published conflict", body: "Keep the published conflict.", strategy: "cognitive conflict" },
  ];
  const originalFetch = mocks.fetch.getMockImplementation()!;
  mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => input.startsWith("/api/content-publish")
    ? reply({ items: content.map(item => ({ content_item_id: item.id, content_json: JSON.stringify(item), media: { image: `https://example.test/${item.id}.png` } })) })
    : originalFetch(input, init));
  seedDraft({ selectedStrategies: [] });
  render(<TeacherView user={user} />);
  await openSavedActivities();
  await screen.findByText("Keep the published conflict.");
  expect(screen.getByText("Keep the published comparison.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
  expect(screen.getByRole("button", { name: "Cognitive Conflict · Selected" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Analogy" })).toHaveAttribute("aria-pressed", "false");
  expect(postCalls()).toHaveLength(0);
});

it("blocks Slides when the single restored strategy is unsupported", async () => {
  seedDraft({ selectedStrategies: ["analogy", "engaged critiquing"], materialFormat: "slides" });
  render(<TeacherView user={user} />);
  const generate = await ready();
  expect(screen.getByRole("status")).toHaveTextContent("Slides do not yet support Engaged Critiquing");
  expect(generate).toBeDisabled();
  fireEvent.click(generate);
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(postCalls()).toHaveLength(0);
  expect(screen.getByRole("status")).not.toHaveTextContent("Text + Image");
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  expect(generate).toBeEnabled();
  expect(postCalls()).toHaveLength(0);
});

it("routes Video generation through the material APIs with only the last restored strategy", async () => {
  seedDraft({ materialFormat: "video", selectedStrategies: ["analogy", "cognitive conflict"] });
  render(<TeacherView user={user} />);
  const generate = await ready();
  fireEvent.click(generate);
  await waitFor(() => expect(postCalls("/api/engagement-image")).toHaveLength(1));
  expect(postCalls("/api/engagement-content")).toHaveLength(1);
  expect(JSON.parse(postCalls("/api/engagement-content")[0][1].body)).toMatchObject({
    lessonNumber: 8, selectedStrategies: ["cognitive conflict"], classId: user.classId, assignmentId: user.assignmentId,
  });
  await waitFor(() => expect(postCalls("/api/engagement-video")).toHaveLength(1));
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("preserves teacher-supplied experience context for this task and sends it for slides and video generation", async () => {
  seedDraft({ selectedStrategies: ["experience bridging"] });
  const view = render(<TeacherView user={user} />);
  await ready();
  const context = "Grade 9; survey responses mention walking to school and cooking with family.";
  fireEvent.change(screen.getByRole("textbox", { name: "Classroom context (optional)" }), { target: { value: context } });
  await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey)!).classroomContext).toBe(context));
  view.unmount();
  render(<TeacherView user={user} />);
  await ready();
  expect(screen.getByRole("textbox", { name: "Classroom context (optional)" })).toHaveValue(context);
  const generate = screen.getByRole("button", { name: "Generate materials" });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ classroomContext: context }));
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  fireEvent.click(generate);
  await waitFor(() => expect(postCalls("/api/engagement-content")).toHaveLength(1));
  expect(JSON.parse(postCalls("/api/engagement-content")[0][1].body).classroomContext).toBe(context);
});

it("starts video generation only after an explicit shared Generate action and does not restart it on format switches", async () => {
  seedDraft({ materialFormat: "video" });
  render(<TeacherView user={user} />);
  const generate = await ready();
  expect(postCalls()).toHaveLength(0);
  fireEvent.click(generate);
  await waitFor(() => expect(postCalls("/api/engagement-video")).toHaveLength(1));
  expect(postCalls("/api/engagement-content")).toHaveLength(1);
  expect(postCalls("/api/engagement-image")).toHaveLength(1);
  const videoRequest = JSON.parse(postCalls("/api/engagement-video")[0][1].body);
  expect(videoRequest).toMatchObject({ classId: user.classId, assignmentId: user.assignmentId, lessonNumber: 8, imageUrl: "https://example.test/activity.png" });
  for (const format of ["Slides", "Video"]) fireEvent.click(screen.getByRole("radio", { name: format }));
  expect(postCalls("/api/engagement-video")).toHaveLength(1);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("keeps saved activities publishable without attaching a video retained from another format", async () => {
  seedDraft({
    content: [{ id: "publish-activity", type: "phenomenon", title: "Shared activity", body: "Compare the observations.", strategy: "analogy" }],
    images: { "publish-activity": { status: "ready", url: "https://example.test/publish.png" } },
    videos: { "publish-activity": { status: "ready", url: "https://example.test/publish.mp4" } },
    selectedForPublish: ["publish-activity"],
  });
  render(<TeacherView user={user} />);
  await ready();
  await openSavedActivities();
  const send = screen.getByRole("button", { name: "Send to students" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await waitFor(() => expect(postCalls("/api/content-publish")).toHaveLength(1));
  const published = JSON.parse(postCalls("/api/content-publish")[0][1].body);
  expect(published.contentItems[0].media).toEqual({ image: "https://example.test/publish.png" });
  expect(postCalls("/api/engagement-video")).toHaveLength(0);
});

it("keeps Video publishing disabled until the selected video's explicit generation completes", async () => {
  seedDraft({
    materialFormat: "video",
    content: [{ id: "video-publish-activity", type: "phenomenon", title: "Video activity", body: "Compare the observations.", strategy: "analogy" }],
    images: { "video-publish-activity": { status: "ready", url: "https://example.test/publish-source.png" } },
    selectedForPublish: ["video-publish-activity"],
  });
  render(<TeacherView user={user} />);
  await ready();
  const send = screen.getByRole("button", { name: "Send to students" });
  expect(send).toBeDisabled();
  fireEvent.click(send);
  expect(postCalls("/api/content-publish")).toHaveLength(0);
  expect(postCalls("/api/engagement-video")).toHaveLength(0);
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Generate video/ })); });
  expect(send).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(send).toBeEnabled();
  expect(postCalls("/api/engagement-video")).toHaveLength(1);
  await act(async () => { fireEvent.click(send); });
  expect(postCalls("/api/content-publish")).toHaveLength(1);
  const published = JSON.parse(postCalls("/api/content-publish")[0][1].body);
  expect(published.contentItems[0].media).toEqual({ image: "https://example.test/publish-source.png", video: "https://example.test/activity.mp4" });
});


it("shares the current classroom context with the selected Slides editor", async () => {
  seedDraft({ selectedStrategies: supportedStrategies, classroomContext: "Grade 8; familiar with playground games." });
  render(<TeacherView user={user} />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Classroom context (optional)" }), { target: { value: "Grade 9; students describe riding bicycles." } });
  const generate = screen.getByRole("button", { name: "Generate materials" });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  for (const [context] of mocks.generate.mock.calls) expect(context.classroomContext).toBe("Grade 9; students describe riding bicycles.");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});

it("uses new content identities when regenerating a material with the same title", async () => {
  seedDraft({ materialFormat: "video" });
  render(<TeacherView user={user} />);
  await ready();
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Generate materials" })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(postCalls("/api/engagement-image")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Generate materials" })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Generate materials" })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(postCalls("/api/engagement-image")).toHaveLength(2);
  vi.useRealTimers();
  const items = postCalls("/api/engagement-image").map(([, init]) => JSON.parse(init.body).item);
  expect(items[0].title).toBe(items[1].title);
  expect(items[0].id).not.toBe(items[1].id);
  expect(items[0].id).toMatch(/^[a-f0-9-]{36}$/);
});

it("downloads the complete selected student material with its current image", async () => {
  const item = { id: "download-activity", type: "phenomenon", title: "Shared activity", body: "Compare the observations.", strategy: "analogy" };
  seedDraft({ content: [item], images: { [item.id]: { status: "ready", url: "https://example.test/current.png" } } });
  render(<TeacherView user={user} />);
  await ready();
  await openSavedActivities();
  const download = screen.getByRole("button", { name: "Download material (HTML)" });
  await waitFor(() => expect(download).toBeEnabled());
  fireEvent.click(download);
  await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining(item), "https://example.test/current.png", expect.any(AbortSignal), { classId: user.classId, assignmentId: user.assignmentId }));
  const link = await screen.findByRole("link", { name: "Save material file" });
  expect(link).toHaveAttribute("href", "data:text/html;charset=utf-8;base64,aGVsbG8=");
  expect(link).toHaveAttribute("download", "Shared-activity.html");
  expect(link).not.toHaveAttribute("target");
  expect(mocks.revoke).not.toHaveBeenCalled();
});

it("prefers the HTTP material attachment and keeps the local Blob separate for cleanup", async () => {
  const item = { id: "http-download", type: "phenomenon", title: "HTTP activity", body: "Compare the observations.", strategy: "analogy" };
  seedDraft({ content: [item], images: { [item.id]: { status: "ready", url: "https://example.test/current.png" } } });
  mocks.download.mockResolvedValueOnce({ url: "blob:http-material", dataUri: "data:text/html;base64,aGVsbG8=", httpUrl: "https://files.example.test/material.html", fileName: "Material.html" });
  const view = render(<TeacherView user={user} />); await ready();
  await openSavedActivities();
  const download = screen.getByRole("button", { name: "Download material (HTML)" });
  await waitFor(() => expect(download).toBeEnabled()); fireEvent.click(download);
  expect(await screen.findByRole("link", { name: "Save material file" })).toHaveAttribute("href", "https://files.example.test/material.html");
  expect(screen.getByText(/Save link expires in 10 minutes/)).toBeTruthy();
  view.unmount(); expect(mocks.revoke).toHaveBeenCalledWith("blob:http-material");
  expect(mocks.revoke).not.toHaveBeenCalledWith("https://files.example.test/material.html");
});

it("releases prepared material files on replacement and unmount", async () => {
  const item = { id: "download-activity", type: "phenomenon", title: "Shared activity", body: "Compare the observations.", strategy: "analogy" };
  seedDraft({ content: [item], images: { [item.id]: { status: "ready", url: "https://example.test/current.png" } } });
  const view = render(<TeacherView user={user} />); await ready();
  await openSavedActivities();
  const download = screen.getByRole("button", { name: "Download material (HTML)" });
  await waitFor(() => expect(download).toBeEnabled()); fireEvent.click(download);
  await screen.findByRole("link", { name: "Save material file" });
  mocks.download.mockResolvedValueOnce({ url: "blob:replacement", dataUri: "data:text/html;base64,bmV3", fileName: "Replacement.html" });
  fireEvent.click(download);
  await waitFor(() => expect(screen.getByRole("link", { name: "Save material file" })).toHaveAttribute("download", "Replacement.html"));
  expect(mocks.revoke).toHaveBeenCalledWith("blob:material");
  view.unmount(); expect(mocks.revoke).toHaveBeenCalledWith("blob:replacement");
});

it("invalidates a prepared link when the teacher selects another image version", async () => {
  const item = { id: "download-versions", type: "phenomenon", title: "Versioned activity", body: "Compare the observations.", strategy: "analogy" };
  seedDraft({ content: [item], images: { [item.id]: { status: "ready", url: "https://example.test/current.png", historyIndex: 1,
    history: [{ url: "https://example.test/earlier.png", createdAt: "2026-10-01T00:00:00Z" }, { url: "https://example.test/current.png", createdAt: "2026-10-02T00:00:00Z" }] } } });
  render(<TeacherView user={user} />); await ready();
  await openSavedActivities();
  const download = screen.getByRole("button", { name: "Download material (HTML)" });
  await waitFor(() => expect(download).toBeEnabled()); fireEvent.click(download);
  await screen.findByRole("link", { name: "Save material file" });
  fireEvent.click(screen.getByRole("button", { name: "←" }));
  expect(screen.queryByRole("link", { name: "Save material file" })).toBeNull();
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith("blob:material"));
});

it("aborts preparation when its content is replaced and discards a late file without exposing it", async () => {
  const item = { id: "download-old", type: "phenomenon", title: "Old activity", body: "Compare the observations.", strategy: "analogy" };
  seedDraft({ content: [item], images: { [item.id]: { status: "ready", url: "https://example.test/current.png" } } });
  let finish: (value: unknown) => void = () => {};
  mocks.download.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<TeacherView user={user} />); await ready();
  await openSavedActivities();
  const download = screen.getByRole("button", { name: "Download material (HTML)" });
  await waitFor(() => expect(download).toBeEnabled()); fireEvent.click(download);
  const signal = mocks.download.mock.calls[0][2] as AbortSignal;
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate materials" }));
  await waitFor(() => expect(signal.aborted).toBe(true));
  await act(async () => finish({ url: "blob:late", dataUri: "data:text/html;base64,b2xk", fileName: "Old.html" }));
  expect(screen.queryByRole("link", { name: "Save material file" })).toBeNull();
  expect(mocks.revoke).toHaveBeenCalledWith("blob:late");
});


it("lets a teacher manually generate draft materials before any student response without inventing a recommendation", async () => {
  seedDraft({ currentStep: 2, materialFormat: "video", selectedStrategies: [] });
  render(<TeacherView user={user} />);
  await screen.findByRole("button", { name: "Analyze 0 students" });
  expect(screen.getByRole("button", { name: "Analyze 0 students" })).toBeDisabled();
  expect(screen.queryByText("Master plan")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cognitive Conflict" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to material generation" }));
  const generate = await ready();
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  await waitFor(() => expect(postCalls("/api/engagement-content")).toHaveLength(1));
  expect(JSON.parse(postCalls("/api/engagement-content")[0][1].body).selectedStrategies).toEqual(["cognitive conflict"]);
  expect(mocks.fetch.mock.calls.some(([input]) => String(input).includes("cohort-analysis"))).toBe(false);
});

it("carries the actual class rule-based recommendation into the shared material generator", async () => {
  const defaultFetch = mocks.fetch.getMockImplementation()!;
  mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/quiz-status")) return reply({ quizStatus: { lesson_number: 8, status: "published" } });
    if (input.startsWith("/api/student-answers")) return reply({ answers: [
      { student_id: "student-a", student_name: "Student A", class_id: user.classId, assignment_id: user.assignmentId, lesson_number: 8, answers: { L8_Q1: "C", L8_Q2: "C", L8_Q3: "A", L8_Q4: "A" } },
      { student_id: "student-b", student_name: "Student B", class_id: user.classId, assignment_id: user.assignmentId, lesson_number: 8, answers: { L8_Q1: "C", L8_Q2: "C", L8_Q3: "A", L8_Q4: "A" } },
    ] });
    return defaultFetch(input, init);
  });
  seedDraft({ currentStep: 2, selectedStrategies: [] });
  render(<TeacherView user={user} />);
  fireEvent.click(await screen.findByRole("button", { name: "Analyze 2 students" }));
  expect(screen.getByRole("button", { name: "Cognitive Conflict · Recommended · Selected" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Continue to material generation" }));
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
  const generate = screen.getByRole("button", { name: "Generate materials" });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ lessonNumber: 8, strategy: "cognitive conflict" }));
  expect(mocks.fetch.mock.calls.some(([input]) => String(input).includes("cohort-analysis"))).toBe(false);
});

it("uses the existing material selector, slide editor and publication list for a GENIUS class task", async () => {
  const host: UserContext = { ...user, classId: "genius-class", assignmentId: "genius-task" };
  setVerifiedClientAuth("host-class-token", host);
  seedDraft({ classId: host.classId, assignmentId: host.assignmentId, materialFormat: "slides", classroomContext: "Grade 8 GENIUS class" });
  localStorage.setItem(`engage-agent:draft:v3:${host.classId}:${host.assignmentId}`, localStorage.getItem(draftKey)!);
  const originalFetch = mocks.fetch.getMockImplementation()!;
  mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => input.startsWith("/api/content-publish") ? reply({ items: [{
    content_item_id: "host-slides", content_json: JSON.stringify({ id: "host-slides", type: "Slides", title: "GENIUS published slides", body: "", strategy: "analogy", slides: {
      publicationId: "4e96360b-17a4-4a54-84da-df0c5d2ef012", lessonNumber: 8, slideCount: 6,
    } }),
  }] }) : originalFetch(input, init));
  render(<TeacherView user={host} />);
  await ready();
  expect(screen.getByRole("radio", { name: "Slides" })).toBeChecked();
  expect(screen.getByText("Slide context: lesson 8, analogy")).toBeVisible();
  expect(await screen.findByRole("button", { name: "Read slides" })).toBeEnabled();
  expect(mocks.fetch.mock.calls.some(([url, init]) => url.startsWith("/api/content-publish") && init?.headers?.Authorization === "Bearer host-class-token")).toBe(true);
  const generate = screen.getByRole("button", { name: "Generate materials" });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  expect(mocks.generate).toHaveBeenCalledWith({ lessonNumber: 8, strategy: "analogy", classroomContext: "Grade 8 GENIUS class", classId: host.classId, assignmentId: host.assignmentId });
  expect(screen.getByRole("textbox", { name: "Draft for analogy" })).toHaveValue("Generated analogy draft");
});

it("hydrates an embedded teacher workflow and generates in memory when browser storage is denied", async () => {
  const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage denied"); });
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const host = { ...user, classId: "host-class", assignmentId: "host-task" };
    render(<TeacherView user={host} />);
    fireEvent.click(await screen.findByRole("button", { name: /Energy/ }));
    fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
    fireEvent.click(screen.getByRole("button", { name: "Analogy" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to material generation" }));
    await ready();
    fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
    const generate = screen.getByRole("button", { name: "Generate materials" });
    await waitFor(() => expect(generate).toBeEnabled());
    fireEvent.click(generate);
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ classId: host.classId, assignmentId: host.assignmentId, lessonNumber: 8, strategy: "analogy" }));
    expect(screen.getByRole("textbox", { name: "Draft for analogy" })).toHaveValue("Generated analogy draft");
  } finally {
    getItem.mockRestore(); setItem.mockRestore(); warn.mockRestore();
  }
});
