// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
      : input.startsWith("/api/material-gallery") ? { items: [] } : {},
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("hides both synthetic-answer controls and their description for independent classes", async () => {
  render(<TeacherView user={{ ...teacher, classId: "ea-class-native" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  fireEvent.click(stepTab(/Strategy/));
  expect(screen.queryByRole("button", { name: "Auto-answer 5 test students" })).toBeNull();
  expect(screen.queryByText(/Generates stable random answers/)).toBeNull();
});

it("hides synthetic-answer controls and their description for GENIUS assignments", async () => {
  render(<TeacherView user={{ ...teacher, classId: "genius-class" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  fireEvent.click(stepTab(/Strategy/));
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
  if (!initiallyFails) {
    await screen.findByText("Avery");
    await waitFor(() => expect((screen.getByRole("button", { name: "Analyze 1 students" }) as HTMLButtonElement).disabled).toBe(false));
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  }
  expect((await screen.findByRole("alert")).textContent).toContain("Responses temporarily unavailable. Select Refresh to try again.");
  if (initiallyFails) expect(screen.queryByText(/students have answered so far/)).toBeNull();
  else {
    expect(screen.getByText("Avery")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Showing previously loaded responses.");
    expect((screen.getByRole("button", { name: "Analyze 1 students" }) as HTMLButtonElement).disabled).toBe(true);
  }
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText("Avery")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Analyze 1 students" }) as HTMLButtonElement).disabled).toBe(false);
});

it("shows the v8.3 header and four teacher steps, with the dashboard as its own view (#172, #182)", async () => {
  render(<TeacherView user={{ ...teacher, classId: "ea-class-native", className: "Physics · Period 3" }} shell={{ taskTitle: "Collisions" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  const steps = within(screen.getByRole("navigation", { name: "Teacher steps" })).getAllByRole("button");
  expect(steps.map(step => step.textContent)).toEqual([
    "1AssessmentNot started", "2StrategyNot chosen yet", "3Engagement materialsNot started", "4Questions & discussionClass results",
  ]);
  const header = within(screen.getByRole("banner"));
  expect(header.getByText("Physics · Period 3")).toBeTruthy();
  expect(header.getByText("Collisions")).toBeTruthy();
  expect(header.getByRole("button", { name: "Gallery" })).toBeTruthy();
  expect((header.getByRole("button", { name: "Class profile" }) as HTMLButtonElement).disabled).toBe(true);
  expect((header.getByRole("button", { name: "Ask EngageAgent" }) as HTMLButtonElement).disabled).toBe(true);
  // Inside GENIUS there is no shell to link back to or sign out of.
  expect(header.queryByRole("link", { name: "EngageAgent" })).toBeNull();
  expect(header.queryByRole("button", { name: "Sign out of EngageAgent" })).toBeNull();

  fireEvent.click(header.getByRole("button", { name: "Dashboard" }));
  expect(await screen.findByText("Assignment summary")).toBeTruthy();
  expect(within(screen.getByRole("navigation", { name: "Teacher steps" })).queryByRole("button", { current: "step" })).toBeNull();
  expect(screen.queryByText("Back to workflow")).toBeNull();
  fireEvent.click(header.getByRole("button", { name: "Gallery" }));
  expect(await screen.findByRole("heading", { name: "Engagement materials" })).toBeTruthy();
  expect(screen.queryByText("Assignment summary")).toBeNull();
  expect(stepTab(/Engagement materials/).getAttribute("aria-current")).toBe("step");
  expect(await screen.findByRole("textbox", { name: "Search shared materials" })).toBeTruthy();
  // Step 4 is the questions page; choosing a step leaves the dashboard.
  fireEvent.click(stepTab(/Questions & discussion/));
  expect(await screen.findByRole("heading", { name: "Questions & discussion" })).toBeTruthy();
  expect(screen.queryByText("Assignment summary")).toBeNull();
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
  fireEvent.click(stepTab(/Engagement materials/));
  expect(await screen.findByRole("button", { name: "Read slides" })).toBeTruthy();
  fireEvent.click(stepTab(/Questions & discussion/));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/question-analysis"))).toBe(true));
  expect(screen.queryByText("Available after materials are sent in Step 3")).toBeNull();
});
