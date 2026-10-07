// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActivityStatus } from "@/lib/activity-status";
import type { UserContext } from "@/lib/auth";
import type { StudentStepId } from "@/lib/student-progress";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), completed: vi.fn() }));
vi.mock("@/lib/genius-notify", () => ({ notifyTaskCompleted: mocks.completed }));
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

const assessment = () => screen.getByRole("button", { name: /1\. Get ready for the lesson/ }) as HTMLButtonElement;
const materials = () => screen.getByRole("button", { name: /2\. Explore and ask/ }) as HTMLButtonElement;
const expectActive = async (button: () => HTMLButtonElement) => {
  await waitFor(() => expect(button().getAttribute("aria-current")).toBe("step"));
};
const refresh = () => fireEvent.focus(window);

it("opens published material without a quiz and keeps the unpublished assessment locked", async () => {
  statuses["content-review"] = "available";
  render(<StudentView user={student} />);
  await expectActive(materials);
  expect(screen.getByText("0 of 1 available activity completed")).toBeTruthy();
  expect(assessment().disabled).toBe(true);
  expect(assessment().textContent).toContain("Not available yet");
  expect(screen.getByRole("region", { name: "Materials content" }).parentElement?.className).not.toContain("hidden");
  expect(screen.getByRole("region", { name: "Quiz content" }).parentElement?.className).toBe("hidden");
  expect(mocks.completed).not.toHaveBeenCalled();
});

it("keeps normal quiz and material navigation with two available activities", async () => {
  statuses = { assessment: "available", "content-review": "available", "content-rating": "locked" };
  render(<StudentView user={student} />);
  await screen.findByText("0 of 2 available activities completed");
  await expectActive(assessment);
  expect(assessment().disabled).toBe(false);
  expect(materials().disabled).toBe(false);
  fireEvent.click(materials());
  await expectActive(materials);
  refresh();
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
  await expectActive(materials);
  fireEvent.click(assessment());
  refresh();
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
  await expectActive(assessment);
});

it("does not bounce away from a completed quiz the student deliberately revisits", async () => {
  statuses = { assessment: "completed", "content-review": "available", "content-rating": "locked" };
  render(<StudentView user={student} />);
  await expectActive(materials);
  expect(screen.getByText("1 of 2 available activities completed")).toBeTruthy();
  fireEvent.click(assessment());
  await expectActive(assessment);
  refresh();
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
  await expectActive(assessment);
});

it("opens materials published after the student entered a task with no available activity", async () => {
  render(<StudentView user={student} />);
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  expect(materials().disabled).toBe(true);
  statuses["content-review"] = "available";
  refresh();
  await expectActive(materials);
  expect(screen.getByText("0 of 1 available activity completed")).toBeTruthy();
  expect(assessment().disabled).toBe(true);
});

it("does not interrupt an available quiz when the teacher publishes material", async () => {
  statuses.assessment = "available";
  render(<StudentView user={student} />);
  await screen.findByText("0 of 1 available activity completed");
  statuses["content-review"] = "available";
  refresh();
  await screen.findByText("0 of 2 available activities completed");
  await expectActive(assessment);
  expect(materials().disabled).toBe(false);
});

it("explains that nothing is available while retaining both disabled activity cards", async () => {
  render(<StudentView user={student} />);
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  expect(screen.getByText("No activities are available yet. Your teacher will publish them here.")).toBeTruthy();
  expect(assessment().disabled).toBe(true);
  expect(materials().disabled).toBe(true);
  expect(screen.queryByText(/0 of 0/)).toBeNull();
  expect(mocks.completed).not.toHaveBeenCalled();
});

it("completes the sole material activity only after questions and all ratings are complete", async () => {
  statuses = { assessment: "locked", "content-review": "completed", "content-rating": "available" };
  render(<StudentView user={student} />);
  await expectActive(materials);
  expect(screen.getByText("0 of 1 available activity completed")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Materials content" }).getAttribute("data-rating-unlocked")).toBe("true");
  expect(mocks.completed).not.toHaveBeenCalled();
  statuses["content-rating"] = "completed";
  refresh();
  await screen.findByText("1 of 1 available activity completed");
  expect(assessment().disabled).toBe(true);
  expect(assessment().textContent).toContain("Not available yet");
  expect(materials().textContent).toContain("Completed");
  expect(mocks.completed).toHaveBeenCalledExactlyOnceWith(student.classId, student.assignmentId, student.geniusId);
  refresh();
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
  expect(mocks.completed).toHaveBeenCalledOnce();
});

it("opens an already completed material-only task with a one-of-one progress count", async () => {
  statuses = { assessment: "locked", "content-review": "completed", "content-rating": "completed" };
  render(<StudentView user={student} />);
  await expectActive(materials);
  expect(screen.getByText("1 of 1 available activity completed")).toBeTruthy();
  expect(assessment().disabled).toBe(true);
});
