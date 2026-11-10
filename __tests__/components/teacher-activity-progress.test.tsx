// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeacherView from "@/app/components/TeacherView";
import type { UserContext } from "@/lib/auth";
import { lessonResponse } from "@/__tests__/fixtures/lesson-responses";

const teacher: UserContext = {
  geniusId: "teacher", userId: "teacher", name: "Test teacher", email: null,
  role: "teacher", classId: "ea-class-progress", assignmentId: "ea-task-progress",
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const step = (name: RegExp) => within(screen.getByRole("navigation", { name: "Teacher steps" })).getByRole("button", { name });
const assessment = () => step(/Pre-knowledge assessment/);
// Completion is displayed as the check icon on a step after leaving it.
const assessmentCheck = () => assessment().querySelector("svg.lucide-check");
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

it.each([
  { publishedSurvey: false, refreshFails: false },
  { publishedSurvey: true, refreshFails: false },
  { publishedSurvey: false, refreshFails: true },
])("refreshes the Assessment checkmark after choosing another lesson (published survey: $publishedSurvey; refresh fails: $refreshFails)", async ({ publishedSurvey, refreshFails }) => {
  let quiz = { lesson_number: 1, status: "published" };
  let progressReads = 0;
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const lesson = lessonResponse(input);
    if (lesson) return reply(lesson);
    if (input === "/api/quiz-status" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      quiz = { lesson_number: body.lessonNumber, status: body.status };
      return reply({ quizStatus: quiz });
    }
    if (input.startsWith("/api/quiz-status")) return reply({ quizStatus: quiz });
    if (input.startsWith("/api/activity-progress")) {
      progressReads++;
      if (refreshFails && progressReads > 1) return reply({ error: "Progress is temporarily unavailable." }, 503);
      return reply({ progress: {
        assessment: quiz.status !== "draft" || publishedSurvey ? "done" : "in-progress",
        strategy: "in-progress", materials: "not-started", discussion: "not-started",
      } });
    }
    if (input.startsWith("/api/surveys")) return reply({ surveys: publishedSurvey ? [{ id: "published-survey", status: "published" }] : [] });
    if (input.startsWith("/api/student-answers")) return reply({ answers: [] });
    if (input.startsWith("/api/content-publish")) return reply({ items: [] });
    if (input.startsWith("/api/slides?")) return reply({ lessons: [] });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<TeacherView user={teacher} />);
  await waitFor(() => expect(assessment()).toHaveTextContent("Published"));
  fireEvent.click(step(/Strategy recommendations/));
  await waitFor(() => expect(assessmentCheck()).not.toBeNull());

  fireEvent.click(assessment());
  fireEvent.click(await screen.findByRole("button", { name: /Lesson 2\s*0 questions/ }));
  await waitFor(() => expect(quiz).toEqual({ lesson_number: 2, status: "draft" }));
  expect(await screen.findByRole("button", { name: "Publish quiz to students" })).toBeInTheDocument();
  fireEvent.click(step(/Strategy recommendations/));
  await waitFor(() => {
    expect(assessment()).toHaveTextContent("In progress");
    if (publishedSurvey) expect(assessmentCheck()).not.toBeNull();
    else expect(assessmentCheck()).toBeNull();
  });
  expect(progressReads).toBeGreaterThanOrEqual(2);
});

it("ignores a previous task's delayed progress after loading the next task", async () => {
  let finishOldProgress!: (response: Response) => void;
  const nextTeacher = { ...teacher, assignmentId: "ea-task-next" };
  const fetchMock = vi.fn(async (input: string) => {
    const lesson = lessonResponse(input);
    if (lesson) return reply(lesson);
    const nextTask = input.includes("assignmentId=ea-task-next");
    if (input.startsWith("/api/activity-progress")) {
      // Simulate an old response arriving even after its request is aborted.
      if (!nextTask) return new Promise<Response>(resolve => { finishOldProgress = resolve; });
      return reply({ progress: { assessment: "in-progress", strategy: "not-started", materials: "not-started", discussion: "not-started" } });
    }
    if (input.startsWith("/api/quiz-status")) return reply({ quizStatus: { lesson_number: nextTask ? 2 : 1, status: nextTask ? "draft" : "published" } });
    if (input.startsWith("/api/student-answers")) return reply({ answers: [] });
    if (input.startsWith("/api/surveys")) return reply({ surveys: [] });
    if (input.startsWith("/api/content-publish")) return reply({ items: [] });
    if (input.startsWith("/api/slides?")) return reply({ lessons: [] });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);

  const view = render(<TeacherView user={teacher} initialStep={2} />);
  await waitFor(() => expect(assessment()).toHaveTextContent("Published"));
  await waitFor(() => expect(finishOldProgress).toBeTypeOf("function"));
  view.rerender(<TeacherView user={nextTeacher} initialStep={2} />);
  await waitFor(() => {
    expect(assessment()).toHaveTextContent("In progress");
    expect(assessmentCheck()).toBeNull();
  });
  expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/api/activity-progress") && url.includes("assignmentId=ea-task-next"))).toBe(true);
  await act(async () => { finishOldProgress(reply({ progress: { assessment: "done", strategy: "done", materials: "done", discussion: "done" } })); });
  expect(assessmentCheck()).toBeNull();
  expect(assessment()).toHaveTextContent("In progress");
});
