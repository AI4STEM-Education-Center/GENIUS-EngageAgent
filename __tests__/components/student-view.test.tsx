// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import type { ActivityStatus } from "@/lib/activity-status";
import type { UserContext } from "@/lib/auth";
import type { StudentStepId } from "@/lib/student-progress";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), completed: vi.fn(), reopened: vi.fn() }));
vi.mock("@/lib/genius-notify", () => ({ notifyTaskCompleted: mocks.completed, notifyTaskReopened: mocks.reopened }));
vi.mock("@/app/components/StudentQuizView", () => ({ default: () => <section aria-label="Quiz content" /> }));
vi.mock("@/app/components/StudentContentReviewView", () => ({ default: ({ ratingUnlocked }: { ratingUnlocked: boolean }) =>
  <section aria-label="Materials content" data-rating-unlocked={ratingUnlocked} /> }));
import StudentView from "@/app/components/StudentView";

const student: UserContext = {
  geniusId: "student", userId: "student", name: "Student", email: null,
  role: "student", classId: "ea-class-one", assignmentId: "ea-task-one",
};
let statuses: Record<StudentStepId, ActivityStatus>;
beforeEach(() => {
  vi.clearAllMocks();
  statuses = { assessment: "locked", "content-review": "locked", "content-rating": "locked" };
  mocks.fetch.mockImplementation(async () => {
    const activities = Object.entries(statuses).map(([id, status]) => ({ id, status }));
    return { ok: true, json: async () => ({ activities }) };
  });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const tab = (name: RegExp) => within(screen.getByRole("navigation", { name: "Student steps" })).getByRole("button", { name }) as HTMLButtonElement;
const assessment = () => tab(/Get ready for the lesson/);
const materials = () => tab(/Explore and ask/);
const expectStatus = async (button: () => HTMLButtonElement, status: string) => {
  await waitFor(() => expect(button().textContent).toContain(status));
};
const expectActive = async (button: () => HTMLButtonElement) => {
  await waitFor(() => expect(button().getAttribute("aria-current")).toBe("step"));
};
const refresh = () => fireEvent.focus(window);
// The board and the report (#182) refresh alongside; these tests count the status polls.
const statusCalls = () => mocks.fetch.mock.calls.filter(([url]) => String(url).startsWith("/api/activity-status"));

it("opens published material without a quiz and keeps the unpublished assessment locked", async () => {
  statuses["content-review"] = "available";
  render(<StudentView user={student} />);
  await expectActive(materials);
  expect(materials().textContent).toContain("In progress");
  expect(assessment().disabled).toBe(true);
  expect(assessment().textContent).toContain("Not available yet");
  expect(screen.getByRole("region", { name: "Materials content" }).parentElement?.className).not.toContain("hidden");
  expect(screen.getByRole("region", { name: "Quiz content" }).parentElement?.className).toBe("hidden");
  expect(mocks.completed).not.toHaveBeenCalled();
});

it("keeps normal quiz and material navigation with two available activities", async () => {
  statuses = { assessment: "available", "content-review": "available", "content-rating": "locked" };
  render(<StudentView user={student} />);
  await waitFor(() => expect(materials().disabled).toBe(false));
  await expectActive(assessment);
  expect(assessment().disabled).toBe(false);
  expect(materials().disabled).toBe(false);
  fireEvent.click(materials());
  await expectActive(materials);
  refresh();
  await waitFor(() => expect(statusCalls()).toHaveLength(2));
  await expectActive(materials);
  fireEvent.click(assessment());
  refresh();
  await waitFor(() => expect(statusCalls()).toHaveLength(3));
  await expectActive(assessment);
});

it("does not bounce away from a completed quiz the student deliberately revisits", async () => {
  statuses = { assessment: "completed", "content-review": "available", "content-rating": "locked" };
  render(<StudentView user={student} />);
  await expectActive(materials);
  expect(assessment().textContent).toContain("Completed");
  fireEvent.click(assessment());
  await expectActive(assessment);
  refresh();
  await waitFor(() => expect(statusCalls()).toHaveLength(2));
  await expectActive(assessment);
});

it("opens materials published after the student entered a task with no available activity", async () => {
  render(<StudentView user={student} />);
  await waitFor(() => expect(statusCalls()).toHaveLength(1));
  expect(materials().disabled).toBe(true);
  statuses["content-review"] = "available";
  refresh();
  await expectActive(materials);
  expect(materials().textContent).toContain("In progress");
  expect(assessment().disabled).toBe(true);
});

it("does not interrupt an available quiz when the teacher publishes material", async () => {
  statuses.assessment = "available";
  render(<StudentView user={student} />);
  await waitFor(() => expect(assessment().disabled).toBe(false));
  expect(materials().disabled).toBe(true);
  statuses["content-review"] = "available";
  refresh();
  await waitFor(() => expect(materials().disabled).toBe(false));
  await expectActive(assessment);
  expect(materials().disabled).toBe(false);
});

it("keeps every tab locked while nothing is available", async () => {
  render(<StudentView user={student} />);
  await waitFor(() => expect(statusCalls()).toHaveLength(1));
  expect(assessment().disabled).toBe(true);
  expect(assessment().textContent).toContain("Not available yet");
  expect(materials().disabled).toBe(true);
  expect(materials().textContent).toContain("Not available yet");
  expect(mocks.completed).not.toHaveBeenCalled();
});

it("shows Class questions and My quiz report as locked tabs until they are built (#182)", async () => {
  statuses = { assessment: "completed", "content-review": "completed", "content-rating": "completed" };
  render(<StudentView user={student} />);
  await expectStatus(materials, "Completed");
  expect(tab(/Class questions/).disabled).toBe(true);
  expect(tab(/Class questions/).textContent).toContain("Your teacher will share these");
  expect(tab(/My quiz report/).disabled).toBe(true);
  expect(tab(/My quiz report/).textContent).toContain("After the lesson");
});

it("shows the student's name in the shared header and links back to the class when opened from the workspace", async () => {
  render(<StudentView user={{ ...student, className: "Physics · Period 3" }}
    shell={{ homeHref: "/student/classes", classHref: "/student/classes?classId=ea-class-one", canSignOut: true }} />);
  const header = within(screen.getByRole("banner"));
  expect(header.getByText("Student")).toBeTruthy();
  expect(header.getByRole("link", { name: "Physics · Period 3" }).getAttribute("href")).toBe("/student/classes?classId=ea-class-one");
  expect(header.getByRole("button", { name: "Sign out of EngageAgent" })).toBeTruthy();
});

it("leaves out the top menu inside the GENIUS iframe, which has its own (#172)", async () => {
  const top = vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
  onTestFinished(() => top.mockRestore());
  statuses["content-review"] = "available";
  render(<StudentView user={{ ...student, className: "Physics · Period 3" }} shell={{ taskTitle: "Collisions" }} />);
  await expectActive(materials);
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.getByRole("navigation", { name: "Student steps" })).toBeTruthy();
});

it("completes the sole material activity only after questions and all ratings are complete", async () => {
  statuses = { assessment: "locked", "content-review": "completed", "content-rating": "available" };
  render(<StudentView user={student} />);
  await expectActive(materials);
  expect(materials().textContent).toContain("In progress");
  expect(screen.getByRole("region", { name: "Materials content" }).getAttribute("data-rating-unlocked")).toBe("true");
  expect(mocks.completed).not.toHaveBeenCalled();
  statuses["content-rating"] = "completed";
  refresh();
  await expectStatus(materials, "Completed");
  expect(assessment().disabled).toBe(true);
  expect(assessment().textContent).toContain("Not available yet");
  expect(mocks.completed).toHaveBeenCalledExactlyOnceWith(student.classId, student.assignmentId, student.geniusId);
  refresh();
  await waitFor(() => expect(statusCalls()).toHaveLength(3));
  expect(mocks.completed).toHaveBeenCalledOnce();
});

it("opens an already completed material-only task", async () => {
  statuses = { assessment: "locked", "content-review": "completed", "content-rating": "completed" };
  render(<StudentView user={student} />);
  await expectActive(materials);
  expect(materials().textContent).toContain("Completed");
  expect(assessment().disabled).toBe(true);
});

it("reopens a completed material task when more material arrives and notifies again after rating it", async () => {
  statuses = { assessment: "completed", "content-review": "completed", "content-rating": "completed" };
  render(<StudentView user={student} />);
  await expectStatus(materials, "Completed");
  expect(assessment().textContent).toContain("Completed");
  expect(mocks.completed).toHaveBeenCalledOnce();
  statuses["content-rating"] = "available";
  refresh();
  await expectStatus(materials, "In progress");
  expect(mocks.reopened).toHaveBeenCalledExactlyOnceWith(student.classId, student.assignmentId, student.geniusId);
  statuses["content-rating"] = "completed";
  refresh();
  await expectStatus(materials, "Completed");
  expect(mocks.completed).toHaveBeenCalledTimes(2);
});

it("opens Class questions and My quiz report once the teacher shares them (#182)", async () => {
  statuses = { assessment: "completed", "content-review": "available", "content-rating": "locked" };
  let board: unknown = null;
  let report: unknown = null;
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/question-board")) return { ok: true, json: async () => ({ board }) };
    if (url.startsWith("/api/quiz-report")) return { ok: true, json: async () => ({ release: report ? {} : null, report }) };
    return { ok: true, json: async () => ({ activities: Object.entries(statuses).map(([id, status]) => ({ id, status })) }) };
  });
  render(<StudentView user={student} />);
  const questions = () => tab(/Class questions/);
  const myReport = () => tab(/My quiz report/);
  await expectActive(materials);
  expect(questions().disabled).toBe(true);
  expect(myReport().disabled).toBe(true);
  expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("/api/quiz-report?") && String(url).includes("studentId=student"))).toBe(true);

  board = { publishedAt: "now", questions: [{ id: "1".repeat(16), text: "Does the post bend?", theme: "Forces we can't see" }] };
  report = { lessonNumber: 3, lessonTitle: "Deformation", correct: 0, total: 1, items: [{ number: 1, stem: "Did the plate deform?", answer: null, correctAnswer: { key: "D", text: "Yes." }, isCorrect: false, confidence: null }] };
  refresh();
  await expectStatus(questions, "1 question");
  await expectStatus(myReport, "Available");
  fireEvent.click(questions());
  expect(await screen.findByText("Questions we’ll explore together")).toBeTruthy();
  expect(screen.getByText("Does the post bend?")).toBeTruthy();
  // A student reading the board stays there through status polls.
  refresh();
  await waitFor(() => expect(statusCalls().length).toBeGreaterThanOrEqual(3));
  await expectActive(questions);

  fireEvent.click(myReport());
  expect(await screen.findByText("0 of 1 correct")).toBeTruthy();
  expect(screen.getByText("No answer")).toBeTruthy();

  fireEvent.click(questions());
  board = null;
  refresh();
  await expectActive(assessment);
  await waitFor(() => expect(questions().disabled).toBe(true));
});
