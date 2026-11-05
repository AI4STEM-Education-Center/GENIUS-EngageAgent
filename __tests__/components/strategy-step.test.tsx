// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StrategyStep from "@/app/components/StrategyStep";
import { engagementStrategies } from "@/lib/engagement-strategies";
import { getLesson } from "@/lib/quiz-data";
import { countClassResponses, recommendStrategy } from "@/lib/strategy-recommendation";
import { EMPTY_FOCUS, lessonFocusMisconceptions, type StrategyFocus } from "@/lib/strategy-focus";
import type { StudentAnswer } from "@/lib/types";

const submission = { L8_Q1: "C", L8_Q2: "C", L8_Q3: "A", L8_Q4: "A" };
const answers: StudentAnswer[] = ["a", "b"].map(id => ({
  student_id: id, student_name: `Student ${id}`, class_id: "ea-class-1", assignment_id: "ea-task-1", lesson_number: 8, answers: submission, submitted_at: "2026-10-14T12:00:00Z",
} as StudentAnswer));
const recommendation = recommendStrategy(8, answers.map(a => a.answers));
const counts = countClassResponses(getLesson(8)!, answers.map(a => a.answers));
const recommendedLabel = "Cognitive Conflict";

const interests = {
  classId: "ea-class-1", assignmentId: "ea-task-1", surveyId: "survey-1", dailyExperienceTopic: "Collisions",
  analyzedAt: "2026-10-14T12:00:00Z", responseCount: 5, unclassifiedCount: 1, enoughResponses: true, stale: false,
  top: [{ activity: "Soccer", category: "Sports", studentCount: 4, doCount: 3, watchedCount: 1, objects: ["ball", "goal"], incidents: ["A ball bounced off a goalpost."] }],
  activities: [
    { activity: "Soccer", category: "Sports", studentCount: 4, doCount: 3, watchedCount: 1, objects: [], incidents: [] },
    { activity: "Cooking", category: "Home", studentCount: 1, doCount: 1, watchedCount: 0, objects: [], incidents: [] },
  ],
};

const fetchMock = vi.fn();
const reply = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });

