// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentQuizView from "@/app/components/StudentQuizView";
import type { UserContext } from "@/lib/auth";
import type { Survey } from "@/lib/types";
import { getLesson } from "@/lib/quiz-data";

const user: UserContext = { geniusId: "student-a", userId: "student-a", name: "Student", email: null, role: "student", classId: "class-a", assignmentId: "task-a" };
const lesson = getLesson(8)!;
const confidence = lesson.quiz_items.filter(item => item.type === "confidence_check");
const contentQuestions = lesson.quiz_items.filter(item => item.type === "multiple_choice");
const survey: Survey = {
  survey_id: "survey-a", class_id: user.classId!, assignment_id: user.assignmentId!, title: "Your experience", daily_experience_topic: "Pushing objects",
  status: "published", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z",
  questions: [{ item_id: "experience-a", question_number: 1, category: "experience_details", stem: "Recall pushing something.", response_fields: [
    { field_id: "experience", label: "Describe your experience", response_type: "text", text_length: "long" },
    { field_id: "uncertainty", label: "Where did you feel uncertain?", response_type: "text", text_length: "short" },
  ] }],
};
const fetchMock = vi.fn();
let savedAnswers: Record<string, string> | null;
let savedSurvey: Record<string, string> | null;
const reply = (data: unknown) => ({ ok: true, json: async () => data });

beforeEach(() => {
  vi.clearAllMocks(); savedAnswers = null; savedSurvey = null;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return reply({});
    if (url.startsWith("/api/quiz-status")) return reply({ quizStatus: { lesson_number: 8, status: "published" } });
    if (url.startsWith("/api/lessons/")) return reply(lesson);
    if (url.startsWith("/api/student-answers")) return reply({ answer: savedAnswers ? { answers: savedAnswers } : null });
    if (url.startsWith("/api/surveys?")) return reply({ surveys: [survey] });
    if (url.startsWith("/api/survey-responses")) return reply({ responses: savedSurvey ? [{ status: "submitted", answers: savedSurvey }] : [] });
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("renders only confidence checks as four-option horizontal ratings with unchanged labels and keyboard selection", async () => {
  render(<StudentQuizView user={user} />);
  const groups = await screen.findAllByRole("radiogroup", { name: "How confident are you about your answer?" });
  expect(groups).toHaveLength(4);
  for (const group of groups) {
    expect(group.classList.contains("grid-flow-col")).toBe(true);
    expect(group.getAttribute("aria-orientation")).toBe("horizontal");
    const options = within(group).getAllByRole("radio") as HTMLButtonElement[];
    expect(options.map(option => option.textContent)).toEqual(Object.values(confidence[0].options));
    expect(options.map(option => option.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false"]);
    expect(options.map(option => option.tabIndex)).toEqual([0, -1, -1, -1]);
  }
  const options = within(groups[0]).getAllByRole("radio") as HTMLButtonElement[];
  options[0].focus();
  fireEvent.keyDown(options[0], { key: "ArrowRight" });
  expect(document.activeElement).toBe(options[1]);
  expect(options[1].getAttribute("aria-checked")).toBe("true");
  expect(options[0].getAttribute("aria-checked")).toBe("false");
  fireEvent.keyDown(options[1], { key: "End" });
  expect(document.activeElement).toBe(options[3]);
  fireEvent.keyDown(options[3], { key: "Home" });
  expect(document.activeElement).toBe(options[0]);
  fireEvent.keyDown(options[0], { key: "ArrowLeft" });
  expect(document.activeElement).toBe(options[3]);
  expect(options[3].getAttribute("aria-checked")).toBe("true");
  fireEvent.click(options[2]);
  expect(options[2].getAttribute("aria-checked")).toBe("true");
  expect(options[3].getAttribute("aria-checked")).toBe("false");
  for (const item of contentQuestions) {
    const question = within(screen.getByText(item.stem).parentElement!);
    expect(question.queryByRole("radiogroup")).toBeNull();
    expect(question.getAllByRole("button")).toHaveLength(4);
  }
  expect(screen.getByRole("textbox", { name: "Describe your experience" }).tagName).toBe("TEXTAREA");
  expect(screen.getByRole("textbox", { name: "Where did you feel uncertain?" }).tagName).toBe("INPUT");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("requires every confidence response and submits the original A–D values with the existing survey answers", async () => {
  const onProgress = vi.fn();
  render(<StudentQuizView user={user} onProgress={onProgress} />);
  const groups = await screen.findAllByRole("radiogroup");
  const submit = screen.getByRole("button", { name: "Submit answers" }) as HTMLButtonElement;
  for (const item of contentQuestions) {
    fireEvent.click(within(screen.getByText(item.stem).parentElement!).getByRole("button", { name: `A${item.options.A}` }));
  }
  fireEvent.change(screen.getByRole("textbox", { name: "Describe your experience" }), { target: { value: "I pushed a shopping cart." } });
  fireEvent.change(screen.getByRole("textbox", { name: "Where did you feel uncertain?" }), { target: { value: "When it became harder to start." } });
  const values = ["A", "B", "C", "D"];
  for (let i = 0; i < groups.length; i++) {
    expect(submit.disabled).toBe(true);
    fireEvent.click(within(groups[i]).getByRole("radio", { name: confidence[i].options[values[i]] }));
  }
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  await screen.findByRole("button", { name: "Submitted" });
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts.map(([url]) => url)).toEqual(["/api/student-answers", "/api/survey-responses"]);
  expect(JSON.parse(posts[0][1].body).answers).toEqual(Object.fromEntries([
    ...contentQuestions.map(item => [item.item_id, "A"]), ...confidence.map((item, index) => [item.item_id, values[index]]),
  ]));
  expect(JSON.parse(posts[1][1].body)).toMatchObject({ surveyId: survey.survey_id, action: "submit", answers: {
    experience: "I pushed a shopping cart.", uncertainty: "When it became harder to start.",
  } });
  for (const option of screen.getAllByRole("radio")) expect((option as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(onProgress).toHaveBeenLastCalledWith({ kind: "completed" }));
});

it("restores submitted confidence values without changing or resubmitting them", async () => {
  savedAnswers = Object.fromEntries(lesson.quiz_items.map(item => [item.item_id, item.type === "confidence_check" ? "C" : "B"]));
  savedSurvey = { experience: "Earlier experience", uncertainty: "Earlier uncertainty" };
  render(<StudentQuizView user={user} />);
  const groups = await screen.findAllByRole("radiogroup");
  for (const group of groups) {
    const selected = within(group).getByRole("radio", { name: "Not very confident" }) as HTMLButtonElement;
    expect(selected.getAttribute("aria-checked")).toBe("true");
    expect(selected.disabled).toBe(true);
    const other = within(group).getByRole("radio", { name: "Very confident" });
    fireEvent.click(other);
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(selected.getAttribute("aria-checked")).toBe("true");
    expect(other.getAttribute("aria-checked")).toBe("false");
  }
  expect((screen.getByRole("button", { name: "Submitted" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});
