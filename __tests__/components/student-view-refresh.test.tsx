// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentView from "@/app/components/StudentView";
import type { UserContext } from "@/lib/auth";

const student: UserContext = {
  geniusId: "s1", userId: "s1", name: "Student", email: null, role: "student",
  classId: "class", assignmentId: "assignment",
};

let published = false;

const statuses = () => [
  { id: "assessment", order: 0, status: "completed" },
  { id: "content-review", order: 1, status: published ? "available" : "locked" },
  { id: "content-rating", order: 2, status: "locked" },
];

const items = () => published
  ? [{ content_item_id: "item-1", content_json: JSON.stringify({ title: "Material A", body: "Body A" }) }]
  : [];

beforeEach(() => {
  published = false;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const body =
      input.startsWith("/api/activity-status") ? { activities: statuses() }
      : input.startsWith("/api/content-publish") ? { items: items() }
      : input.startsWith("/api/quiz-status") ? { status: "published", lesson_number: 1 }
      : {};
    return { ok: true, json: async () => body };
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const exploreCard = () => screen.getByRole("button", { name: /Explore and ask/ });

it("unlocks Explore and ask and moves the student there after the teacher publishes, without a reload (#109)", async () => {
  render(<StudentView user={student} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });

  expect(exploreCard().textContent).toMatch(/Not available yet/);
  expect((exploreCard() as HTMLButtonElement).disabled).toBe(true);

  // Teacher publishes; the page polls on its own.
  published = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });

  expect((exploreCard() as HTMLButtonElement).disabled).toBe(false);
  expect(exploreCard().textContent).toMatch(/In progress/);
  expect(exploreCard().getAttribute("aria-current")).toBe("step");
  expect((await screen.findAllByText("Material A")).length).toBeGreaterThan(0);
});
