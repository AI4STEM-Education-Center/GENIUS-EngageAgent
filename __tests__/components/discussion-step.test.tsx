// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DiscussionStep from "@/app/components/discussion/DiscussionStep";
import type { TaskQuestions } from "@/lib/class-questions-server";
import type { QuestionBoard } from "@/lib/class-questions";

const ids = { post: "1".repeat(16), phone: "2".repeat(16), force: "3".repeat(16), soccer: "4".repeat(16) };
const questions: TaskQuestions = {
  lessonNumber: 3, total: 4, students: 3, analysisError: null,
  groups: [
    { title: "Forces we can't see", questions: [
      { id: ids.post, text: "Does the post bend?", studentId: "s1", studentName: "Mateo L.", tag: "Investigable", suggested: true },
      { id: ids.phone, text: "Why does my phone crack on tile?", studentId: "s2", studentName: "Jayden R.", tag: "Explanation-seeking", suggested: false },
    ] },
    { title: "Clarifying", questions: [{ id: ids.force, text: "What does force mean?", studentId: "s3", studentName: "Ava J.", tag: "Clarifying", suggested: false }] },
    { title: "Off-topic", questions: [{ id: ids.soccer, text: "Who invented soccer?", studentId: "s3", studentName: "Ava J.", tag: "Off-topic", suggested: false }] },
  ],
};
const report = { lessonNumber: 3, lessonTitle: "Deformation", correct: 1, total: 1, items: [{
  number: 1, stem: "Did the plate deform?", answer: { key: "D", text: "Yes, a tiny amount." }, correctAnswer: { key: "D", text: "Yes, a tiny amount." }, isCorrect: true, confidence: "Very confident",
}] };

let state: { questions: TaskQuestions | { error: string }; board: QuestionBoard | null; release: unknown; students: { id: string; name: string }[] };
const fetchMock = vi.fn();
const reply = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
const calls = (path: string, method?: string) => fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith(path) && (!method || init?.method === method));

