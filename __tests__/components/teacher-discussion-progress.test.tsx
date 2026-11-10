// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeacherView from "@/app/components/TeacherView";
import type { UserContext } from "@/lib/auth";
import { lessonResponse } from "@/__tests__/fixtures/lesson-responses";

const teacher: UserContext = {
  geniusId: "teacher", userId: "teacher", name: "Test teacher", email: null,
  role: "teacher", classId: "ea-class-discussion", assignmentId: "ea-task-discussion",
};
const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const step = (name: RegExp) => within(screen.getByRole("navigation", { name: "Teacher steps" })).getByRole("button", { name });
const discussion = () => step(/Questions & discussion/);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows saved report release before Step 4 opens and clears the loaded status for a new lesson", async () => {
  let quiz = { lesson_number: 1, status: "published" };
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const lesson = lessonResponse(input);
    if (lesson) return reply(lesson);
    if (input === "/api/quiz-status" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      quiz = { lesson_number: body.lessonNumber, status: body.status };
      return reply({ quizStatus: quiz });
    }
    if (input.startsWith("/api/quiz-status")) return reply({ quizStatus: quiz });
    const released = quiz.lesson_number === 1 && quiz.status !== "draft";
    if (input.startsWith("/api/activity-progress")) return reply({ progress: {
      assessment: quiz.status !== "draft" ? "done" : "in-progress",
      strategy: "not-started", materials: "not-started", discussion: released ? "done" : "not-started",
    } });
    if (input.startsWith("/api/quiz-report")) return reply({
      release: released ? { lessonNumber: 1, reason: "taught", releasedAt: "now" } : null,
      lessonNumber: quiz.lesson_number, students: [],
    });
    if (input.startsWith("/api/question-board")) return reply({ board: null });
    if (input.startsWith("/api/surveys")) return reply({ surveys: [] });
    if (input.startsWith("/api/student-answers")) return reply({ answers: [] });
    if (input.startsWith("/api/content-publish")) return reply({ items: [] });
    if (input.startsWith("/api/slides?")) return reply({ lessons: [] });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<TeacherView user={teacher} />);
  await waitFor(() => expect(discussion()).toHaveTextContent("Reports released"));
  expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/api/quiz-report"))).toBe(false);

  fireEvent.click(discussion());
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/api/quiz-report"))).toBe(true);
    expect(discussion()).toHaveTextContent("Reports released");
  });
  fireEvent.click(step(/Pre-knowledge assessment/));
  fireEvent.click(await screen.findByRole("button", { name: /Lesson 2\s*0 questions/ }));
  await waitFor(() => expect(quiz).toEqual({ lesson_number: 2, status: "draft" }));
  await waitFor(() => expect(discussion()).toHaveTextContent("After materials are sent"));
  expect(discussion()).not.toHaveTextContent("Reports released");
  expect(discussion().querySelector("svg.lucide-check")).toBeNull();
});
