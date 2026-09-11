// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeacherView from "@/app/components/TeacherView";
import type { UserContext } from "@/lib/auth";

const teacher: UserContext = {
  geniusId: "teacher", userId: "teacher", name: "Test teacher",
  email: null, role: "teacher", assignmentId: "assignment",
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => ({
    ok: true,
    json: async () => input.startsWith("/api/lessons/")
      ? { lesson_number: Number(input.split("/").pop()), lesson_title: `Lesson ${input.split("/").pop()}`, quiz_items: [], learning_objective: "Test objective" }
      : {},
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("hides both synthetic-answer controls and their description for independent classes", async () => {
  render(<TeacherView user={{ ...teacher, classId: "ea-class-native" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
  expect(screen.queryByRole("button", { name: "Auto-answer 5 test students" })).toBeNull();
  expect(screen.queryByText(/Generates stable random answers/)).toBeNull();
});

it("preserves the existing synthetic-answer controls for legacy embedded assignments", async () => {
  render(<TeacherView user={{ ...teacher, classId: "genius-class" }} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  fireEvent.click(screen.getByRole("button", { name: /Strategy recommendation/ }));
  expect(screen.getByRole("button", { name: "Auto-answer 5 test students" })).toBeTruthy();
  expect(screen.getByText(/Generates stable random answers/)).toBeTruthy();
});
