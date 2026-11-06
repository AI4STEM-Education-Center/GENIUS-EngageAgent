// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import TeacherView from "@/app/components/TeacherView";
import type { UserContext } from "@/lib/auth";

const stepTab = (name: RegExp) => within(screen.getByRole("navigation", { name: "Teacher steps" })).getByRole("button", { name });

const teacher: UserContext = {
  geniusId: "teacher", userId: "teacher", name: "Test teacher",
  email: null, role: "teacher", assignmentId: "assignment",
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => ({
    ok: true,
    json: async () => input.startsWith("/api/lessons/")
      ? { lesson_number: Number(input.split("/").pop()), lesson_title: `Lesson ${input.split("/").pop()}`, quiz_items: [], learning_objective: "Test objective" }
      : input.startsWith("/api/material-gallery") ? { items: [] }
        : input.startsWith("/api/slides?") ? { lessons: [] } : {},
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("hides both synthetic-answer controls and their description for independent classes", async () => {
  render(<TeacherView user={{ ...teacher, classId: "ea-class-native" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  fireEvent.click(stepTab(/Strategy recommendations/));
  expect(screen.queryByRole("button", { name: "Auto-answer 5 test students" })).toBeNull();
  expect(screen.queryByText(/Generates stable random answers/)).toBeNull();
});

it("hides synthetic-answer controls and their description for GENIUS assignments", async () => {
  render(<TeacherView user={{ ...teacher, classId: "genius-class" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  fireEvent.click(stepTab(/Strategy recommendations/));
  expect(screen.queryByRole("button", { name: "Auto-answer 5 test students" })).toBeNull();
  expect(screen.queryByText(/Generates stable random answers/)).toBeNull();
});

it.each([true, false])("shows response loading failures without claiming zero submissions (initial failure: %s)", async initiallyFails => {
  const scopedTeacher = { ...teacher, classId: "ea-class-responses" };
  localStorage.setItem(`engage-agent:draft:v3:${scopedTeacher.classId}:${scopedTeacher.assignmentId}`, JSON.stringify({
    version: 2, classId: scopedTeacher.classId, assignmentId: scopedTeacher.assignmentId,
    lessonNumber: 8, currentStep: 2, plan: null, selectedStrategies: [],
    annotationDecision: null, annotationReason: "", annotationStatus: "idle", content: [],
  }));
  const fetchMock = vi.mocked(fetch);
  const originalFetch = fetchMock.getMockImplementation()!;
  let fail = initiallyFails;
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith("/api/quiz-status")) return { ok: true, json: async () => ({ quizStatus: { lesson_number: 8, status: "published" } }) } as Response;
    if (url.startsWith("/api/student-answers")) return {
      ok: !fail,
      json: async () => fail ? { error: "Responses temporarily unavailable." } : { answers: [{ student_id: "student-1", student_name: "Avery", class_id: scopedTeacher.classId, assignment_id: scopedTeacher.assignmentId, lesson_number: 8, answers: { L8_Q1: "C" } }] },
    } as Response;
    return originalFetch(input, init);
  });
  render(<TeacherView user={scopedTeacher} />);
  const analyze = () => screen.getByRole("button", { name: "Analyze 1 response and recommend" }) as HTMLButtonElement;
  if (!initiallyFails) {
    await waitFor(() => expect(analyze().disabled).toBe(false));
    expect(stepTab(/Strategy recommendations/).textContent).toContain("1 response in");
    fail = true;
    // Polling refetches the answers; the Strategy tab click forces a reload here.
    fireEvent.click(stepTab(/Pre-knowledge assessment/));
    fireEvent.click(stepTab(/Strategy recommendations/));
  }
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Responses temporarily unavailable.");
  // A failed load is not "0 submitted".
  expect(screen.queryByText(/submitted/)).toBeNull();
  if (initiallyFails) expect(screen.queryByRole("button", { name: /^Analyze 1 response/ })).toBeNull();
  else {
    expect(alert.textContent).toContain("Showing previously loaded responses.");
    expect(analyze().disabled).toBe(true);
  }
  fail = false;
  fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(analyze().disabled).toBe(false);
});

it("shows the v8.3 header and four teacher steps, with the dashboard as its own view (#172, #182)", async () => {
  render(<TeacherView user={{ ...teacher, classId: "ea-class-native", className: "Physics · Period 3" }} shell={{ taskTitle: "Collisions" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  expect(screen.getByRole("heading", { name: "Pre-knowledge assessment" })).toBeTruthy();
  const steps = within(screen.getByRole("navigation", { name: "Teacher steps" })).getAllByRole("button");
  expect(steps.map(step => step.textContent)).toEqual([
    "1Pre-knowledge assessmentNot started", "2Strategy recommendationsWaiting for responses", "3Material GenerationNot started", "4Questions & discussionClass results",
  ]);
  const header = within(screen.getByRole("banner"));
  expect(header.getByText("Physics · Period 3")).toBeTruthy();
  expect(header.getByText("Collisions")).toBeTruthy();
  expect(header.getByRole("button", { name: "Gallery" })).toBeTruthy();
  expect((header.getByRole("button", { name: "Class profile" }) as HTMLButtonElement).disabled).toBe(false);
  // Ask EngageAgent is the floating icon, not a header action (#198).
  expect(header.queryByRole("button", { name: "Ask EngageAgent" })).toBeNull();
  // Inside GENIUS there is no shell to link back to or sign out of.
  expect(header.queryByRole("link", { name: "EngageAgent" })).toBeNull();
  expect(header.queryByRole("button", { name: "Sign out of EngageAgent" })).toBeNull();

  fireEvent.click(header.getByRole("button", { name: "Dashboard" }));
  expect(await screen.findByText("Assignment summary")).toBeTruthy();
  expect(within(screen.getByRole("navigation", { name: "Teacher steps" })).queryByRole("button", { current: "step" })).toBeNull();
  expect(screen.queryByText("Back to workflow")).toBeNull();
  fireEvent.click(header.getByRole("button", { name: "Gallery" }));
  expect(await screen.findByRole("heading", { name: /^Gallery$/ })).toBeTruthy();
  expect(screen.queryByText("Assignment summary")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Teacher steps" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Material Generation" })).toBeNull();
  expect(await screen.findByRole("textbox", { name: "Search shared materials" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to task" }));
  // Step 4 is the questions page; choosing a step leaves the dashboard.
  fireEvent.click(stepTab(/Questions & discussion/));
  expect(await screen.findByRole("heading", { name: "Questions & discussion" })).toBeTruthy();
  expect(screen.queryByText("Assignment summary")).toBeNull();
});

it("keeps Gallery out of Step 3 and opens a separate editor from a direct Gallery entry", async () => {
  const view = render(<TeacherView user={{ ...teacher, classId: "ea-class-native" }} initialStep={3} />);
  expect(await screen.findByRole("heading", { name: "Material Generation" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Materials Gallery" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open Gallery" })).toBeNull();
  view.unmount();
  render(<TeacherView user={{ ...teacher, classId: "ea-class-native" }} initialView="gallery" />);
  expect(await screen.findByRole("region", { name: "Gallery workspace" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Teacher steps" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Generate new slide deck" })).toBeNull();
});

it("leaves out the top menu inside the GENIUS iframe, which has its own (#172)", async () => {
  const top = vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
  onTestFinished(() => top.mockRestore());
  render(<TeacherView user={{ ...teacher, classId: "ea-class-native" }} shell={{ taskTitle: "Collisions" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  expect(screen.queryByRole("banner")).toBeNull();
  fireEvent.click(stepTab(/Questions & discussion/));
  expect(await screen.findByRole("heading", { name: "Questions & discussion" })).toBeTruthy();
  expect(screen.queryByRole("banner")).toBeNull();
  expect(stepTab(/Questions & discussion/).getAttribute("aria-current")).toBe("step");
});

it("opens Step 4 when asked to, even with a saved draft on another step", async () => {
  const scopedTeacher = { ...teacher, classId: "ea-class-step" };
  localStorage.setItem(`engage-agent:draft:v3:${scopedTeacher.classId}:${scopedTeacher.assignmentId}`, JSON.stringify({
    version: 2, classId: scopedTeacher.classId, assignmentId: scopedTeacher.assignmentId,
    lessonNumber: 1, currentStep: 2, plan: null, selectedStrategies: [], annotationDecision: null, annotationReason: "", annotationStatus: "idle", content: [],
  }));
  render(<TeacherView user={scopedTeacher} initialStep={4} />);
  await waitFor(() => expect(stepTab(/Questions & discussion/).getAttribute("aria-current")).toBe("step"));
  expect(await screen.findByRole("heading", { name: "Questions & discussion" })).toBeTruthy();
  // Questions come from Content Review, so they wait for materials.
  expect(screen.getByText("Available after materials are sent in Step 3")).toBeTruthy();
});

it("opens the assignment dashboard for old dashboard links", async () => {
  render(<TeacherView user={{ ...teacher, classId: "ea-class-dash" }} initialView="dashboard" />);
  expect(await screen.findByText("Assignment summary")).toBeTruthy();
});

it.each([false, true])("does not restore an independent Gallery video into Step 3 on reload (existing workflow: %s)", async existingWorkflow => {
  const scopedTeacher = { ...teacher, classId: "ea-class-gallery-publication" };
  const draftKey = `engage-agent:draft:v3:${scopedTeacher.classId}:${scopedTeacher.assignmentId}`;
  const expectedStep = existingWorkflow ? 2 : 1;
  const expectedStrategies = existingWorkflow ? ["analogy"] : [];
  if (existingWorkflow) localStorage.setItem(draftKey, JSON.stringify({
    version: 2, classId: scopedTeacher.classId, assignmentId: scopedTeacher.assignmentId,
    lessonNumber: 8, currentStep: 2, materialFormat: "video", plan: null, selectedStrategies: expectedStrategies,
    annotationDecision: null, annotationReason: "", annotationStatus: "idle", content: [],
  }));
  const publication = {
    id: "gallery-copy-11111111-1111-4111-8111-111111111111", type: "Video", title: "Independent Gallery video",
    body: "Observe the ball during contact.", strategy: "cognitive conflict", lessonNumber: 3,
    galleryWorkspace: true,
    gallerySource: { templateId: "shared-ball", title: "Shared ball", revision: 2, mode: "adapt" },
    media: { video: "https://media.test/gallery-video.mp4", image: "https://media.test/gallery-image.png" },
  };
  const fetchMock = vi.mocked(fetch); const defaultFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => String(input).startsWith("/api/content-publish")
    ? { ok: true, json: async () => ({ items: [{ content_item_id: publication.id, content_json: JSON.stringify(publication) }] }) } as Response
    : defaultFetch(input, init));
  const assertWorkflowUnchanged = async () => {
    await waitFor(() => expect(stepTab(/Material Generation/).textContent).toContain("Sent to students"));
    expect(stepTab(existingWorkflow ? /Strategy recommendations/ : /Pre-knowledge assessment/).getAttribute("aria-current")).toBe("step");
    expect(screen.queryByRole("heading", { name: publication.title })).toBeNull();
    await waitFor(() => {
      const draft = JSON.parse(localStorage.getItem(draftKey)!);
      expect(draft).toMatchObject({ currentStep: expectedStep, selectedStrategies: expectedStrategies, content: [], images: {}, videos: {},
        selectedForPublish: [], publishedContentIds: [], lessonNumber: existingWorkflow ? 8 : null, materialFormat: existingWorkflow ? "video" : "slides" });
    });
  };
  const view = render(<TeacherView user={scopedTeacher} />);
  await assertWorkflowUnchanged();
  view.unmount(); fetchMock.mockClear();
  render(<TeacherView user={scopedTeacher} />);
  await assertWorkflowUnchanged();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/content-publish"))).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/media"))).toBe(false);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("still restores legacy Step 3 publications while excluding an independent Gallery video in the same task", async () => {
  const scopedTeacher = { ...teacher, classId: "ea-class-mixed-publications" };
  const draftKey = `engage-agent:draft:v3:${scopedTeacher.classId}:${scopedTeacher.assignmentId}`;
  const legacy = { id: "legacy-video", type: "Video", title: "Existing task activity", body: "Keep the original task material.", strategy: "analogy" };
  const gallery = { id: "gallery-copy-11111111-1111-4111-8111-111111111111", type: "Video", title: "Separate Gallery activity", body: "This belongs only to Gallery.", strategy: "cognitive conflict", galleryWorkspace: true };
  const fetchMock = vi.mocked(fetch); const defaultFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => String(input).startsWith("/api/content-publish")
    ? { ok: true, json: async () => ({ items: [legacy, gallery].map(item => ({ content_item_id: item.id, content_json: JSON.stringify(item) })) }) } as Response
    : defaultFetch(input, init));
  render(<TeacherView user={scopedTeacher} />);
  await waitFor(() => expect(stepTab(/Material Generation/).getAttribute("aria-current")).toBe("step"));
  await waitFor(() => {
    const draft = JSON.parse(localStorage.getItem(draftKey)!);
    expect(draft.currentStep).toBe(3); expect(draft.selectedStrategies).toEqual(["analogy"]);
    expect(draft.content).toEqual([legacy]);
    expect(draft.publishedContentIds).toEqual([legacy.id]); expect(draft.selectedForPublish).toEqual([legacy.id]);
  });
  expect(screen.queryByRole("heading", { name: gallery.title })).toBeNull();
});

it("unlocks discussion questions after slides are published without a video", async () => {
  const fetchMock = vi.mocked(fetch);
  const originalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith("/api/content-publish")) return { ok: true, json: async () => ({ items: [{
      content_item_id: "published-slides", content_json: JSON.stringify({
        id: "published-slides", type: "Slides", title: "Published lesson slides", body: "", strategy: "analogy",
        slides: { publicationId: "4e96360b-17a4-4a54-84da-df0c5d2ef012", lessonNumber: 1, slideCount: 6 },
      }),
    }] }) } as Response;
    if (url.startsWith("/api/question-analysis")) return { ok: true, json: async () => ({ lessonNumber: 1, total: 0, students: 0, analysisError: null, groups: [] }) } as Response;
    return originalFetch(input, init);
  });
  render(<TeacherView user={{ ...teacher, classId: "ea-class-slides" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  fireEvent.click(stepTab(/Material Generation/));
  expect(await screen.findByRole("button", { name: "Read slides" })).toBeTruthy();
  fireEvent.click(stepTab(/Questions & discussion/));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/question-analysis"))).toBe(true));
  expect(screen.queryByText("Available after materials are sent in Step 3")).toBeNull();
});
