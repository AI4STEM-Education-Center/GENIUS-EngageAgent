// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeacherDashboardView from "@/app/components/TeacherDashboardView";
import type { UserContext } from "@/lib/auth";

vi.mock("@/app/components/SurveyResultsSection", () => ({ default: () => null }));
const teacher: UserContext = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher", classId: "ea-class-1", assignmentId: "ea-task-1" };
const slides = { id: "slides-deck", type: "Slides", title: "Published inquiry", strategy: "analogy", body: "",
  slides: { publicationId: "4e96360b-17a4-4a54-84da-df0c5d2ef012", slideCount: 6, lessonNumber: 8 } };
let published: object[];
let failedEndpoints: Set<string>;
let failureMode: "http" | "network";
let questionText: string;
let rating: number;
beforeEach(() => {
  failedEndpoints = new Set(); failureMode = "http";
  questionText = "How could we test this idea?"; rating = 4;
  published = [{ content_item_id: slides.id, content_json: JSON.stringify(slides), published_at: "2026-10-07T00:00:00Z", published_by: "teacher" }];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (failedEndpoints.has(input.split("?")[0])) {
      if (failureMode === "network") throw new Error("Network unavailable");
      return { ok: false, json: async () => ({ error: "Service unavailable" }) };
    }
    return { ok: true, json: async () => {
    if (input.startsWith("/api/content-publish")) return { items: published };
    if (input.startsWith("/api/student-answers")) return { answers: [{ student_id: "s1", student_name: "Student One", submitted_at: "2026-10-07T00:00:00Z" }] };
    if (input.startsWith("/api/content-rating")) return { ratings: [{ student_id: "s1", content_item_id: slides.id, rating }] };
    if (input.startsWith("/api/review-questions")) return { reviewQuestions: [{ student_id: "s1", questions: [questionText] }] };
    return {};
  } };
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("reports a published slide deck without treating its separate slide assets as missing legacy media", async () => {
  render(<TeacherDashboardView user={teacher} />);
  const row = (await screen.findByText("Published inquiry")).closest("tr")!;
  expect(within(row).getByText("6 slides published")).toBeTruthy();
  expect(within(row).queryByText(/Image missing|Video missing/)).toBeNull();
  expect(within(row).getByText("4.0 / 5")).toBeTruthy();
  expect(await screen.findByText("How could we test this idea?")).toBeTruthy();
});

it("does not claim an invalid slide reference is published and preserves legacy media reporting", async () => {
  published = [
    { content_item_id: "broken", content_json: JSON.stringify({ ...slides, title: "Broken reference", slides: { ...slides.slides, publicationId: "invalid" } }) },
    { content_item_id: "legacy", content_json: JSON.stringify({ type: "Image", title: "Legacy material", body: "" }) },
  ];
  render(<TeacherDashboardView user={teacher} />);
  const broken = (await screen.findByText("Broken reference")).closest("tr")!;
  expect(within(broken).getByText("Slide reference unavailable")).toBeTruthy();
  expect(within(broken).queryByText("6 slides published")).toBeNull();
  const legacy = screen.getByText("Legacy material").closest("tr")!;
  expect(within(legacy).getByText("Image missing")).toBeTruthy();
  expect(within(legacy).getByText("Video missing")).toBeTruthy();
});

it.each(["http", "network"] as const)("preserves received feedback on a %s failure while updating successful sources and permits retry", async mode => {
  render(<TeacherDashboardView user={teacher} />);
  await screen.findByText("How could we test this idea?");
  failedEndpoints = new Set(["/api/review-questions", "/api/student-answers"]);
  failureMode = mode; rating = 5; questionText = "What changes if we try again?";
  fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
  await screen.findByText(/Some dashboard data could not be refreshed/);
  expect(screen.getByText("How could we test this idea?")).toBeTruthy();
  expect(screen.getByText("5.0 / 5")).toBeTruthy();
  expect(screen.getAllByText("Student One")).toHaveLength(2);
  expect(screen.queryByText("Student submissions appear here after the quiz is completed.")).toBeNull();
  failedEndpoints.clear();
  fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
  await screen.findByText("What changes if we try again?");
  expect(screen.queryByText(/Some dashboard data could not be refreshed/)).toBeNull();
});

it("keeps newer polled feedback when an older manual refresh finishes afterward", async () => {
  vi.useFakeTimers();
  await act(async () => { render(<TeacherDashboardView user={teacher} />); });
  expect(screen.getByText("4.0 / 5")).toBeTruthy();
  const fetchMock = vi.mocked(fetch);
  const originalFetch = fetchMock.getMockImplementation()!;
  let release: (response: unknown) => void = () => {};
  let holdFirstRating = true;
  fetchMock.mockImplementation((input, init) => {
    if (String(input).startsWith("/api/content-rating") && holdFirstRating) {
      holdFirstRating = false;
      return new Promise(resolve => { release = value => resolve(value as Response); });
    }
    return originalFetch(input, init);
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
  rating = 5;
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByText("5.0 / 5")).toBeTruthy();
  await act(async () => {
    release({ ok: true, json: async () => ({ ratings: [{ student_id: "s1", content_item_id: slides.id, rating: 1 }] }) });
  });
  expect(screen.getByText("5.0 / 5")).toBeTruthy();
  expect(screen.queryByText("1.0 / 5")).toBeNull();
});
