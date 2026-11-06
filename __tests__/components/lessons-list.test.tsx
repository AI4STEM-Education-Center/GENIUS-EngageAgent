// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LessonsList from "@/app/components/lessons/LessonsList";
import type { LessonListRow } from "@/lib/lessons-store";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), goTo: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/app/components/lessons/lesson-ui", async (original) => ({ ...await original<typeof import("@/app/components/lessons/lesson-ui")>(), goTo: mocks.goTo }));

const teacher = { geniusId: "t1", userId: "t1", name: "Ana", email: null, role: "teacher" };
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const row = (over: Partial<LessonListRow>): LessonListRow => ({
  lessonId: "l", lessonNumber: 1, title: "Forces", createdBy: { id: "x", name: "EngageAgent" }, createdAt: "2026-01-01T12:00:00Z",
  currentVersion: 2, currentPublishedAt: "2026-03-04T12:00:00Z", draftVersion: null, draftUpdatedAt: null, tasksByVersion: {}, ...over,
});
const rows = [
  row({ lessonId: "a", lessonNumber: 1, title: "Forces", tasksByVersion: { 1: 3, 2: 1 } }),
  row({ lessonId: "b", lessonNumber: 2, title: "Energy", draftVersion: 3, draftUpdatedAt: "2026-03-05T12:00:00Z" }),
  row({ lessonId: "c", lessonNumber: 9, title: "", currentVersion: null, currentPublishedAt: null, draftVersion: 1, createdBy: { id: "t", name: "Bo" } }),
];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.auth = { user: teacher, loading: false, error: null };
  mocks.replace.mockReset(); mocks.goTo.mockReset();
  fetchMock = vi.fn(async () => reply({ lessons: rows }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const rowOf = async (name: RegExp) => (await screen.findByRole("heading", { name })).closest("li") as HTMLElement;

it("shows each row as the use case describes", async () => {
  render(<LessonsList />);
  const forces = within(await rowOf(/^Forces$/));
  expect(forces.getByText(/^Version 2 · Published Mar \d, 2026$/)).toBeTruthy();
  expect(forces.getByText("Created by EngageAgent")).toBeTruthy();
  expect(forces.getByText("Version 2: 1 task · Version 1: 3 tasks")).toBeTruthy();
  expect(forces.queryByText("Draft")).toBeNull();
  expect(forces.queryByText("Draft only")).toBeNull();
  expect(forces.getByRole("button", { name: "Edit Lesson 1: Forces" })).toBeTruthy();
  expect(forces.getByRole("link", { name: "History of Lesson 1: Forces" }).getAttribute("href")).toBe("/teacher/lessons/1/history");
});

it('shows "Draft" when a published lesson has a draft', async () => {
  render(<LessonsList />);
  const energy = within(await rowOf(/^Energy$/));
  expect(energy.getByText("Draft")).toBeTruthy();
  expect(energy.queryByText("Draft only")).toBeNull();
  expect(energy.getByText("No tasks yet")).toBeTruthy();
});

it('shows "Draft only" and no version for a lesson that was never published', async () => {
  render(<LessonsList />);
  const draft = within(await rowOf(/^Untitled lesson$/));
  expect(draft.getByText("Draft only")).toBeTruthy();
  expect(draft.queryByText("Draft")).toBeNull();
  expect(draft.getByText("Not published yet")).toBeTruthy();
  expect(draft.getByText("Created by Bo")).toBeTruthy();
});

it('"New lesson" adds one and opens its form', async () => {
  render(<LessonsList />);
  await rowOf(/^Forces$/);
  fetchMock.mockResolvedValueOnce(reply({ row: { lessonNumber: 12 }, draft: {} }, 201));
  fireEvent.click(screen.getByRole("button", { name: "New lesson" }));
  await waitFor(() => expect(mocks.goTo).toHaveBeenCalledWith("/teacher/lessons/12/edit"));
  expect(fetchMock.mock.calls.at(-1)).toMatchObject(["/api/lessons", { method: "POST" }]);
});

it('"Edit" opens the draft or starts one on the server, then opens the form', async () => {
  render(<LessonsList />);
  const forces = within(await rowOf(/^Forces$/));
  fetchMock.mockResolvedValueOnce(reply({ draft: { version: 3 } }));
  fireEvent.click(forces.getByRole("button", { name: /^Edit/ }));
  await waitFor(() => expect(mocks.goTo).toHaveBeenCalledWith("/teacher/lessons/1/edit"));
  expect(fetchMock.mock.calls.at(-1)).toMatchObject(["/api/lessons/1/draft", { method: "POST" }]);
});

it("says so when adding or editing fails, and stays on the list", async () => {
  render(<LessonsList />);
  const forces = within(await rowOf(/^Forces$/));
  fetchMock.mockResolvedValueOnce(reply({ error: "Couldn't add the lesson." }, 503));
  fireEvent.click(screen.getByRole("button", { name: "New lesson" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Couldn't add the lesson.");
  fetchMock.mockResolvedValueOnce(reply({ error: "Lesson not found." }, 404));
  fireEvent.click(forces.getByRole("button", { name: /^Edit/ }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Lesson not found."));
  expect(mocks.goTo).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "New lesson" }) as HTMLButtonElement).disabled).toBe(false);
});

it("shows loading, then a failure with a way to try again", async () => {
  let resolve: (value: unknown) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<LessonsList />);
  expect(screen.getByRole("status").textContent).toBe("Loading lessons...");
  resolve(reply({ error: "Lessons are unavailable right now. Please try again." }, 503));
  expect((await screen.findByRole("alert")).textContent).toContain("Lessons are unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await rowOf(/^Forces$/);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("handles a network failure and a reply that isn't JSON with a plain message", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("failed"));
  render(<LessonsList />);
  expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach EngageAgent");
  fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error("<html>"); } });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Something went wrong"));
});

