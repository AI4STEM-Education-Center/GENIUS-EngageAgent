// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentInterestsPanel from "@/app/components/StudentInterestsPanel";
import { aggregateDailyExperiences, type SurveyAnalysisRecord } from "@/lib/daily-experience-analysis";
import { toTaskInterests } from "@/lib/task-interests";
import { expectedExtractions, expectedGrouping } from "../fixtures/daily-experience";

const record = (extractions = expectedExtractions): SurveyAnalysisRecord => ({
  class_id: "class", assignment_id: "assignment", survey_id: "survey-daily",
  daily_experience_topic: "Activities", model: "gpt-4o-mini", analyzed_at: "2026-10-06T15:00:00.000Z",
  summary: aggregateDailyExperiences(extractions, expectedGrouping), students: {}, grouping: expectedGrouping,
});

let responses: { ok: boolean; body: unknown }[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  responses = [{ ok: true, body: { interests: toTaskInterests(record()) } }];
  fetchMock = vi.fn(async () => {
    const next = responses.length > 1 ? responses.shift()! : responses[0];
    return { ok: next.ok, json: async () => next.body };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderPanel = () => render(<StudentInterestsPanel classId="class" assignmentId="assignment" />);

it("loads the task's interests automatically, with no button to press", async () => {
  renderPanel();
  expect(screen.getByText("Checking for new responses…")).toBeTruthy();

  expect(await screen.findByText("Soccer")).toBeTruthy();
  expect(screen.getByText("Most common")).toBeTruthy();
  expect(screen.getByText("10 students · 6 do it · 4 watched")).toBeTruthy();
  expect(screen.getByText("Basketball")).toBeTruthy();
  expect(screen.getByText("7 students · 4 do it · 3 watched")).toBeTruthy();
  expect(screen.getByText(/ball, goal, cleats, cones, gloves/)).toBeTruthy();
  expect(screen.getByText(/Shin guard cracked/)).toBeTruthy();
  expect(screen.getByText(/Cooking \(3\), Video games \(3\), Skateboarding \(3\), Swimming \(2\)/)).toBeTruthy();
  expect(screen.getByText(/2 with no clear activity/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(fetchMock).toHaveBeenCalledWith("/api/survey-analysis?classId=class&assignmentId=assignment");
});

it("waits for submissions before showing anything", async () => {
  responses = [{ ok: true, body: { interests: null } }];
  renderPanel();
  expect(await screen.findByText("Results appear here once students submit the survey.")).toBeTruthy();
});

it("explains when there are too few responses to rank", async () => {
  responses = [{ ok: true, body: { interests: toTaskInterests(record(expectedExtractions.slice(0, 2))) } }];
  renderPanel();
  expect(await screen.findByText(/Not enough responses yet/)).toBeTruthy();
  expect(screen.queryByText("Most common")).toBeNull();
});

it("says when it's showing the last result because newer responses couldn't be analyzed", async () => {
  responses = [{ ok: true, body: { interests: toTaskInterests(record(), true) } }];
  renderPanel();
  expect(await screen.findByText(/newer responses couldn't be analyzed yet/)).toBeTruthy();
  expect(screen.getByText("Soccer")).toBeTruthy();
});

it("shows an error with Try again when the first analysis fails", async () => {
  responses = [
    { ok: false, body: { error: "Student interests could not be analyzed right now. Please try again." } },
    { ok: true, body: { interests: toTaskInterests(record()) } },
  ];
  renderPanel();
  expect(await screen.findByText("Student interests could not be analyzed right now. Please try again.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Soccer")).toBeTruthy();
});
