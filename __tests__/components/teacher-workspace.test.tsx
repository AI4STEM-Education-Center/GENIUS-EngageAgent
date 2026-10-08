// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeacherView from "@/app/components/TeacherView";
import type { UserContext } from "@/lib/auth";

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
  fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
  expect(screen.queryByRole("button", { name: "Auto-answer 5 test students" })).toBeNull();
  expect(screen.queryByText(/Generates stable random answers/)).toBeNull();
});

it("preserves the existing synthetic-answer controls for legacy embedded assignments", async () => {
  render(<TeacherView user={{ ...teacher, classId: "genius-class" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
  expect(screen.getByRole("button", { name: "Auto-answer 5 test students" })).toBeTruthy();
  expect(screen.getByText(/Generates stable random answers/)).toBeTruthy();
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
      json: async () => fail ? { error: "Responses temporarily unavailable." } : { answers: [{ student_id: "student-1", student_name: "Avery", lesson_number: 8, answers: { L8_Q1: "C" } }] },
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
