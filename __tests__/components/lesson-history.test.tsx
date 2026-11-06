// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LessonHistory from "@/app/components/lessons/LessonHistory";
import { emptyDraftQuizItem, type LessonChanges, type LessonDraftContent } from "@/lib/lessons";
import { MisconceptionId } from "@/lib/misconceptions";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), goTo: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => ({ user: { geniusId: "t", userId: "t", name: "Ana", email: null, role: "teacher" }, loading: false, error: null }) }));
vi.mock("@/app/components/lessons/lesson-ui", async (original) => ({ ...await original<typeof import("@/app/components/lessons/lesson-ui")>(), goTo: mocks.goTo }));

const MC1 = MisconceptionId.NoVisibleDamageMeansWeakForce, MC2 = MisconceptionId.HeavierAlwaysCausesMoreDamage;
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const versionRow = (version: number, over = {}) => ({
  lessonId: "l", lessonNumber: 3, version, status: "published", title: "Forces", publishedBy: { id: "t", name: `Teacher ${version}` },
  publishedAt: "2026-03-04T15:00:00Z", changeNote: `Note ${version}`, taskCount: version === 1 ? 2 : 0, ...over,
});
const content: LessonDraftContent = {
  title: "Forces", objective: "Understand", topic: "Motion", targetConcept: "Pairs", coreIdeas: ["Forces pair up"], misconceptions: [MC1],
  quizItems: [{
    ...emptyDraftQuizItem("q1"), stem: "Which?", image: "/api/lessons/images/abc.png", options: { A: "One", B: "Two", C: "Three", D: "Four" }, correct: "A",
    matchedMisconception: MC1, wrongOptionMisconceptions: { B: [MC1] }, explanation: "Because",
  }],
};
const changes: LessonChanges = {
  basics: [{ field: "Lesson title", before: "Old", after: "Forces" }],
  coreIdeas: { added: ["New idea"], removed: ["Gone idea"], changed: [{ before: "Was this", after: "Is this" }], reordered: true },
  misconceptions: { added: [MC1], removed: [MC2] },
  quizItems: {
    added: [{ id: "q9", number: 5, stem: "Added stem" }], removed: [{ id: "q8", stem: "Removed stem" }],
    changed: [{ id: "q1", number: 1, stem: "Which?", changes: [
      { field: "Option A", before: "Uno", after: "One" }, { field: "Correct answer", before: "B", after: "A" },
      { field: "Option B misconceptions", before: "None", after: "MC01" }, { field: "Matched misconception", before: "MC02", after: "MC01" },
    ] }],
    reordered: true,
  },
  hasChanges: true,
};
let routes: Record<string, () => unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.goTo.mockReset();
  routes = {
    "/api/lessons/3/versions": () => reply({ versions: [versionRow(2), versionRow(1)] }),
    "/api/lessons/3/draft": () => reply({ error: "This lesson has no draft." }, 404),
    "/api/lessons/3/versions/2": () => reply({ ...versionRow(2), content, previousVersion: 1, changes }),
    "/api/lessons/3/versions/1": () => reply({ ...versionRow(1), content, previousVersion: null, changes: null }),
    "/api/lessons/3/versions/1/tasks": () => reply({ tasks: [
      { classId: "c1", assignmentId: "a1", teacher: { id: "t", name: "Ana" }, className: "Physics", taskTitle: "Collisions", quizPublished: true },
      { classId: "c2", assignmentId: "a2", teacher: { id: "u", name: "Bo" }, className: null, taskTitle: null, quizPublished: false },
    ] }),
    "/api/lessons/3/versions/2/tasks": () => reply({ tasks: [] }),
  };
  fetchMock = vi.fn(async (url: string) => routes[url]?.() ?? reply({ error: "no route" }, 500));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const version = async (n: number) => (await screen.findByRole("heading", { name: `Version ${n}` })).closest("li") as HTMLElement;

it("lists versions newest first, each with number, status, who, when, note and tasks", async () => {
  render(<LessonHistory lessonNumber={3} />);
  const two = within(await version(2));
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Version 2", "Version 1"]);
  expect(two.getByText("Published")).toBeTruthy();
  expect(two.getByText("Current")).toBeTruthy();
  expect(two.getByText(/^Published by Teacher 2 on Mar 4, 2026/)).toBeTruthy();
  expect(two.getByText("Note 2")).toBeTruthy();
  expect(two.getByText("No tasks using it")).toBeTruthy();
  const one = within(await version(1));
  expect(one.queryByText("Current")).toBeNull();
  expect(one.getByText("2 tasks using it")).toBeTruthy();
  expect(screen.getByText("Lesson 3: Forces")).toBeTruthy();
});

