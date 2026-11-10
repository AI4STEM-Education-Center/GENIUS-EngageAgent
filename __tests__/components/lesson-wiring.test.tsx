// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { emptyDraftQuizItem, lessonFromDraft } from "@/lib/lessons";
import { useTaskLesson } from "@/lib/lesson-client";
import { MisconceptionId } from "@/lib/misconceptions";
import { getAllLessons, getLesson } from "@/lib/quiz-data";
import TeacherDashboardView from "@/app/components/TeacherDashboardView";
import TeacherView from "@/app/components/TeacherView";
import StudentQuizView from "@/app/components/StudentQuizView";
import type { Lesson } from "@/lib/types";

// The browser side of stored lessons (#175): the real components and lesson
// loading, with the server answering through a fake fetch.
const teacher: UserContext = { geniusId: "t1", userId: "t1", name: "Ana", email: null, role: "teacher", classId: "ea-class-1", assignmentId: "ea-task-1" };
const taskQuery = "classId=ea-class-1&assignmentId=ea-task-1";
const [MC1, MC2] = [MisconceptionId.NoVisibleDamageMeansWeakForce, MisconceptionId.HeavierAlwaysCausesMoreDamage];
const nine = lessonFromDraft({
  title: "Waves", objective: "Objective of nine", topic: "Waves topic", targetConcept: "c", coreIdeas: ["Idea of nine"], misconceptions: [MC1, MC2],
  quizItems: ["n1", "n2", "n3", "n4"].map((id) => ({
    ...emptyDraftQuizItem(id), stem: `Stem ${id}`, options: { A: "right", B: "two", C: "one", D: "none" }, correct: "A" as const,
    matchedMisconception: MC1, explanation: "e", wrongOptionMisconceptions: { B: [MC1, MC2], C: [MC2] },
  })),
}, 9);
const pinnedOne: Lesson = { ...getAllLessons()[0], lesson_title: "Lesson 1 as pinned", learning_objective: "Objective as pinned", core_ideas: ["Pinned idea"] };

let served: Record<number, Lesson | null>;
let quizStatus: { lesson_number: number; status: string } | null;
let answers: unknown[];
let saveFails: boolean;
let log: string[];

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

