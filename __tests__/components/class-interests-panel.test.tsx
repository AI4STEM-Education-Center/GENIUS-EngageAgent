// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ClassInterestsPanel from "@/app/components/ClassInterestsPanel";
import { aggregateDailyExperiences } from "@/lib/daily-experience-analysis";
import { expectedExtractions, expectedGrouping } from "../fixtures/daily-experience";

const summary = aggregateDailyExperiences(expectedExtractions, expectedGrouping);
const saved = { analyzedAt: "2026-10-06T15:00:00.000Z", summary };

let getBody: { analysis: unknown; submittedCount: number };
let postResult: { ok: boolean; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getBody = { analysis: null, submittedCount: 20 };
  postResult = { ok: true, body: { analysis: saved, submittedCount: 20 } };
  fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
    init?.method === "POST"
      ? { ok: postResult.ok, json: async () => postResult.body }
      : { ok: true, json: async () => getBody });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderPanel = () => render(<ClassInterestsPanel classId="class" assignmentId="assignment" surveyId="survey-daily" />);

it("offers to analyze when there is no saved analysis yet", async () => {
  renderPanel();
  expect(await screen.findByText("20 responses ready to analyze.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Analyze responses" }) as HTMLButtonElement).disabled).toBe(false);
});

it("disables Analyze until students submit", async () => {
  getBody = { analysis: null, submittedCount: 0 };
  renderPanel();
  expect(await screen.findByText("Students haven't submitted this survey yet.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Analyze responses" }) as HTMLButtonElement).disabled).toBe(true);
});

it("runs the analysis and shows the top two activities with counts, objects and an example", async () => {
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: "Analyze responses" }));

  expect(await screen.findByText("Soccer")).toBeTruthy();
  expect(screen.getByText("Most common")).toBeTruthy();
  expect(screen.getByText("10 students · 6 do it · 4 watched")).toBeTruthy();
  expect(screen.getByText("Basketball")).toBeTruthy();
  expect(screen.getByText("7 students · 4 do it · 3 watched")).toBeTruthy();
  expect(screen.getByText(/ball, goal, cleats, cones, gloves/)).toBeTruthy();
  expect(screen.getByText(/Shin guard cracked/)).toBeTruthy();
  expect(screen.getByText(/Cooking \(3\), Video games \(3\), Skateboarding \(3\), Swimming \(2\)/)).toBeTruthy();
  expect(screen.getByText(/2 with no clear activity/)).toBeTruthy();

  const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
  expect(JSON.parse(String(init.body))).toEqual({ classId: "class", assignmentId: "assignment", surveyId: "survey-daily" });
  expect(screen.getByRole("button", { name: "Re-analyze responses" })).toBeTruthy();
});

it("flags responses submitted since the saved analysis", async () => {
  getBody = { analysis: saved, submittedCount: 23 };
  renderPanel();
  expect(await screen.findByText(/3 new responses since this analysis/)).toBeTruthy();
});

it("keeps the previous analysis visible when re-analyzing fails", async () => {
  getBody = { analysis: saved, submittedCount: 20 };
  postResult = { ok: false, body: { error: "The analysis could not be completed. Please try again." } };
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: "Re-analyze responses" }));

  expect(await screen.findByText("The analysis could not be completed. Please try again.")).toBeTruthy();
  expect(screen.getByText("Soccer")).toBeTruthy();
});

it("explains when there are too few responses to rank", async () => {
  getBody = { analysis: { ...saved, summary: aggregateDailyExperiences(expectedExtractions.slice(0, 2), expectedGrouping) }, submittedCount: 2 };
  renderPanel();
  expect(await screen.findByText(/Not enough responses yet/)).toBeTruthy();
  expect(screen.queryByText("Most common")).toBeNull();
});
