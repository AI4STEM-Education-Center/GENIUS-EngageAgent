// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import QuizPerformanceSection from "@/app/components/QuizPerformanceSection";
import type { StudentAnswer } from "@/lib/types";

// Lesson 1 key: Q1=C (D→a), Q2=A, Q3=A, Q4=D.
const answer = (id: string, name: string, answers: Record<string, string>): StudentAnswer => ({
  student_id: id, student_name: name, class_id: "class-a", assignment_id: "task-a",
  lesson_number: 1, answers, submitted_at: "2026-10-14T15:00:00Z",
});
const answers = [
  answer("alex", "Alex Johnson", { L1_Q1: "C", L1_Q1_confidence: "A", L1_Q2: "A", L1_Q2_confidence: "A", L1_Q3: "A", L1_Q3_confidence: "B", L1_Q4: "D", L1_Q4_confidence: "B" }),
  answer("maya", "Maya Patel", { L1_Q1: "D", L1_Q1_confidence: "D", L1_Q2: "A", L1_Q2_confidence: "C", L1_Q3: "D", L1_Q3_confidence: "C", L1_Q4: "A", L1_Q4_confidence: "B" }),
];
const props = { classId: "class-a", assignmentId: "task-a", className: "Period 3", lessonNumber: 1, quizStatus: "published" as const, quizUpdatedAt: "2026-10-14T13:00:00Z", answers };

beforeEach(() => window.sessionStorage.clear());
afterEach(() => cleanup());

it("shows the header, participation and one summary row per question", () => {
  render(<QuizPerformanceSection {...props} />);
  expect(screen.getByRole("heading", { name: "Lesson 1 quiz" })).toBeTruthy();
  expect(screen.getByText("Provisional")).toBeTruthy();
  expect(screen.getByText(/Period 3 · Published .* · No due date · 4 questions · One attempt/)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "View details" })).toHaveLength(4);
  // Q1: one of two correct, confidence (4 + 1) / 2.
  const q1 = screen.getAllByRole("row")[1];
  expect(within(q1).getByText("(50%)")).toBeTruthy();
  expect(within(q1).getByText("2.5 / 4")).toBeTruthy();
});

it("labels closed quizzes as final", () => {
  render(<QuizPerformanceSection {...props} quizStatus="closed" />);
  expect(screen.getByText("Final")).toBeTruthy();
});

it("shows Not available when nobody has submitted", () => {
  render(<QuizPerformanceSection {...props} answers={[]} />);
  expect(screen.getAllByText("Not available").length).toBeGreaterThanOrEqual(8);
});

it("opens View details on one question and Full report on all of them", () => {
  render(<QuizPerformanceSection {...props} />);
  fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
  expect((screen.getByLabelText("Question") as HTMLSelectElement).value).toBe("L1_Q1");
  expect(screen.getByText(/showing 2 of 8 answers/)).toBeTruthy();
  // The detailed table (the second table) shows Maya's confidence for Q1.
  const detail = screen.getAllByRole("table")[1];
  expect(within(detail).getByText("Just guessing – 1")).toBeTruthy();
  // With one question selected, the Question column is hidden (spec step 12).
  expect(within(detail).queryByText("Question")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Full report" }));
  expect((screen.getByLabelText("Question") as HTMLSelectElement).value).toBe("all");
  expect(screen.getByText(/showing 8 of 8 answers/)).toBeTruthy();
});

it("filters by student, option, confidence, diagnostic type and correctness, then clears them", () => {
  render(<QuizPerformanceSection {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Full report" }));

  fireEvent.change(screen.getByLabelText("Correct"), { target: { value: "false" } });
  expect(screen.getByText(/showing 3 of 8 answers/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Diagnostic type"), { target: { value: "a" } });
  expect(screen.getByText(/showing 1 of 8 answers/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
  expect(screen.getByText(/showing 8 of 8 answers/)).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Search student"), { target: { value: "alex" } });
  fireEvent.change(screen.getByLabelText("Confidence"), { target: { value: "4" } });
  expect(screen.getByText(/showing 2 of 8 answers/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Answer option"), { target: { value: "C" } });
  expect(screen.getByText(/showing 1 of 8 answers/)).toBeTruthy();
});

it("keeps the filters when the teacher leaves and comes back", () => {
  const first = render(<QuizPerformanceSection {...props} />);
  fireEvent.click(screen.getAllByRole("button", { name: "View details" })[2]);
  fireEvent.change(screen.getByLabelText("Correct"), { target: { value: "true" } });
  first.unmount();

  render(<QuizPerformanceSection {...props} />);
  expect((screen.getByLabelText("Question") as HTMLSelectElement).value).toBe("L1_Q3");
  expect((screen.getByLabelText("Correct") as HTMLSelectElement).value).toBe("true");
});
