// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentQuizView from "@/app/components/StudentQuizView";
import TeacherView from "@/app/components/TeacherView";
import type { UserContext } from "@/lib/auth";
import { clearVerifiedClientAuth, scopedTaskFetch, setVerifiedClientAuth } from "@/lib/client-auth";
import { MisconceptionId } from "@/lib/misconceptions";
import { getLesson } from "@/lib/quiz-data";
import { emptyTaskQuiz, importedItem, notMatchedYet, publishedBarLines, taskQuizView, type TaskQuiz, type TaskQuizItem } from "@/lib/task-quiz";
import { lessonResponse } from "../fixtures/lesson-responses";

// Step 1's quiz inside the teacher page, and the student's read of a published quiz (#177).
const teacher: UserContext = { geniusId: "t1", userId: "t1", name: "Ana", email: null, role: "teacher", classId: "ea-class-1", assignmentId: "ea-task-1" };
const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce;
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const lessonOne = { number: 1, version: 1, title: "Lesson 1", objective: "Explain collisions", topic: "t", targetConcept: "c", coreIdeas: ["Pairs"], misconceptions: [MC1] };
const confirmed = (): TaskQuizItem => {
  const item = importedItem("U1", "Uploaded one?", ["a", "b", "c", "d"], "A");
  return { ...item, confirmed: true, options: item.options.map((option) => (option.letter === "A" ? { ...option, match: notMatchedYet() } : { ...option, match: { state: "no_misconception" as const, ids: [], setBy: "teacher" as const, confidence: null, reason: null } })) };
};
const stepTab = (name: RegExp) => within(screen.getByRole("navigation", { name: "Teacher steps" })).getByRole("button", { name });

let quiz: TaskQuiz;
let legacy: string | null;
let quizStatus: { lesson_number: number; status: string } | null;
let log: string[];
let served: Record<string, unknown>;

beforeEach(() => {
  localStorage.clear();
  quiz = { ...emptyTaskQuiz("ea-class-1", "ea-task-1"), lesson: lessonOne, source: "uploaded", items: [confirmed()] };
  legacy = null; quizStatus = { lesson_number: 1, status: "draft" }; log = []; served = {};
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    log.push(`${method} ${input}`);
    const path = input.split("?")[0];
    if (path === "/api/task-quiz") return reply({ quiz: taskQuizView(quiz), legacyStatus: legacy, ...(quiz.status === "published" ? { publishedBar: { ...publishedBarLines({ className: "Period 3", classSize: 24, submitted: 2 }), classSize: 24 } } : {}) });
    if (path === "/api/task-quiz/lesson" && method === "GET") return reply({ lessons: [{ lessonNumber: 1, title: "Lesson 1", currentVersion: 1 }, { lessonNumber: 2, title: "Lesson 2", currentVersion: 1 }], lesson: { ...lessonOne, misconceptions: [{ id: MC1, text: "x" }] } });
    if (path === "/api/task-quiz/lesson") { quiz = { ...quiz, lesson: { ...lessonOne, number: 2, title: "Lesson 2" }, source: "provided", revision: quiz.revision + 1 }; return reply({ quiz: taskQuizView(quiz) }); }
    if (path === "/api/task-quiz/publish") {
      quiz = { ...quiz, status: "published", revision: quiz.revision + 1 };
      return reply({ message: "Task published to 24 students", publishedBar: { ...publishedBarLines({ className: "Period 3", classSize: 24, submitted: 2 }), classSize: 24 }, quiz: taskQuizView(quiz) }, 201);
    }
    if (path === "/api/quiz-status" && method === "POST") { const body = JSON.parse(String(init?.body)); quizStatus = { lesson_number: body.lessonNumber, status: body.status }; return reply({ quizStatus }); }
    if (path === "/api/quiz-status") return reply({ quizStatus });
    return reply(lessonResponse(input, undefined, { learning_objective: "Explain collisions" }) ?? (path === "/api/surveys" ? { surveys: [] } : path.startsWith("/api/material-gallery") ? { items: [] } : path === "/api/slides" ? { lessons: [] } : {}));
  }));
});
afterEach(() => { cleanup(); clearVerifiedClientAuth(); vi.unstubAllGlobals(); });

