// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeacherView from "@/app/components/TeacherView";
import ExperienceQuizResults from "@/app/components/ExperienceQuizResults";
import SurveyResultsSection from "@/app/components/SurveyResultsSection";
import { getLesson } from "@/lib/quiz-data";
import type { UserContext } from "@/lib/auth";
import type { StudentAnswer } from "@/lib/types";

const teacher: UserContext = {
  geniusId: "teacher", userId: "teacher", name: "Teacher", email: null,
  role: "teacher", classId: "class", assignmentId: "assignment",
};
let quizStatus: object | null;
beforeEach(() => {
  localStorage.clear();
  quizStatus = null;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => ({
    ok: true,
    json: async () => {
      if (input.startsWith("/api/lessons/")) return getLesson(Number(input.split("/").pop()));
      if (input.startsWith("/api/quiz-status")) {
        if (init?.method === "POST") return { quizStatus: { ...JSON.parse(String(init.body)), quiz_version: 2 } };
        return { quizStatus };
      }
      return {};
    },
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("publishes one lesson quiz preview with appended written questions and no separate Survey option", async () => {
  render(<TeacherView user={teacher} />);
  fireEvent.click(await screen.findByRole("button", { name: "Lesson 2 7 questions" }));
  expect(await screen.findByText("Quiz preview (7 questions + confidence checks)")).toBeTruthy();
  expect(screen.getAllByText("Written response · Not graded")).toHaveLength(3);
  const lesson = getLesson(2)!;
  const experience = lesson.quiz_items.find((item) => item.type === "experience")!;
  expect(screen.getByText(`5. ${experience.stem}`)).toBeTruthy();
  expect(screen.getByText(experience.response_fields![0].label)).toBeTruthy();
  expect(screen.getByText(experience.example!)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Survey" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Publish quiz to students" }));
  expect(await screen.findByText("Quiz is live. Students can now answer.")).toBeTruthy();
  const requests = vi.mocked(fetch).mock.calls;
  expect(requests.some(([url, init]) => String(url) === "/api/quiz-status" && init?.method === "POST"
    && JSON.parse(String(init.body)).status === "published")).toBe(true);
  expect(requests.some(([url]) => String(url).startsWith("/api/surveys"))).toBe(false);
});

it("previews the original four questions for an already published legacy quiz", async () => {
  quizStatus = { lesson_number: 2, status: "published" };
  render(<TeacherView user={teacher} />);
  expect(await screen.findByText("Quiz preview (4 questions + confidence checks)")).toBeTruthy();
  expect(screen.queryByText("Written response · Not graded")).toBeNull();
});

it("keeps earlier knowledge answers for analysis but does not count an upgraded quiz as complete", async () => {
  quizStatus = { lesson_number: 2, status: "published", quiz_version: 2 };
  const fetchMock = vi.mocked(fetch);
  const originalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input).startsWith("/api/student-answers")) return {
      ok: true,
      json: async () => ({ answers: [answer("Avery", { L2_Q1: "C", L2_Q2: "D", L2_Q3: "A", L2_Q4: "A" })] }),
    } as Response;
    return originalFetch(input, init);
  });
  render(<TeacherView user={teacher} />);
  await screen.findByText("Quiz preview (7 questions + confidence checks)");
  fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
  expect(await screen.findByText(/1 student is awaiting experience responses and confidence checks/)).toBeTruthy();
  expect(screen.getByText(/students have completed the quiz/).textContent).toBe("0 students have completed the quiz.");
  expect((screen.getByRole("button", { name: "Analyze 1 students" }) as HTMLButtonElement).disabled).toBe(false);
});

const answer = (studentId: string, values: Record<string, string>, lessonNumber = 2): StudentAnswer => ({
  student_id: studentId, student_name: studentId, class_id: "class", assignment_id: "assignment",
  lesson_number: lessonNumber, answers: values, submitted_at: "2026-10-13T12:00:00Z",
});

it("shows each student's experience answers with confidence while keeping legacy unanswered fields ungraded", () => {
  const lesson = getLesson(2)!;
  const question = lesson.quiz_items.find((item) => item.type === "experience")!;
  render(<ExperienceQuizResults lessonNumber={2} answers={[
    answer("Avery", { L2_S1_activity: "Playing soccer", L2_S1_confidence: "A" }),
    answer("Casey", { L2_S1_activity: "Drawing" }),
    answer("Other lesson", { L2_S1_activity: "Should not appear" }, 3),
    answer("Legacy quiz only", { L2_Q1: "C" }),
  ]} />);
  const results = screen.getByRole("region", { name: "Experience responses" });
  expect(within(results).getByText("Playing soccer")).toBeTruthy();
  expect(within(results).getByText(/Very confident/)).toBeTruthy();
  expect(within(results).getByText(question.response_fields![0].label)).toBeTruthy();
  expect(within(results).getByText(/These questions are not graded/)).toBeTruthy();
  expect(within(results).queryByText("Other lesson")).toBeNull();
  expect(within(results).queryByText("Legacy quiz only")).toBeNull();
  fireEvent.change(within(results).getByRole("combobox"), { target: { value: "Casey" } });
  expect(within(results).getByText("Drawing")).toBeTruthy();
  expect(within(results).queryByText("Playing soccer")).toBeNull();
  expect(within(results).getAllByText(/Not recorded/)).toHaveLength(3);
  expect(within(results).queryByText(/incorrect|wrong/i)).toBeNull();
});

it("does not show an empty separate Survey results entry", async () => {
  await act(async () => {
    render(<SurveyResultsSection classId="class" assignmentId="assignment" hideWhenEmpty />);
  });
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Survey results")).toBeNull();
});
