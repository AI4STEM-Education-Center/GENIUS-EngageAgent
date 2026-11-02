// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeacherView from "@/app/components/TeacherView";
import type { UserContext } from "@/lib/auth";

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
      : input.startsWith("/api/lessons/")
        ? { lesson_number: Number(input.split("/").pop()), lesson_title: `Lesson ${input.split("/").pop()}`, quiz_items: [], learning_objective: "Test objective" }
        : {},
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  [null, true],
  [{ class_id: "ea-class-profile", status: "saved" }, false],
  [{ class_id: "ea-class-profile", status: "skipped" }, false],
])("asks about the class only on the teacher's first visit (#173, saved profile: %j)", async (saved, asks) => {
  classProfile = saved;
  render(<TeacherView user={teacher} />);
  await screen.findByRole("button", { name: /Lesson 1 0 questions/ });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === "/api/class-profile?classId=ea-class-profile&assignmentId=assignment")).toBe(true));
  if (asks) expect(await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" })).toBeTruthy();
  else expect(screen.queryByRole("dialog", { name: "Tell EngageAgent about this class" })).toBeNull();
});