beforeEach(() => {
  localStorage.clear();
  served = { 1: pinnedOne, 9: nine };
  quizStatus = null; answers = []; saveFails = false; log = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    log.push(`${init?.method ?? "GET"} ${input}`);
    if (input.startsWith("/api/lessons?")) return reply({ lessons: [
      { lessonNumber: 1, title: "Lesson 1 as pinned", version: 1, questionCount: 4 },
      { lessonNumber: 9, title: "Waves", version: 1, questionCount: 4 },
    ] });
    const number = /^\/api\/lessons\/(\d+)/u.exec(input)?.[1];
    if (number) {
      const lesson = served[Number(number)];
      return lesson ? reply({ ...lesson, lesson_version: 1 }) : reply({ error: `Lesson ${number} not found.` }, false);
    }
    if (input === "/api/quiz-status" && init?.method === "POST") {
      if (saveFails) return reply({ error: "nope" }, false);
      const { lessonNumber, status } = JSON.parse(String(init.body));
      quizStatus = { lesson_number: lessonNumber, status };
      return reply({ quizStatus });
    }
    if (input.startsWith("/api/quiz-status")) return reply({ quizStatus });
    if (input.startsWith("/api/student-answers")) return reply({ answers });
    if (input.startsWith("/api/material-gallery")) return reply({ items: [] });
    if (input.startsWith("/api/slides?")) return reply({ lessons: [] });
    if (input.startsWith("/api/surveys")) return reply({ surveys: [] });
    return reply({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const answersFor = (lessonNumber: number, chosen: Record<string, string>) => [{
  student_id: "s1", student_name: "Sam", class_id: teacher.classId, assignment_id: teacher.assignmentId, lesson_number: lessonNumber, answers: chosen, submitted_at: "2026-11-01T00:00:00Z",
}];

it("offers the lessons the server lists, with titles and question counts, using the task's address", async () => {
  render(<TeacherView user={teacher} />);
  expect(await screen.findByRole("button", { name: /Waves\s*4 questions/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Lesson 1 as pinned\s*4 questions/ })).toBeInTheDocument();
  expect(log).toContain(`GET /api/lessons?${taskQuery}`);
  expect(screen.queryByRole("button", { name: /Lesson 2\b/ })).toBeNull();
});

it("saves the choice before loading the lesson, so it loads at the version the task was just tied to", async () => {
  render(<TeacherView user={teacher} />);
  fireEvent.click(await screen.findByRole("button", { name: /Waves/ }));
  expect(await screen.findByText("Objective of nine")).toBeInTheDocument();
  expect(await screen.findByText("Stem n1")).toBeInTheDocument();
  const saved = log.indexOf("POST /api/quiz-status"), loaded = log.indexOf(`GET /api/lessons/9?${taskQuery}`);
  expect(saved).toBeGreaterThanOrEqual(0);
  expect(loaded).toBeGreaterThan(saved);
  expect(getLesson(9)?.lesson_title).toBe("Waves");
});

it("shows lesson 9 in the strategy step, with a wrong answer counted toward both its misconceptions", async () => {
  quizStatus = { lesson_number: 9, status: "published" };
  answers = answersFor(9, { n1: "B", n2: "A", n3: "A", n4: "D" });
  render(<TeacherView user={teacher} />);
  await screen.findByText("Objective of nine");
  fireEvent.click(within(screen.getByRole("navigation", { name: "Teacher steps" })).getByRole("button", { name: /Strategy/ }));
  const list = await screen.findByRole("list", { name: "Incorrect answers by misconception" });
  await waitFor(() => expect(within(list).getAllByText("1 of 2")).toHaveLength(3));
  expect(within(list).getByText(MC1)).toBeInTheDocument();
  expect(within(list).getByText(MC2)).toBeInTheDocument();
  expect(within(list).getByText("Not tied to a listed misconception")).toBeInTheDocument();
});

it("reads a pinned lesson's version, not the file, wherever the page uses it", async () => {
  quizStatus = { lesson_number: 1, status: "draft" };
  render(<TeacherView user={teacher} />);
  expect(await screen.findByText("Objective as pinned")).toBeInTheDocument();
  expect(log).toContain(`GET /api/lessons/1?${taskQuery}`);
  expect(getLesson(1)?.core_ideas).toEqual(["Pinned idea"]);
  expect(screen.queryByText(getAllLessons()[0].learning_objective)).toBeNull();
});

it("says so when a lesson can't load, and doesn't fall back to the lesson file", async () => {
  served[1] = null;
  quizStatus = { lesson_number: 1, status: "published" };
  render(<TeacherView user={teacher} />);
  expect(await screen.findByText("Lesson 1 not found.")).toBeInTheDocument();
  expect(screen.queryByText(getAllLessons()[0].learning_objective)).toBeNull();
  expect(screen.queryByText(getAllLessons()[0].quiz_items[0].stem)).toBeNull();
});

it("says so when choosing a lesson can't be saved, and doesn't select it", async () => {
  saveFails = true;
  render(<TeacherView user={teacher} />);
  fireEvent.click(await screen.findByRole("button", { name: /Waves/ }));
  expect(await screen.findByText(/couldn't be chosen/)).toBeInTheDocument();
  expect(screen.queryByText("Objective of nine")).toBeNull();
  expect(log.some((line) => line.startsWith("GET /api/lessons/9"))).toBe(false);
});

it("restores a saved focus for lesson 9 instead of dropping it for being above 8", async () => {
  localStorage.setItem(`engage-agent:draft:v3:${teacher.classId}:${teacher.assignmentId}`, JSON.stringify({
    version: 2, classId: teacher.classId, assignmentId: teacher.assignmentId, lessonNumber: 9, currentStep: 2, plan: null, selectedStrategies: ["cognitive conflict"],
    focusByLesson: { 9: { misconceptions: [MC2, "made-up"], coreIdeas: [] } }, annotationDecision: null, annotationReason: "", annotationStatus: "idle", content: [],
  }));
  quizStatus = { lesson_number: 9, status: "published" };
  render(<TeacherView user={teacher} />);
  const focus = await screen.findByRole("checkbox", { name: new RegExp(MC2) }).catch(() => screen.findByRole("radio", { name: new RegExp(MC2) }));
  expect(focus).toBeChecked();
});

it("shows the dashboard's class summary for lesson 9", async () => {
  quizStatus = { lesson_number: 9, status: "published" };
  answers = answersFor(9, { n1: "B", n2: "B", n3: "B", n4: "B" });
  render(<TeacherDashboardView user={teacher} />);
  expect(await screen.findByText(/answered the Lesson 9 quiz/)).toBeInTheDocument();
  expect(log).toContain(`GET /api/lessons/9?${taskQuery}`);
});

it("gives no summary on the dashboard when the lesson can't load, rather than one from the wrong version", async () => {
  served[1] = null;
  quizStatus = { lesson_number: 1, status: "published" };
  answers = answersFor(1, { L1_Q1: "A" });
  render(<TeacherDashboardView user={teacher} />);
  await waitFor(() => expect(log.some((line) => line.startsWith("GET /api/lessons/1"))).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText(/answered the Lesson 1 quiz/)).toBeNull();
});

it("gives a student the task's version of the quiz", async () => {
  quizStatus = { lesson_number: 9, status: "published" };
  render(<StudentQuizView user={{ ...teacher, role: "student" }} />);
  expect(await screen.findByText(/Stem n1/)).toBeInTheDocument();
  expect(log).toContain(`GET /api/lessons/9?${taskQuery}`);
});

function Probe({ lesson, classId = "c1" }: { lesson: number | null; classId?: string }) {
  const { lesson: loaded, error } = useTaskLesson({ classId, assignmentId: "a1" }, lesson);
  return <p>{error || loaded?.lesson_title || "waiting"}</p>;
}

it("never hands back the previous task's or lesson's result while the next one loads", async () => {
  const view = render(<Probe lesson={9} />);
  expect(screen.getByText("waiting")).toBeInTheDocument();
  await screen.findByText("Waves");
  view.rerender(<Probe lesson={9} classId="c2" />);
  expect(screen.getByText("waiting")).toBeInTheDocument();
  await screen.findByText("Waves");
  view.rerender(<Probe lesson={1} classId="c2" />);
  expect(screen.getByText("waiting")).toBeInTheDocument();
  await screen.findByText("Lesson 1 as pinned");
  view.rerender(<Probe lesson={null} classId="c2" />);
  expect(screen.getByText("waiting")).toBeInTheDocument();
});
