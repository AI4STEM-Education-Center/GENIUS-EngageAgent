// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import type { SlideStrategy } from "@/lib/slides/model";
import type { SlidesWorkspaceHandle } from "@/app/components/SlidesWorkspace";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), generate: vi.fn(), mount: vi.fn(), unmount: vi.fn(), download: vi.fn() }));

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

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
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

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("opens a Slides entry using the saved lesson and strategies without generating", async () => {
  seedDraft({ currentStep: 1, materialFormat: "video", selectedStrategies: supportedStrategies });
  render(<TeacherView user={user} initialMaterialFormat="slides" />);
  await ready();
  expect(screen.getByRole("radio", { name: "Slides" })).toBeChecked();
  for (const strategy of supportedStrategies) {
    expect(screen.getByText(`Slide context: lesson 8, ${strategy}`)).toBeVisible();
  }
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(postCalls()).toHaveLength(0);
});

it("keeps legacy drafts on Text + Image and never generates merely by switching formats", async () => {
  seedDraft({
    content: [{ id: "saved-activity", type: "phenomenon", title: "Existing activity", body: "Keep this material.", strategy: "analogy" }],
    images: { "saved-activity": { status: "ready", url: "https://example.test/saved.png" } },
  });
  render(<TeacherView user={user} />);
  await ready();
  expect(screen.getByRole("radio", { name: "Text + Image" })).toBeChecked();
  await screen.findByRole("img", { name: "Existing activity" });
  for (const format of ["Slides", "Video", "Text + Image", "Slides", "Video"]) {
    fireEvent.click(screen.getByRole("radio", { name: format }));
    expect(screen.getByRole("radio", { name: format })).toBeChecked();
  }
  expect(screen.getByRole("button", { name: /Generate video/ })).toBeVisible();
  expect(screen.getByText("Keep this material.")).toBeVisible();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(postCalls()).toHaveLength(0);
});

