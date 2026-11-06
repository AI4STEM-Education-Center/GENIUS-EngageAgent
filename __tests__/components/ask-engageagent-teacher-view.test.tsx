// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeacherView from "@/app/components/TeacherView";
import type { UserContext } from "@/lib/auth";

const teacher: UserContext = {
  geniusId: "teacher", userId: "teacher", name: "Test teacher", email: null, role: "teacher",
  classId: "genius-class", assignmentId: "assignment",
};
const stepButtons = () => within(screen.getByRole("navigation", { name: "Teacher steps" })).getAllByRole("button");
/** The step's own title, so these tests don't care what the steps are called. */
const stepTitle = (button: HTMLElement) => button.querySelector(".leading-tight")!.firstChild!.textContent!;
const panel = () => screen.getByRole("dialog", { name: "Ask EngageAgent" });
const sentBody = () => JSON.parse(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/ask-engageagent").at(-1)![1]!.body as string);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => ({
    ok: true,
    json: async () => input === "/api/ask-engageagent" ? { answer: "An answer." }
      : input.startsWith("/api/lessons/") ? { lesson_number: Number(input.split("/").pop()), lesson_title: `Lesson ${input.split("/").pop()}`, quiz_items: [], learning_objective: "Test objective" }
        : input.startsWith("/api/material-gallery") ? { items: [] }
          : input.startsWith("/api/slides?") ? { lessons: [] } : {},
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("follows the teacher across every step, the Dashboard and the Gallery and keeps the thread", async () => {
  render(<TeacherView user={teacher} shell={{ taskTitle: "Collisions" }} />);
  await waitFor(() => expect(stepButtons().length).toBe(4));
  fireEvent.click(screen.getByRole("button", { name: "Ask EngageAgent" }));
  const box = screen.getByRole("textbox", { name: "Your question" });
  fireEvent.change(box, { target: { value: "A question to keep" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await within(panel()).findByText("An answer.");

  const pages = ["assessment", "strategy", "materials", "discussion"];
  for (const [index, button] of stepButtons().entries()) {
    fireEvent.click(button);
    const title = stepTitle(button);
    await waitFor(() => expect(panel().textContent).toContain(`Helping with: Step ${index + 1} · ${title}`));
    expect(within(panel()).getByText("A question to keep")).toBeTruthy();
    fireEvent.change(box, { target: { value: `Asked on step ${index + 1}` } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(sentBody().message).toBe(`Asked on step ${index + 1}`));
    expect(sentBody().page).toBe(pages[index]);
    await waitFor(() => expect(within(panel()).getAllByText("An answer.").length).toBe(index + 2));
  }

  const header = within(screen.getByRole("banner"));
  fireEvent.click(header.getByRole("button", { name: "Dashboard" }));
  await waitFor(() => expect(panel().textContent).toContain("Helping with: Dashboard"));
  fireEvent.click(header.getByRole("button", { name: "Gallery" }));
  await waitFor(() => expect(panel().textContent).toContain("Helping with: Gallery"));
  expect(within(panel()).getByText("A question to keep")).toBeTruthy();
});

it("sends the lesson the teacher picked, and no lesson before that", async () => {
  render(<TeacherView user={teacher} />);
  const lessonThree = await screen.findByRole("button", { name: /Lesson 3 0 questions/ });
  fireEvent.click(screen.getByRole("button", { name: "Ask EngageAgent" }));
  const box = screen.getByRole("textbox", { name: "Your question" });
  fireEvent.change(box, { target: { value: "Before choosing" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await within(panel()).findByText("An answer.");
  expect(sentBody().lessonNumber).toBeNull();

  fireEvent.click(lessonThree);
  await waitFor(() => expect(lessonThree.className).toContain("ring-2"));
  fireEvent.change(box, { target: { value: "After choosing" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(within(panel()).getAllByText("An answer.")).toHaveLength(2));
  expect(sentBody()).toMatchObject({ message: "After choosing", lessonNumber: 3 });
});

it("shows the icon on the Gallery and Dashboard when they are opened directly", async () => {
  const view = render(<TeacherView user={teacher} initialView="gallery" />);
  expect(await screen.findByRole("button", { name: "Ask EngageAgent" })).toBeTruthy();
  view.unmount();
  render(<TeacherView user={teacher} initialView="dashboard" />);
  expect(await screen.findByRole("button", { name: "Ask EngageAgent" })).toBeTruthy();
});

it("isn't offered without a class and assignment", async () => {
  render(<TeacherView user={{ ...teacher, classId: undefined, assignmentId: undefined }} />);
  await waitFor(() => expect(stepButtons().length).toBe(4));
  expect(screen.queryByRole("button", { name: "Ask EngageAgent" })).toBeNull();
});

it("isn't in the header any more", async () => {
  render(<TeacherView user={teacher} shell={{ taskTitle: "Collisions" }} />);
  const header = within(await screen.findByRole("banner"));
  expect(header.queryByRole("button", { name: "Ask EngageAgent" })).toBeNull();
  expect(screen.getByRole("button", { name: "Ask EngageAgent" }).closest("header")).toBeNull();
});
