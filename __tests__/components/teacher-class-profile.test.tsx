// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeacherView from "@/app/components/TeacherView";
import type { UserContext } from "@/lib/auth";
import { lessonResponse } from "../fixtures/lesson-responses";

const teacher: UserContext = {
  geniusId: "teacher", userId: "teacher", name: "Test teacher",
  email: null, role: "teacher", classId: "ea-class-profile", assignmentId: "assignment",
};

let classProfile: unknown;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => ({
    ok: true,
    json: async () => input.startsWith("/api/class-profile")
      ? { classProfile }
      : lessonResponse(input, undefined, { learning_objective: "Test objective" }) ?? {},
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  [null],
  [{ class_id: "ea-class-profile", status: "saved" }],
  [{ class_id: "ea-class-profile", status: "skipped" }],
])("never asks for the class profile inside a task; that happens when the class is added (#173, saved profile: %j)", async (saved) => {
  classProfile = saved;
  render(<TeacherView user={teacher} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === "/api/class-profile?classId=ea-class-profile&assignmentId=assignment")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole("dialog", { name: "Tell EngageAgent about this class" })).toBeNull();
});

const savedProfile = {
  class_id: "ea-class-profile", status: "saved", locale: "rural", groups: ["hispanic_latino"], groupAlternative: null,
  classType: "honors", englishLearners: true, iepOr504: false, updated_at: "2026-11-03T00:00:00.000Z",
};

it("opens the class profile from the header button (#173)", async () => {
  classProfile = savedProfile;
  render(<TeacherView user={teacher} />);
  const button = await screen.findByRole("button", { name: "Class profile" });
  expect(button).toHaveProperty("disabled", false);
  fireEvent.click(button);
  const dialog = await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" });
  expect(within(dialog).getByRole("button", { name: /^Rural/ }).getAttribute("aria-pressed")).toBe("true");
});

it.each([
  [null, "Not set · Not set", "No supports noted"],
  [savedProfile, "Rural · Honors", "English learners"],
])("shows the class profile in the Step 3 summary with an Edit link (#173, saved: %j)", async (saved, title, supports) => {
  classProfile = saved;
  render(<TeacherView user={teacher} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  expect(await screen.findByText(title)).toBeTruthy();
  expect(screen.getByText(supports)).toBeTruthy();
  const edit = screen.getByRole("button", { name: "Edit class profile", hidden: true });
  fireEvent.click(edit);
  expect(await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" })).toBeTruthy();
});

it("opens the editor for a stored profile with missing answers (#173)", async () => {
  classProfile = { class_id: "ea-class-profile", status: "saved" };
  render(<TeacherView user={teacher} />);
  fireEvent.click(await screen.findByRole("button", { name: "Class profile" }));
  const dialog = await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" });
  expect(within(dialog).getByRole("button", { name: /^Rural/ }).getAttribute("aria-pressed")).toBe("false");
});