it("generates each selected slide strategy with the inherited context and retains edited drafts across formats and steps", async () => {
  seedDraft({ selectedStrategies: supportedStrategies });
  render(<TeacherView user={user} />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
  const generate = screen.getByRole("button", { name: "Generate materials" });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  expect(mocks.generate.mock.calls.map(([context]) => context)).toEqual(supportedStrategies.map(strategy => ({
    lessonNumber: 8, strategy, classroomContext: "", classId: user.classId, assignmentId: user.assignmentId,
  })));
  for (const strategy of supportedStrategies) {
    fireEvent.change(screen.getByRole("textbox", { name: `Draft for ${strategy}` }), { target: { value: `Teacher edit: ${strategy}` } });
  }
  fireEvent.click(screen.getByRole("radio", { name: "Text + Image" }));
  fireEvent.click(screen.getByRole("radio", { name: "Video" }));
  fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
  expect(screen.queryByRole("radio", { name: "Slides" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Content generation/ }));
  fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
  for (const strategy of supportedStrategies) {
    expect(screen.getByRole("textbox", { name: `Draft for ${strategy}` })).toHaveValue(`Teacher edit: ${strategy}`);
  }
  expect(mocks.mount).toHaveBeenCalledTimes(3);
  expect(mocks.unmount).not.toHaveBeenCalled();
  expect(mocks.generate).toHaveBeenCalledTimes(3);
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

it("blocks the whole Slides batch when an unsupported selected strategy would otherwise be silently dropped", async () => {
  seedDraft({ selectedStrategies: ["analogy", "engaged critiquing"], materialFormat: "slides" });
  render(<TeacherView user={user} />);
  const generate = await ready();
  expect(screen.getByRole("status")).toHaveTextContent("Slides do not yet support Engaged Critiquing");
  expect(generate).toBeDisabled();
  fireEvent.click(generate);
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(postCalls()).toHaveLength(0);
  fireEvent.click(screen.getByRole("radio", { name: "Text + Image" }));
  expect(generate).toBeEnabled();
  expect(postCalls()).toHaveLength(0);
});

it("routes explicit Text + Image generation through the existing material APIs with all selected strategies", async () => {
  seedDraft({ selectedStrategies: ["analogy", "cognitive conflict"] });
  render(<TeacherView user={user} />);
  const generate = await ready();
  fireEvent.click(generate);
  await waitFor(() => expect(postCalls("/api/engagement-image")).toHaveLength(2));
  expect(postCalls("/api/engagement-content")).toHaveLength(1);
  expect(JSON.parse(postCalls("/api/engagement-content")[0][1].body)).toMatchObject({
    lessonNumber: 8, selectedStrategies: ["analogy", "cognitive conflict"], classId: user.classId, assignmentId: user.assignmentId,
  });
  expect(postCalls("/api/engagement-video")).toHaveLength(0);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("preserves teacher-supplied experience context for this task and sends it for text and video generation", async () => {
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
  for (const format of ["Text + Image", "Video"]) {
    fireEvent.click(screen.getByRole("radio", { name: format }));
    const before = postCalls("/api/engagement-content").length;
    const generate = screen.getByRole("button", { name: "Generate materials" });
    await waitFor(() => expect(generate).toBeEnabled());
    fireEvent.click(generate);
    await waitFor(() => expect(postCalls("/api/engagement-content")).toHaveLength(before + 1));
    expect(JSON.parse(postCalls("/api/engagement-content").at(-1)![1].body).classroomContext).toBe(context);
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate materials" })).toBeEnabled());
  }
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
  for (const format of ["Slides", "Text + Image", "Video"]) fireEvent.click(screen.getByRole("radio", { name: format }));
  expect(postCalls("/api/engagement-video")).toHaveLength(1);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("publishes Text + Image without attaching a video retained from another format", async () => {
  seedDraft({
    content: [{ id: "publish-activity", type: "phenomenon", title: "Shared activity", body: "Compare the observations.", strategy: "analogy" }],
    images: { "publish-activity": { status: "ready", url: "https://example.test/publish.png" } },
    videos: { "publish-activity": { status: "ready", url: "https://example.test/publish.mp4" } },
    selectedForPublish: ["publish-activity"],
  });
  render(<TeacherView user={user} />);
  await ready();
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


it("shares the current classroom context with every Slides editor", async () => {
  seedDraft({ selectedStrategies: supportedStrategies, classroomContext: "Grade 8; familiar with playground games." });
  render(<TeacherView user={user} />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "Slides" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Classroom context (optional)" }), { target: { value: "Grade 9; students describe riding bicycles." } });
  const generate = screen.getByRole("button", { name: "Generate materials" });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  for (const [context] of mocks.generate.mock.calls) expect(context.classroomContext).toBe("Grade 9; students describe riding bicycles.");
  expect(mocks.generate).toHaveBeenCalledTimes(3);
});

it("uses new content identities when regenerating a material with the same title", async () => {
  seedDraft();
  render(<TeacherView user={user} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Generate materials" }));
  await waitFor(() => expect(postCalls("/api/engagement-image")).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate materials" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Generate materials" }));
  await waitFor(() => expect(postCalls("/api/engagement-image")).toHaveLength(2));
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
  const download = screen.getByRole("button", { name: "Download material (HTML)" });
  await waitFor(() => expect(download).toBeEnabled());
  fireEvent.click(download);
  await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining(item), "https://example.test/current.png"));
});


it("lets a teacher manually generate draft materials before any student response without inventing a recommendation", async () => {
  seedDraft({ currentStep: 2, selectedStrategies: [] });
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
      { student_id: "student-a", student_name: "Student A", answers: { L8_Q1: "C", L8_Q2: "C", L8_Q3: "A", L8_Q4: "A" } },
      { student_id: "student-b", student_name: "Student B", answers: { L8_Q1: "C", L8_Q2: "C", L8_Q3: "A", L8_Q4: "A" } },
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