type Overrides = Partial<ComponentProps<typeof StrategyStep>> & { initialPick?: string | null; initialFocus?: StrategyFocus };
function Harness({ initialPick = null, initialFocus = EMPTY_FOCUS, ...overrides }: Overrides) {
  const [pick, setPick] = useState<string | null>(initialPick);
  const [focus, setFocus] = useState<StrategyFocus>(initialFocus);
  const [reason, setReason] = useState("");
  return <StrategyStep classId="ea-class-1" assignmentId="ea-task-1" lessonNumber={8} quizPublished answers={answers}
    answersError={null} onRetryAnswers={() => {}} recommendation={recommendation} onAnalyze={() => {}} busy={false}
    pick={pick} onPick={setPick} focus={focus} onFocusChange={setFocus} reason={reason} onReasonChange={setReason}
    onUse={() => {}} saveStatus="idle" saveError={null} {...overrides} />;
}
const saved = () => screen.getByText(/^Saved:/).closest("[role=status]")!;
const radio = (name: string) => within(screen.getByRole("radiogroup", { name: "Strategy" })).getByRole("radio", { name });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(reply({ interests }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("calls this step Strategy recommendations (#197)", () => {
  render(<Harness />);
  expect(screen.getByRole("heading", { name: "Strategy recommendations" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Engagement strategy" })).toBeNull();
});

it("shows the quiz answers as bars of wrong answers by misconception", () => {
  render(<Harness />);
  const quiz = screen.getByRole("region", { name: "From the quiz" });
  expect(within(quiz).getByText("2 students")).toBeVisible();
  const percent = Math.round((counts.correct / counts.responses) * 100);
  expect(quiz).toHaveTextContent(`${counts.correct} of ${counts.responses} answers correct (${percent}%)`);
  const rows = within(within(quiz).getByRole("list", { name: "Incorrect answers by misconception" })).getAllByRole("listitem");
  const shown = counts.misconceptions.filter(m => m.count > 0).sort((a, b) => b.count - a.count);
  expect(rows).toHaveLength(shown.length + (counts.unlinked > 0 ? 1 : 0));
  expect(rows[0]).toHaveTextContent(`${shown[0].statement}`);
  expect(rows[0]).toHaveTextContent(`${shown[0].count} of ${counts.incorrect}`);
  const code = lessonFocusMisconceptions(8).find(m => m.code === shown[0].id)!.id!;
  expect(rows[0]).toHaveTextContent(code);
});

it("shows 'No responses yet' and the 0 of N banner only while nobody has submitted", () => {
  const view = render(<Harness answers={[]} recommendation={null} classSize={24} />);
  expect(screen.getByText("0 of 24 submitted")).toHaveAttribute("role", "status");
  expect(within(screen.getByRole("region", { name: "From the quiz" })).getByText("No responses yet")).toBeVisible();
  expect(screen.getByRole("button", { name: "Analyze 0 responses and recommend" })).toBeDisabled();
  view.rerender(<Harness answers={[]} recommendation={null} quizPublished={false} />);
  expect(screen.getByText("Task not published yet")).toBeVisible();
  view.rerender(<Harness />);
  expect(screen.queryByText(/submitted/)).toBeNull();
});

it("loads the check-in card from the survey analysis and lets a failed load be retried", async () => {
  fetchMock.mockResolvedValueOnce(reply({ error: "Analysis is down." }, false));
  render(<Harness />);
  const checkIn = screen.getByRole("region", { name: "From the experience check-in" });
  expect(await within(checkIn).findByRole("alert")).toHaveTextContent("Analysis is down.");
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/survey-analysis?classId=ea-class-1&assignmentId=ea-task-1");
  fireEvent.click(within(checkIn).getByRole("button", { name: "Try again" }));
  expect(await within(checkIn).findByText("Soccer")).toBeVisible();
  expect(checkIn).toHaveTextContent("5 responses");
  expect(checkIn).toHaveTextContent("Most common");
  expect(checkIn).toHaveTextContent("4 students · 3 do it · 1 watched");
  expect(checkIn).toHaveTextContent("Objects: ball, goal");
  expect(checkIn).toHaveTextContent("“A ball bounced off a goalpost.”");
  expect(checkIn).toHaveTextContent("Also mentioned: cooking (1) · 1 with no clear activity");
});

it("shows 'No responses yet' in the check-in card when nobody answered", async () => {
  fetchMock.mockResolvedValue(reply({ interests: null }));
  render(<Harness />);
  const checkIn = screen.getByRole("region", { name: "From the experience check-in" });
  expect(await within(checkIn).findByText("No responses yet")).toBeVisible();
});

it("explains the recommendation step by step and marks where the rule stopped", () => {
  render(<Harness />);
  const region = screen.getByRole("region", { name: "Recommended strategy" });
  expect(within(region).getByRole("heading", { name: recommendedLabel })).toBeVisible();
  const rows = within(within(region).getByRole("list", { name: "How we chose" })).getAllByRole("listitem");
  expect(rows).toHaveLength(3);
  const decided = recommendation.decidedAtStep;
  expect(rows[decided - 1]).toHaveAttribute("aria-current", "step");
  expect(rows[decided - 1]).toHaveTextContent(`Yes → ${recommendedLabel}`);
  rows.slice(0, decided - 1).forEach(row => expect(row).toHaveTextContent("No"));
  rows.slice(decided).forEach(row => expect(row).toHaveTextContent("Not needed"));
  expect(screen.getByRole("button", { name: "Recalculate" })).toBeEnabled();
});

it("names each strategy radio by its label only, not its tooltip", () => {
  render(<Harness />);
  // An exact-name match fails if the tooltip text or the Recommended badge leaks into the name.
  for (const strategy of engagementStrategies) expect(radio(strategy.label)).toHaveAttribute("value", strategy.id);
});

it("starts the focus on the class's most common misconception and allows at most two", () => {
  render(<Harness />);
  fireEvent.click(radio(recommendedLabel));
  const focus = within(screen.getByRole("group", { name: /Misconception to target/ }));
  const boxes = focus.getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes).toHaveLength(lessonFocusMisconceptions(8).length);
  const top = Math.max(...counts.misconceptions.map(m => m.count));
  const expected = counts.misconceptions.filter(m => m.count === top).slice(0, 2).map(m => m.statement);
  expect(boxes.filter(b => b.checked).map(b => b.closest("label")!.textContent)).toEqual(expected.map(text => expect.stringContaining(text)));

  // Fill up to two; the rest are disabled until one is unticked.
  const unchecked = () => boxes.filter(b => !b.checked);
  while (boxes.filter(b => b.checked).length < 2) fireEvent.click(unchecked()[0]);
  unchecked().forEach(box => expect(box).toBeDisabled());
  const [first, second] = boxes.filter(b => b.checked);
  fireEvent.click(first);
  unchecked().forEach(box => expect(box).toBeEnabled());
  fireEvent.click(second);
  expect(screen.getByText("Choose at least one to continue.")).toBeVisible();
  expect(screen.getByRole("button", { name: `Use ${recommendedLabel}` })).toBeDisabled();
});

it("uses core ideas as the focus for analogy and asks why only when the choice differs", () => {
  render(<Harness />);
  fireEvent.click(radio(recommendedLabel));
  expect(screen.queryByRole("textbox", { name: /Why a different strategy/ })).toBeNull();
  fireEvent.click(radio("Analogy"));
  const ideas = within(screen.getByRole("group", { name: /Core idea to explain/ })).getAllByRole("checkbox") as HTMLInputElement[];
  expect(ideas).toHaveLength(getLesson(8)!.core_ideas.length);
  expect(ideas.map(box => box.checked)).toEqual(ideas.map((_, index) => index === 0));
  const why = screen.getByRole("textbox", { name: /Why a different strategy\? \(optional\)/ });
  fireEvent.change(why, { target: { value: "We did a demo last week." } });
  expect(why).toHaveValue("We did a demo last week.");
  expect(screen.getByRole("button", { name: "Use Analogy" })).toBeEnabled();
  fireEvent.click(radio(recommendedLabel));
  expect(screen.queryByRole("textbox", { name: /Why a different strategy/ })).toBeNull();
});

it("confirms what was saved and whether it matched the recommendation", () => {
  const onUse = vi.fn();
  const focus = { misconceptions: [], coreIdeas: [0] };
  const view = render(<Harness initialPick="analogy" initialFocus={focus} saveStatus="saved" onUse={onUse} />);
  expect(saved()).toHaveTextContent(`Saved: Analogy (instead of ${recommendedLabel})`);
  fireEvent.click(screen.getByRole("button", { name: "Use Analogy" }));
  expect(onUse).toHaveBeenCalledTimes(1);
  view.rerender(<Harness initialPick="analogy" initialFocus={focus} saveStatus="saved" recommendation={null} />);
  expect(saved().textContent).toBe("Saved: Analogy");
  cleanup();
  render(<Harness initialPick="cognitive conflict" initialFocus={{ misconceptions: ["3-a"], coreIdeas: [] }} saveStatus="saved" />);
  expect(saved()).toHaveTextContent(`Saved: ${recommendedLabel} (agreed with recommendation)`);
});

it("shows a save error and a busy save", () => {
  render(<Harness initialPick="analogy" initialFocus={{ misconceptions: [], coreIdeas: [0] }} saveStatus="error" saveError="Couldn't save your choice. Please try again." />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save your choice.");
  cleanup();
  render(<Harness initialPick="analogy" initialFocus={{ misconceptions: [], coreIdeas: [0] }} saveStatus="saving" />);
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
});