it("shows Lessons as the current page in the header", async () => {
  render(<LessonsList />);
  await rowOf(/^Forces$/);
  const link = within(screen.getByRole("navigation", { name: "EngageAgent" })).getByRole("link", { name: "Lessons" });
  expect(link.getAttribute("href")).toBe("/teacher/lessons");
  expect(link.getAttribute("aria-current")).toBe("page");
});

describe("who can see it", () => {
  it("sends a student home and loads nothing", () => {
    mocks.auth = { user: { ...teacher, role: "student" }, loading: false, error: null };
    render(<LessonsList />);
    expect(mocks.replace).toHaveBeenCalledWith("/student/classes");
    expect(screen.queryByRole("heading", { name: "Lessons" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends a guest home too", () => {
    mocks.auth = { user: { ...teacher, role: "guest" }, loading: false, error: null };
    render(<LessonsList />);
    expect(mocks.replace).toHaveBeenCalledWith("/student/classes");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shows the normal sign-in to someone signed out", () => {
    mocks.auth = { user: null, loading: false, error: null };
    render(<LessonsList />);
    expect(screen.getByRole("link", { name: /Sign in with GENIUS/ })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("shows sign-in when the session couldn't be checked", () => {
    mocks.auth = { user: teacher, loading: false, error: "Unable to check" };
    render(<LessonsList />);
    expect(screen.getByRole("alert").textContent).toContain("could not be verified");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("asks a teacher who only has a GENIUS launch to sign in to EngageAgent", () => {
    mocks.auth = { user: teacher, loading: false, error: null, isGeniusEmbed: true };
    render(<LessonsList />);
    expect(screen.getByRole("link", { name: /Sign in with GENIUS/ })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("loads nothing while the session is being checked", () => {
    mocks.auth = { user: null, loading: true, error: null };
    render(<LessonsList />);
    expect(screen.getByRole("status").textContent).toBe("Checking your session...");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
