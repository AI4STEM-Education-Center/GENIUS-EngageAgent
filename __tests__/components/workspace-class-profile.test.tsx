// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workspace from "@/app/components/Workspace";

// The class profile is its own step on the class page, before any task (#173).
const mocks = vi.hoisted(() => ({ query: "", role: "teacher", profile: null as unknown, saves: [] as unknown[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(mocks.query) }));
const teacher = { geniusId: "teacher", userId: "teacher", role: "teacher", name: "Teacher", email: null };
const student = { ...teacher, geniusId: "student", userId: "student", role: "student" };
vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => ({ user: mocks.role === "teacher" ? teacher : student, loading: false, error: null }) }));
vi.mock("@/app/components/TeacherView", () => ({ default: () => <p>Teacher workflow</p> }));
vi.mock("@/app/components/StudentView", () => ({ default: () => <p>Student workflow</p> }));

const classDetail = { classroom: { id: "ea-class-a", name: "Physics", joinCode: "ABCDEF0123456789" }, assignments: [{ id: "ea-task-a", title: "Collisions", createdAt: "" }], members: [] };
const saved = { class_id: "ea-class-a", status: "saved", locale: "rural", groups: ["hispanic_latino", "white"], groupAlternative: null, classType: "honors", englishLearners: true, iepOr504: false, updated_at: "" };

beforeEach(() => {
  mocks.query = "classId=ea-class-a"; mocks.role = "teacher"; mocks.profile = null; mocks.saves = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const reply = (body: unknown) => ({ ok: true, json: async () => body });
    if (input.startsWith("/api/class-profile")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        mocks.saves.push(body);
        mocks.profile = body.skip ? { ...saved, status: "skipped", locale: null, groups: [], classType: null, englishLearners: false } : { ...saved, ...body.profile };
        return reply({ classProfile: mocks.profile });
      }
      return reply({ classProfile: mocks.profile });
    }
    if (input.startsWith("/api/workspace?classId=ea-class-a&assignmentId")) return reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a" } });
    if (input.startsWith("/api/workspace")) return reply(classDetail);
    throw new Error(`Unexpected request ${input}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const profileRequests = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/class-profile"));

it("asks for the class profile on the class page the first time, without a task", async () => {
  render(<Workspace />);
  const dialog = await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" });
  expect(within(dialog).getByText("Before you start · asked once")).toBeTruthy();
  expect(profileRequests()[0][0]).toBe("/api/class-profile?classId=ea-class-a");

  fireEvent.click(within(dialog).getByRole("button", { name: /^Rural/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Honors" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.saves[0]).toMatchObject({ classId: "ea-class-a", profile: { locale: "rural", classType: "honors" } });
  expect(mocks.saves[0]).not.toHaveProperty("assignmentId");

  const section = screen.getByRole("region", { name: "Class profile" });
  expect(within(section).getByText("Rural")).toBeTruthy();
  expect(within(section).getByText("Honors")).toBeTruthy();
  expect(screen.getByText("Class profile saved")).toBeTruthy();
});

it("shows a saved profile above the tasks, with an Edit button, and does not ask again", async () => {
  mocks.profile = saved;
  render(<Workspace />);
  const section = await screen.findByRole("region", { name: "Class profile" });
  await within(section).findByText("Rural");
  expect(within(section).getByText("Hispanic or Latino, White")).toBeTruthy();
  expect(within(section).getByText("Honors")).toBeTruthy();
  expect(within(section).getByText("English learners")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  // It comes before the task form and list.
  expect(section.compareDocumentPosition(screen.getByLabelText("New task title")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(within(section).getByRole("button", { name: "Edit class profile" }));
  const dialog = await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" });
  expect(within(dialog).getByRole("button", { name: /^Rural/ }).getAttribute("aria-pressed")).toBe("true");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
});

it("lets a teacher who skipped add it later from the class page", async () => {
  render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
  const section = screen.getByRole("region", { name: "Class profile" });
  await within(section).findByText("Not set yet.");
  expect(mocks.saves[0]).toEqual({ classId: "ea-class-a", skip: true });

  fireEvent.click(within(section).getByRole("button", { name: "Add class profile" }));
  expect(await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" })).toBeTruthy();
});

it("is not on the class list, the student class page, or inside a task", async () => {
  mocks.query = "";
  vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true, json: async () => ({ classes: [] }) }) as Response);
  render(<Workspace />);
  await screen.findByText("No classes yet.");
  cleanup();

  mocks.query = "classId=ea-class-a"; mocks.role = "student";
  render(<Workspace />);
  await screen.findByText("Collisions");
  cleanup();

  mocks.role = "teacher"; mocks.query = "classId=ea-class-a&assignmentId=ea-task-a";
  render(<Workspace />);
  await screen.findByText("Teacher workflow");

  expect(screen.queryByRole("region", { name: "Class profile" })).toBeNull();
  expect(profileRequests()).toHaveLength(0);
});
