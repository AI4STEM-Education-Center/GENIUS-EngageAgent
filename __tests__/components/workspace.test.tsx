// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workspace from "@/app/components/Workspace";
const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), query: "", role: "teacher", fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), useSearchParams: () => new URLSearchParams(mocks.query) }));
const teacher = { geniusId: "teacher", userId: "teacher", role: "teacher", name: "Teacher", email: null };
const student = { ...teacher, geniusId: "student", userId: "student", role: "student" };
vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => ({ user: mocks.role === "teacher" ? teacher : student, loading: false, error: null }) }));
vi.mock("@/app/components/TeacherView", () => ({ default: ({ user }: { user: { assignmentId: string } }) => <p>Teacher workflow {user.assignmentId}</p> }));
vi.mock("@/app/components/TeacherDashboardView", () => ({ default: () => <p>Teacher dashboard</p> }));
vi.mock("@/app/components/StudentView", () => ({ default: () => <p>Student workflow</p> }));
beforeEach(() => { mocks.query = ""; mocks.role = "teacher"; mocks.fetch.mockReset(); mocks.push.mockReset(); mocks.replace.mockReset(); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reply = (value: unknown, ok = true) => ({ ok, json: async () => value });
it("lets teachers create a class inside EngageAgent", async () => {
  mocks.fetch.mockResolvedValueOnce(reply({ classes: [] })).mockResolvedValueOnce(reply({ classroom: { id: "ea-class-created" } }));
  render(<Workspace />);
  await screen.findByText("No classes yet.");
  fireEvent.change(screen.getByLabelText("New class name"), { target: { value: "Physics" } });
  fireEvent.click(screen.getByRole("button", { name: "Create class" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/teacher/classes?classId=ea-class-created"));
  expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toMatchObject({ action: "createClass", name: "Physics" });
});
it("gives students join controls without teacher create controls", async () => {
  mocks.role = "student"; mocks.fetch.mockResolvedValue(reply({ classes: [] }));
  render(<Workspace />); await screen.findByText("No classes yet.");
  expect(screen.getByRole("button", { name: "Join class" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create class" })).toBeNull();
});
it("retains form input on a save failure", async () => {
  mocks.fetch.mockResolvedValueOnce(reply({ classes: [] })).mockResolvedValueOnce(reply({ error: "Storage unavailable" }, false));
  render(<Workspace />); await screen.findByText("No classes yet.");
  fireEvent.change(screen.getByLabelText("New class name"), { target: { value: "Keep my name" } });
  fireEvent.click(screen.getByRole("button", { name: "Create class" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("New class name") as HTMLInputElement).value).toBe("Keep my name");
});
it("renders the existing workflow only after the server verifies the selected context", async () => {
  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a";
  mocks.fetch.mockResolvedValue(reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a" } }));
  render(<Workspace />); expect(await screen.findByText("Teacher workflow ea-task-a")).toBeTruthy();
});
it("keeps the assignment context when opening the existing dashboard", async () => {
  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a&view=dashboard";
  mocks.fetch.mockResolvedValue(reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a" } }));
  render(<Workspace />); expect(await screen.findByText("Teacher dashboard")).toBeTruthy();
});