beforeEach(() => {
  state = { questions, board: null, release: null, students: [{ id: "s2", name: "Jayden R." }] };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/question-analysis")) return "error" in state.questions ? reply(state.questions, false) : reply(state.questions);
    if (url.startsWith("/api/question-board")) {
      if (init?.method === "PUT") { state.board = { publishedAt: "now", questions: JSON.parse(String(init.body)).questions }; return reply({ board: state.board }); }
      if (init?.method === "DELETE") { state.board = null; return reply({ board: null }); }
      return reply({ board: state.board });
    }
    if (url.startsWith("/api/quiz-report-release")) { state.release = { reason: JSON.parse(String(init?.body)).reason, releasedAt: "now", lessonNumber: 3 }; return reply({ release: state.release }); }
    if (url.startsWith("/api/quiz-report")) return url.includes("studentId=") ? reply({ release: state.release, report }) : reply({ release: state.release, lessonNumber: 3, students: state.students });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const view = (props: Partial<{ materialsSent: boolean; onStatusChange: (s: string) => void }> = {}) =>
  render(<DiscussionStep classId="ea-class-1" assignmentId="ea-task-1" materialsSent {...props} />);
const questionsCard = () => screen.getByRole("region", { name: "Student questions" });
const box = (text: string) => within(questionsCard()).getByRole("checkbox", { name: text });

it("waits for materials before showing questions", async () => {
  view({ materialsSent: false });
  expect(screen.getByText("Available after materials are sent in Step 3")).toBeVisible();
  await waitFor(() => expect(calls("/api/question-board")).toHaveLength(1));
  expect(calls("/api/question-analysis")).toHaveLength(0);
});

it("shows the sorted questions with names and tags, and pre-selects the AI's suggestions", async () => {
  const onStatusChange = vi.fn();
  view({ onStatusChange });
  await waitFor(() => expect(box("Does the post bend?")).toBeChecked());
  expect(questionsCard()).toHaveTextContent("4 questions from 3 students");
  expect(questionsCard()).toHaveTextContent("1 suggested for discussion");
  const theme = within(questionsCard()).getByRole("group", { name: "Forces we can't see" });
  expect(theme).toHaveTextContent("Mateo L.");
  expect(theme).toHaveTextContent("Investigable");
  expect(theme).toHaveTextContent("Suggested");
  expect(box("Why does my phone crack on tile?")).not.toBeChecked();
  expect(onStatusChange).toHaveBeenLastCalledWith("4 questions");
});

it("publishes the chosen questions without names, with edited wording", async () => {
  view();
  await waitFor(() => expect(box("Does the post bend?")).toBeChecked());
  const clarifying = within(questionsCard()).getByRole("group", { name: "Clarifying" });
  fireEvent.click(within(clarifying).getByRole("button", { name: "Select all" }));
  expect(box("What does force mean?")).toBeChecked();

  const post = within(questionsCard()).getByRole("group", { name: "Forces we can't see" });
  fireEvent.click(within(post).getAllByRole("button", { name: "Edit wording" })[0]);
  const input = within(post).getByRole("textbox", { name: "Board wording" });
  fireEvent.change(input, { target: { value: "Does a goalpost bend when a ball hits it?" } });
  fireEvent.blur(input);
  expect(post).toHaveTextContent("Edited for the board");

  fireEvent.click(screen.getByRole("button", { name: "Publish 2 to Class Question Board" }));
  await waitFor(() => expect(calls("/api/question-board", "PUT")).toHaveLength(1));
  const sent = JSON.parse(String(calls("/api/question-board", "PUT")[0][1].body));
  expect(sent.questions).toEqual([
    { id: ids.post, text: "Does a goalpost bend when a ball hits it?", theme: "Forces we can't see" },
    { id: ids.force, text: "What does force mean?", theme: "Clarifying" },
  ]);
  expect(JSON.stringify(sent)).not.toMatch(/Mateo|Ava|studentId/);

  const board = screen.getByRole("region", { name: "Class Question Board" });
  expect(await within(board).findByText("Live for students")).toBeVisible();
  expect(within(within(board).getByRole("list", { name: "Questions on the board" })).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Update board (2)" })).toBeEnabled();

  fireEvent.click(within(board).getByRole("button", { name: "Unpublish" }));
  expect(await within(board).findByText("Not published yet")).toBeVisible();
});

it("starts from the published board when there is one", async () => {
  state.board = { publishedAt: "then", questions: [{ id: ids.phone, text: "Why do phones crack on tile but not carpet?", theme: "Forces we can't see" }] };
  view();
  await waitFor(() => expect(box("Why do phones crack on tile but not carpet?")).toBeChecked());
  expect(box("Does the post bend?")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Update board (1)" })).toBeEnabled();
});

it("still lists the questions when they couldn't be sorted", async () => {
  state.questions = { ...questions, analysisError: "The questions couldn't be sorted right now.", groups: [{ title: "All questions", questions: questions.groups.flatMap(g => g.questions).map(q => ({ ...q, tag: undefined, suggested: false })) }] };
  view();
  expect(await within(questionsCard()).findByText(/couldn't be sorted right now\. You can still choose/)).toBeVisible();
  expect(within(questionsCard()).getAllByRole("checkbox")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Publish 0 to Class Question Board" })).toBeDisabled();
});

it("shows a load error with Try again", async () => {
  state.questions = { error: "Student questions couldn't be loaded right now." };
  view();
  const alert = await within(questionsCard()).findByRole("alert");
  state.questions = questions;
  fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(box("Does the post bend?")).toBeChecked());
});

it("holds reports until the teacher releases them, with a preview first", async () => {
  view();
  const reports = screen.getByRole("region", { name: "Feedback reports" });
  expect(await within(reports).findByText("1 report ready")).toBeVisible();
  expect(reports).toHaveTextContent("Held until Lesson 3 is taught");

  fireEvent.change(within(reports).getByRole("combobox", { name: "Preview a report" }), { target: { value: "s2" } });
  const preview = await within(reports).findByRole("region", { name: "Report preview for Jayden R." });
  expect(preview).toHaveTextContent("not yet released");
  expect(await within(preview).findByText("Jayden R.’s answers")).toBeVisible();
  expect(String(calls("/api/quiz-report?")[1][0])).toContain("studentId=s2");

  fireEvent.click(within(reports).getByRole("button", { name: "Mark Lesson 3 as taught" }));
  expect(await within(reports).findByText("Released to 1 student")).toBeVisible();
  expect(JSON.parse(String(calls("/api/quiz-report-release", "POST")[0][1].body))).toMatchObject({ reason: "taught", classId: "ea-class-1" });
});

it("says there are no reports before anyone submits", async () => {
  state.students = [];
  view();
  const reports = screen.getByRole("region", { name: "Feedback reports" });
  expect(await within(reports).findByText("No reports yet")).toBeVisible();
  expect(within(reports).queryByRole("button", { name: /Mark Lesson/ })).toBeNull();
});