it("opens a version read-only, with every field and no way to change it", async () => {
  render(<LessonHistory lessonNumber={3} />);
  const row = within(await version(1));
  const open = row.getByRole("button", { name: "Open" });
  expect(open.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(open);
  await row.findByText("Understand");
  expect(open.getAttribute("aria-expanded")).toBe("true");
  for (const text of ["Motion", "Pairs", "Forces pair up", "One", "Two", "Because", "Correct answer"]) expect(row.getByText(text)).toBeTruthy();
  expect(row.getByText("MC01")).toBeTruthy();
  expect(row.getByText("Which?", { exact: false })).toBeTruthy();
  expect(row.getByText("(MC01)")).toBeTruthy();
  expect(row.getByRole("img", { name: "Picture for question 1" }).getAttribute("src")).toBe("/api/lessons/images/abc.png");
  expect(row.getByText(/How confident are you about your answer/)).toBeTruthy();
  const panel = document.getElementById(open.getAttribute("aria-controls")!)!;
  expect(panel.querySelectorAll("input,textarea,select").length).toBe(0);
  fireEvent.click(open);
  expect(row.queryByText("Understand")).toBeNull();
});

it('"Compare with previous" shows the field-by-field diff', async () => {
  render(<LessonHistory lessonNumber={3} />);
  const row = within(await version(2));
  fireEvent.click(row.getByRole("button", { name: "Compare with previous" }));
  await row.findByText("What changed from version 1 to version 2");
  const text = (await version(2)).textContent!;
  for (const expected of ["Lesson title: ", "Old", "Added: New idea", "Removed: Gone idea", "Was this", "Is this",
    "Added: MC01: If nothing looks damaged", "Removed: MC02: Heavier objects", "Added Q5: Added stem", "Removed: Removed stem", "Changed Q1: Which?",
    "Option A: ", "Uno", "Correct answer: ", "Option B misconceptions: ", "Matched misconception: "]) {
    expect(text).toContain(expected);
  }
  expect(row.getAllByText("The order changed.")).toHaveLength(2);
  expect(row.getByText("Uno").tagName).toBe("DEL");
});

it("has nothing to compare version 1 with", async () => {
  render(<LessonHistory lessonNumber={3} />);
  const row = within(await version(1));
  expect(row.queryByRole("button", { name: "Compare with previous" })).toBeNull();
});

it("says when two versions are the same", async () => {
  routes["/api/lessons/3/versions/2"] = () => reply({ ...versionRow(2), content, previousVersion: 1, changes: { ...changes, hasChanges: false } });
  render(<LessonHistory lessonNumber={3} />);
  const row = within(await version(2));
  fireEvent.click(row.getByRole("button", { name: "Compare with previous" }));
  expect(await row.findByText("Nothing changed between these two versions.")).toBeTruthy();
});

it('"Show tasks" lists class, GENIUS lesson, teacher, and whether the quiz is published', async () => {
  render(<LessonHistory lessonNumber={3} />);
  const row = within(await version(1));
  fireEvent.click(row.getByRole("button", { name: "Show tasks" }));
  const list = within(await row.findByRole("list", { name: "Tasks using this version" }));
  const [first, second] = list.getAllByRole("listitem");
  for (const text of ["Class", "Physics", "GENIUS lesson", "Collisions", "Teacher", "Ana", "Quiz", "Published"]) expect(within(first).getByText(text)).toBeTruthy();
  // A class or task with no name here still identifies itself.
  for (const text of ["c2", "a2", "Bo", "Not published"]) expect(within(second).getByText(text)).toBeTruthy();
});

it("says when no tasks use a version", async () => {
  render(<LessonHistory lessonNumber={3} />);
  const row = within(await version(2));
  fireEvent.click(row.getByRole("button", { name: "Show tasks" }));
  expect(await row.findByText("No tasks use this version.")).toBeTruthy();
});

it("shows a failure inside the panel, with a way to try again", async () => {
  routes["/api/lessons/3/versions/1/tasks"] = () => reply({ error: "Lessons are unavailable right now." }, 503);
  render(<LessonHistory lessonNumber={3} />);
  const row = within(await version(1));
  fireEvent.click(row.getByRole("button", { name: "Show tasks" }));
  expect((await row.findByRole("alert")).textContent).toContain("Lessons are unavailable");
  routes["/api/lessons/3/versions/1/tasks"] = () => reply({ tasks: [] });
  fireEvent.click(row.getByRole("button", { name: "Try again" }));
  expect(await row.findByText("No tasks use this version.")).toBeTruthy();
});

it("lists a draft on top, as a draft", async () => {
  routes["/api/lessons/3/draft"] = () => reply({ draft: { version: 3, content, updatedBy: { id: "b", name: "Bo" }, updatedAt: "2026-03-05T15:00:00Z" } });
  render(<LessonHistory lessonNumber={3} />);
  const draft = within(await version(3));
  expect(draft.getByText("Draft")).toBeTruthy();
  expect(draft.getByText(/^Last saved by Bo on Mar 5, 2026/)).toBeTruthy();
  expect(draft.queryByRole("button", { name: "Open" })).toBeNull();
  expect(screen.getAllByRole("heading", { level: 2 })[0].textContent).toBe("Version 3");
});

it("handles a lesson that was never published", async () => {
  routes["/api/lessons/3/versions"] = () => reply({ versions: [] });
  routes["/api/lessons/3/draft"] = () => reply({ draft: { version: 1, content: { ...content, title: "Mine" }, updatedBy: { id: "b", name: "Bo" }, updatedAt: "2026-03-05T15:00:00Z" } });
  render(<LessonHistory lessonNumber={3} />);
  expect(await screen.findByText("Lesson 3: Mine")).toBeTruthy();
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Version 1"]);
});

it("Edit opens the form after starting a draft on the server, and reports a failure", async () => {
  render(<LessonHistory lessonNumber={3} />);
  await version(2);
  routes["/api/lessons/3/draft"] = () => reply({ error: "Lesson not found." }, 404);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Lesson not found.");
  expect(mocks.goTo).not.toHaveBeenCalled();
  routes["/api/lessons/3/draft"] = () => reply({ draft: { version: 3 } });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await waitFor(() => expect(mocks.goTo).toHaveBeenCalledWith("/teacher/lessons/3/edit"));
});

it("shows a load failure with a way to try again, and doesn't treat a real draft failure as no draft", async () => {
  routes["/api/lessons/3/draft"] = () => reply({ error: "Lessons are unavailable right now." }, 503);
  render(<LessonHistory lessonNumber={3} />);
  expect((await screen.findByRole("alert")).textContent).toContain("Lessons are unavailable");
  routes["/api/lessons/3/draft"] = () => reply({ error: "This lesson has no draft." }, 404);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await version(2);
  expect(screen.queryByRole("alert")).toBeNull();
});
