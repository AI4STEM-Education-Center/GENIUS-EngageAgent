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
      : {},
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
  const analyze = () => screen.getByRole("button", { name: "Analyze 1 response and recommend" }) as HTMLButtonElement;
  if (!initiallyFails) {
    await waitFor(() => expect(analyze().disabled).toBe(false));
    expect(stepTab(/Strategy/).textContent).toContain("1 response in");
    fail = true;
    // Polling refetches the answers; the Strategy tab click forces a reload here.
    fireEvent.click(stepTab(/Assessment/));
    fireEvent.click(stepTab(/Strategy/));
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

it("shows the v8.3 header and four teacher steps, with the dashboard as Step 4 (#172)", async () => {
  render(<TeacherView user={{ ...teacher, classId: "ea-class-native", className: "Physics · Period 3" }} shell={{ taskTitle: "Collisions" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  const steps = within(screen.getByRole("navigation", { name: "Teacher steps" })).getAllByRole("button");
  expect(steps.map(step => step.textContent)).toEqual([
    "1AssessmentNot started", "2StrategyWaiting for responses", "3Engagement materialsNot started", "4Questions & discussionClass results",
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
  expect(stepTab(/Questions & discussion/).getAttribute("aria-current")).toBe("step");
  expect(screen.queryByText("Back to workflow")).toBeNull();
});

it("leaves out the top menu inside the GENIUS iframe, which has its own (#172)", async () => {
  const top = vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
  onTestFinished(() => top.mockRestore());
  render(<TeacherView user={{ ...teacher, classId: "ea-class-native" }} shell={{ taskTitle: "Collisions" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  expect(screen.queryByRole("banner")).toBeNull();
  fireEvent.click(stepTab(/Questions & discussion/));
  expect(await screen.findByText("Assignment summary")).toBeTruthy();
});

it("opens Step 4 when asked to, even with a saved draft on another step", async () => {
  const scopedTeacher = { ...teacher, classId: "ea-class-step" };
  localStorage.setItem(`engage-agent:draft:v3:${scopedTeacher.classId}:${scopedTeacher.assignmentId}`, JSON.stringify({
    version: 2, classId: scopedTeacher.classId, assignmentId: scopedTeacher.assignmentId,
    lessonNumber: 1, currentStep: 2, plan: null, selectedStrategies: [], annotationDecision: null, annotationReason: "", annotationStatus: "idle", content: [],
  }));
  render(<TeacherView user={scopedTeacher} initialStep={4} />);
  await waitFor(() => expect(stepTab(/Questions & discussion/).getAttribute("aria-current")).toBe("step"));
  expect(await screen.findByText("Assignment summary")).toBeTruthy();
});
