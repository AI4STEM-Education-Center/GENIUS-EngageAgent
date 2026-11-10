// @vitest-environment jsdom
// The class dashboard (#207): misconception patterns and every student question.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ClassDashboard from "@/app/components/ClassDashboard";
import type { ClassDashboard as Data } from "@/lib/class-dashboard";

const q1 = "1".repeat(16), q2 = "2".repeat(16);
let data: Data;
let postReply: { ok: boolean; body: unknown };
const fetchMock = vi.fn();

beforeEach(() => {
  data = {
    tasks: [
      { assignmentId: "ea-task-1", title: "Deformation", lessonNumber: 3, boardPublished: true },
      { assignmentId: "ea-task-2", title: "Forces", lessonNumber: 2, boardPublished: false },
      { assignmentId: "ea-task-3", title: "Draft", lessonNumber: null, boardPublished: false },
    ],
    misconceptions: [{ assignmentId: "ea-task-1", lessonNumber: 3, takenAt: "2026-11-04T10:00:00Z", code: "a", text: "If it bends, it must be damaged.", count: 3, incorrect: 12 }],
    questions: [
      { id: q1, text: "Does the post bend?", studentName: "Jayden R.", assignmentId: "ea-task-1", lessonNumber: 3, askedAt: "2026-11-05T09:00:00Z", tag: "Investigable", onBoards: ["ea-task-1"] },
      { id: q2, text: "Why do carts push back?", studentName: "Ava J.", assignmentId: "ea-task-2", lessonNumber: 2, askedAt: "2026-11-02T09:00:00Z", tag: null, onBoards: [] },
    ],
  };
  postReply = { ok: true, body: { added: true } };
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) =>
    init?.method === "POST" ? { ok: postReply.ok, json: async () => postReply.body } : { ok: true, json: async () => data });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const questionsCard = () => screen.getByRole("region", { name: "Student questions" });
const rows = () => within(questionsCard()).getAllByRole("row").slice(1);

it("shows misconception patterns as a share of wrong answers", async () => {
  render(<ClassDashboard classId="ea-class-1" className="Physics · Period 3" />);
  expect(screen.getByRole("heading", { name: "Physics · Period 3" })).toBeVisible();
  const patterns = await screen.findByRole("region", { name: "Misconception patterns" });
  expect(patterns).toHaveTextContent("Lesson 3");
  expect(patterns).toHaveTextContent("If it bends, it must be damaged.");
  expect(patterns).toHaveTextContent("3 of 12");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/class-dashboard?classId=ea-class-1");
});

it("filters questions by lesson and searches questions and students", async () => {
  render(<ClassDashboard classId="ea-class-1" />);
  await screen.findByText("Does the post bend?");
  expect(within(questionsCard()).getByText("2")).toBeVisible();
  expect(rows()).toHaveLength(2);
  fireEvent.click(within(questionsCard()).getByRole("button", { name: "Lesson 2" }));
  expect(rows()).toHaveLength(1);
  expect(questionsCard()).toHaveTextContent("Why do carts push back?");
  fireEvent.click(within(questionsCard()).getByRole("button", { name: "All lessons" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search questions or students" }), { target: { value: "jayden" } });
  expect(rows()).toHaveLength(1);
  expect(questionsCard()).toHaveTextContent("Does the post bend?");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search questions or students" }), { target: { value: "nothing like this" } });
  expect(questionsCard()).toHaveTextContent("No questions match");
});

it("adds a question to another lesson's board from a dropdown of the class's lessons", async () => {
  render(<ClassDashboard classId="ea-class-1" />);
  const select = await screen.findByRole("combobox", { name: "Add “Why do carts push back?” to a lesson's board" });
  const options = within(select).getAllByRole("option");
  expect(options.map(o => o.textContent)).toEqual(["Add to board…", "Lesson 3 · Deformation", "Lesson 2 · Forces (board not published)"]);
  expect((options[2] as HTMLOptionElement).disabled).toBe(true);
  // Already on its own lesson's board.
  const own = screen.getByRole("combobox", { name: "Add “Does the post bend?” to a lesson's board" });
  expect((within(own).getByRole("option", { name: "Lesson 3 · Deformation (on board)" }) as HTMLOptionElement).disabled).toBe(true);

  fireEvent.change(select, { target: { value: "ea-task-1" } });
  expect(await screen.findByRole("status")).toHaveTextContent("Added to the Lesson 3 board (Deformation).");
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(post[1].body)).toEqual({ classId: "ea-class-1", questionId: q2, fromAssignmentId: "ea-task-2", toAssignmentId: "ea-task-1" });
  await waitFor(() => expect(rows()[1]).toHaveTextContent("On board · Lesson 3"));
});

it("says why a question couldn't be added, and offers a retry when loading fails", async () => {
  postReply = { ok: false, body: { error: "The board holds at most 20 questions." } };
  render(<ClassDashboard classId="ea-class-1" />);
  fireEvent.change(await screen.findByRole("combobox", { name: "Add “Why do carts push back?” to a lesson's board" }), { target: { value: "ea-task-1" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("The board holds at most 20 questions.");
  cleanup();

  fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: "Workspace storage is unavailable." }) }));
  render(<ClassDashboard classId="ea-class-1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Workspace storage is unavailable.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Does the post bend?")).toBeVisible();
});

it("says when there's nothing yet", async () => {
  data = { tasks: [], misconceptions: [], questions: [] };
  render(<ClassDashboard classId="ea-class-1" />);
  expect(await screen.findByText("No quiz answers yet")).toBeVisible();
  expect(screen.getByText("No questions yet")).toBeVisible();
});
