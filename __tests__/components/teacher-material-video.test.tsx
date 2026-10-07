// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import type { ContentItem, ImageState, Plan } from "@/lib/types";
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
const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const reply = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => data, text: async () => JSON.stringify(data),
}) as Response;

function seedDraft(content: ContentItem[] = [], images: Record<string, ImageState> = {}) {
  localStorage.setItem(`engage-agent:draft:v3:${teacher.classId}:${teacher.assignmentId}`, JSON.stringify({
    version: 2, classId: teacher.classId, assignmentId: teacher.assignmentId,
    lessonNumber: 3, currentStep: 3, materialFormat: "video", plan,
    selectedStrategies: ["analogy"], annotationDecision: null, annotationReason: "", annotationStatus: "idle",
    content, images, videos: {}, selectedForPublish: [], publishedContentIds: [],
  }));
}

function installApi(imageResponse: () => Promise<Response> = async () => reply({ url: sourceImage })) {
  fetchMock.mockImplementation(async (path) => {
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
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate materials" }) as HTMLButtonElement).disabled).toBe(false));
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
  fireEvent.click(screen.getByRole("button", { name: "Generate materials" }));

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
  fireEvent.click(screen.getByRole("button", { name: "Generate materials" }));

  await screen.findByText("Image provider unavailable.");
  expect(callsTo("/api/engagement-content")).toHaveLength(1);
  expect(callsTo("/api/engagement-image")).toHaveLength(2);
  expect(callsTo("/api/engagement-video")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /Generate video/ })).toBeNull();
  expect((screen.getByRole("button", { name: "Generate materials" }) as HTMLButtonElement).disabled).toBe(false);
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
