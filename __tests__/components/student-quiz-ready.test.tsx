// @vitest-environment jsdom
// The v8.3 "Get ready for the lesson" page (#180): layout, the pinned
// answered count, and "Next unanswered".
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentQuizView from "@/app/components/StudentQuizView";
import type { UserContext } from "@/lib/auth";
import type { Survey } from "@/lib/types";
import { getLesson } from "@/lib/quiz-data";

const user: UserContext = { geniusId: "student-a", userId: "student-a", name: "Student", email: null, role: "student", classId: "class-a", assignmentId: "task-a" };
const lesson = getLesson(1)!;
const questions = lesson.quiz_items.filter(item => item.type === "multiple_choice");
const survey: Survey = {
  survey_id: "survey-a", class_id: "class-a", assignment_id: "task-a", title: "Experience check-in", daily_experience_topic: "Collisions",
  status: "published", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z",
  questions: [{ item_id: "experience-a", question_number: 1, category: "experience_details", stem: "Recall a collision you saw.", response_fields: [
    { field_id: "experience", label: "Describe it", response_type: "text", text_length: "long" },
  ] }],
};
let withSurvey = true;
let quizPublished = true;
const fetchMock = vi.fn();
const reply = (data: unknown) => ({ ok: true, json: async () => data });
const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.clearAllMocks(); withSurvey = true; quizPublished = true;
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return reply({});
    if (url.startsWith("/api/quiz-status")) return reply({ quizStatus: quizPublished ? { lesson_number: 1, status: "published" } : null });
    if (url.startsWith("/api/lessons/")) return reply(lesson);
    if (url.startsWith("/api/student-answers")) return reply({ answer: null });
    if (url.startsWith("/api/surveys?")) return reply({ surveys: withSurvey ? [survey] : [] });
    if (url.startsWith("/api/survey-responses")) return reply({ responses: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const count = () => screen.getByText(/of \d+ answered$/).textContent;
const card = (stem: string) => screen.getByText(stem).closest("section")!;
const answer = (index: number) => fireEvent.click(within(card(questions[index].stem)).getByRole("button", { name: `A${questions[index].options.A}` }));
const confident = (index: number) => fireEvent.click(within(card(questions[index].stem)).getByRole("radio", { name: "Very confident" }));

it("shows the lesson heading, the two parts, and each confidence check inside its question's card", async () => {
  render(<StudentQuizView user={user} />);
  expect(await screen.findByRole("heading", { name: "Get ready for the lesson" })).toBeTruthy();
  expect(screen.getByText("Lesson 1")).toBeTruthy();
  expect(screen.getByText("Part 1 · Quiz")).toBeTruthy();
  expect(screen.getByText("Part 2 · Experience check-in")).toBeTruthy();
  for (const question of questions) {
    expect(within(card(question.stem)).getAllByRole("radiogroup", { name: "How confident are you about your answer?" })).toHaveLength(1);
  }
  // Survey questions are numbered after the four quiz questions.
  expect(within(card(survey.questions[0].stem)).getByText("5")).toBeTruthy();
});

it("keeps a pinned count of answers, quiz confidence included, and updates it as the student answers", async () => {
  render(<StudentQuizView user={user} />);
  await screen.findByText("Part 1 · Quiz");
  // 4 questions + 4 confidence checks + 1 survey question.
  expect(count()).toBe("0 of 9 answered");
  const bar = screen.getByText("0 of 9 answered").parentElement!;
  expect(bar.className).toContain("sticky");
  expect(bar.className).toContain("top-0");
  expect(screen.getByRole("progressbar", { name: "Questions answered" }).getAttribute("aria-valuenow")).toBe("0");

  answer(0);
  confident(0);
  expect(count()).toBe("2 of 9 answered");
  fireEvent.change(screen.getByRole("textbox", { name: "Describe it" }), { target: { value: "   " } });
  expect(count()).toBe("2 of 9 answered");
  fireEvent.change(screen.getByRole("textbox", { name: "Describe it" }), { target: { value: "Two carts bumped." } });
  expect(count()).toBe("3 of 9 answered");
  expect(screen.getByRole("progressbar", { name: "Questions answered" }).getAttribute("aria-valuenow")).toBe("3");
});

it("Next unanswered takes the student to the first card with something left, then says All answered", async () => {
  render(<StudentQuizView user={user} />);
  await screen.findByText("Part 1 · Quiz");
  answer(0);
  answer(1); // question 2 still needs its confidence
  confident(0);

  fireEvent.click(screen.getByRole("button", { name: "Next unanswered" }));
  expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
  expect(document.activeElement).toBe(card(questions[1].stem));

  for (const index of [1, 2, 3]) { answer(index); confident(index); }
  fireEvent.click(screen.getByRole("button", { name: "Next unanswered" }));
  expect(document.activeElement).toBe(card(survey.questions[0].stem));

  fireEvent.change(screen.getByRole("textbox", { name: "Describe it" }), { target: { value: "Two carts bumped." } });
  expect(screen.queryByRole("button", { name: "Next unanswered" })).toBeNull();
  expect(screen.getByText("All answered")).toBeTruthy();

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Submit answers" })); });
  expect(screen.getByText("Submitted — thank you!")).toBeTruthy();
  expect(count()).toBe("9 of 9 answered");
});

it("labels a survey on its own without a Part number", async () => {
  quizPublished = false;
  render(<StudentQuizView user={user} />);
  expect(await screen.findByText("Experience check-in")).toBeTruthy();
  expect(screen.queryByText("Part 1 · Quiz")).toBeNull();
  expect(screen.queryByText("Lesson 1")).toBeNull();
  expect(count()).toBe("0 of 1 answered");
});