describe("the teacher page", () => {
  it("shows the Step 1 status and the tab pill from the task's quiz", async () => {
    quiz = { ...quiz, items: [{ ...confirmed(), confirmed: false }] };
    render(<TeacherView user={teacher} />);
    expect(await screen.findByLabelText("Lesson")).toBeInTheDocument();
    await waitFor(() => expect(stepTab(/Assessment/)).toHaveTextContent("In progress"));
    expect(screen.getByRole("button", { name: /^Quiz\s*Needs review$/ })).toBeInTheDocument();
    expect(screen.queryByText("Choose a lesson")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish quiz to students" })).toBeNull();
  });

  it("moves to Ready to publish, then Published, then opens Step 2, reading the published copy", async () => {
    render(<TeacherView user={teacher} />);
    await screen.findByRole("article", { name: "Item 1" });
    await waitFor(() => expect(stepTab(/Assessment/)).toHaveTextContent("Ready to publish"));
    expect(screen.getByRole("button", { name: /^Quiz\s*Ready$/ })).toBeInTheDocument();
    const lessonReads = () => log.filter((line) => line.startsWith("GET /api/lessons/1?")).length;
    await waitFor(() => expect(lessonReads()).toBeGreaterThan(0));
    const before = lessonReads();
    fireEvent.click(screen.getByRole("button", { name: "Publish task" }));
    await screen.findByText("Task published to Period 3.");
    await waitFor(() => expect(stepTab(/Assessment/)).toHaveTextContent("Published"));
    await waitFor(() => expect(lessonReads()).toBe(before + 1));
    fireEvent.click(screen.getByRole("button", { name: /Go to Step 2/ }));
    await waitFor(() => expect(stepTab(/Strategy/)).toHaveAttribute("aria-current", "step"));
  });

  it("picking a lesson also saves it the way the rest of the page reads it", async () => {
    render(<TeacherView user={teacher} />);
    fireEvent.change(await screen.findByLabelText("Lesson"), { target: { value: "2" } });
    await waitFor(() => expect(log).toContain("POST /api/task-quiz/lesson"));
    await waitFor(() => expect(quizStatus).toEqual({ lesson_number: 2, status: "draft" }));
  });

  it.each(["published", "closed"])("keeps a task %s the old way on the older screen, with no publish bar", async (status) => {
    legacy = status; quizStatus = { lesson_number: 1, status };
    quiz = emptyTaskQuiz("ea-class-1", "ea-task-1");
    render(<TeacherView user={teacher} />);
    expect(await screen.findByText("Choose a lesson")).toBeInTheDocument();
    await waitFor(() => expect(stepTab(/Assessment/)).toHaveTextContent(status === "closed" ? "Closed" : "Published"));
    expect(screen.queryByLabelText("Lesson")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish task" })).toBeNull();
    if (status === "published") expect(await screen.findByText("Quiz is live. Students can now answer.")).toBeInTheDocument();
  });

  it("keeps the older look-only screen with no task, and asks the quiz routes nothing", async () => {
    render(<TeacherView user={{ ...teacher, classId: undefined, assignmentId: undefined }} />);
    expect(await screen.findByText("Choose a lesson")).toBeInTheDocument();
    expect(log.some((line) => line.includes("/api/task-quiz"))).toBe(false);
    expect(screen.queryByRole("button", { name: "Publish task" })).toBeNull();
  });

  it("leaves the Survey tab working, with the bar still at the bottom of the step", async () => {
    render(<TeacherView user={teacher} />);
    await screen.findByLabelText("Lesson");
    fireEvent.click(screen.getByRole("button", { name: /^Survey/ }));
    expect(screen.queryByLabelText("Lesson")).toBeNull();
    await waitFor(() => expect(log.some((line) => line.startsWith("GET /api/surveys"))).toBe(true));
    expect(screen.getByRole("button", { name: "Publish task" })).toBeInTheDocument();
  });
});

describe("the student's quiz", () => {
  const student: UserContext = { ...teacher, geniusId: "s1", userId: "s1", name: "Sam", role: "student" };
  const items = [
    { item_id: "U1", type: "multiple_choice", question_number: 1, stem: "Uploaded one?", options: { A: "a", B: "b", C: "c", D: "d" } },
    { item_id: "U1_confidence", type: "confidence_check", stem: "How confident are you about your answer?", options: { A: "Not at all", B: "Somewhat", C: "Mostly", D: "Very" } },
  ];
  beforeEach(() => {
    quizStatus = { lesson_number: 1, status: "published" };
    const lessonFile = getLesson(1);
    served = { lesson: lessonFile };
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/task-quiz/student")) { log.push(`GET ${url}`); return served.student as Response; }
      if (url.startsWith("/api/student-answers")) return reply({ answer: null });
      if (url.startsWith("/api/surveys")) return reply({ surveys: [] });
      return base(input, init);
    });
  });

  it("answers the task's quiz, and never asks the lesson route", async () => {
    served.student = reply({ items });
    render(<StudentQuizView user={student} />);
    expect(await screen.findByText("Uploaded one?")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "How confident are you about your answer?" })).toBeInTheDocument();
    expect(log.some((line) => line.includes("/api/lessons/"))).toBe(false);
  });

  it("reads the lesson for a task published the old way", async () => {
    served.student = reply({ items: null });
    render(<StudentQuizView user={student} />);
    await waitFor(() => expect(log.some((line) => line.startsWith("GET /api/lessons/1?"))).toBe(true));
    expect(screen.queryByText("Uploaded one?")).toBeNull();
  });

  it("shows an error, and doesn't fall back to the lesson, when the quiz can't be read", async () => {
    served.student = reply({ error: "Unable to verify class access." }, 503);
    render(<StudentQuizView user={student} />);
    expect(await screen.findByText(/Unable to verify class access/)).toBeInTheDocument();
    expect(log.some((line) => line.includes("/api/lessons/"))).toBe(false);
  });
});

describe("inside the GENIUS iframe", () => {
  it.each([
    "/api/task-quiz?classId=g&assignmentId=t",
    "/api/task-quiz/upload?classId=g&assignmentId=t&fileName=a.docx",
    "/api/task-quiz/publish",
    "/api/lessons/1?classId=g&assignmentId=t",
  ])("sends the teacher's token with %s", async (url) => {
    const scope = { classId: "g", assignmentId: "t" };
    setVerifiedClientAuth("host-token", { ...teacher, ...scope });
    const transport = vi.fn(async () => reply({}));
    vi.stubGlobal("fetch", transport);
    await scopedTaskFetch(scope, url);
    const sent = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(sent[1]?.headers).get("Authorization")).toBe("Bearer host-token");
  });

  it("doesn't send it to the open lesson route with no task", async () => {
    const scope = { classId: "g", assignmentId: "t" };
    setVerifiedClientAuth("host-token", { ...teacher, ...scope });
    const transport = vi.fn(async () => reply({}));
    vi.stubGlobal("fetch", transport);
    await scopedTaskFetch(scope, "/api/lessons/1");
    const sent = transport.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(new Headers(sent[1]?.headers).get("Authorization")).toBeNull();
  });
});
