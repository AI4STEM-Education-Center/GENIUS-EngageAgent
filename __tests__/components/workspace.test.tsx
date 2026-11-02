// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workspace from "@/app/components/Workspace";
const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), query: "", role: "teacher", fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), useSearchParams: () => new URLSearchParams(mocks.query) }));
const teacher = { geniusId: "teacher", userId: "teacher", role: "teacher", name: "Teacher", email: null };
const student = { ...teacher, geniusId: "student", userId: "student", role: "student" };
vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => ({ user: mocks.role === "teacher" ? teacher : student, loading: false, error: null }) }));
type ViewProps = { user: { classId: string; assignmentId: string }; initialMaterialFormat?: string; initialStep?: number; shell?: { homeHref?: string; classHref?: string; canSignOut?: boolean } };
vi.mock("@/app/components/TeacherView", () => ({ default: ({ user, initialMaterialFormat, initialStep, shell }: ViewProps) => <p data-class-id={user.classId}
  data-initial-material-format={initialMaterialFormat} data-initial-step={initialStep} data-home-href={shell?.homeHref} data-class-href={shell?.classHref}
  data-can-sign-out={String(!!shell?.canSignOut)}>Teacher workflow {user.assignmentId}</p> }));
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
  const workflow = screen.getByText("Teacher workflow ea-task-a");
  expect(workflow.getAttribute("data-initial-material-format")).toBeNull();
  expect(workflow.getAttribute("data-initial-step")).toBeNull();
  // The task view draws its own header, linked back to the class lists (#172).
  expect(workflow.getAttribute("data-home-href")).toBe("/teacher/classes");
  expect(workflow.getAttribute("data-class-href")).toBe("/teacher/classes?classId=ea-class-a");
  expect(workflow.getAttribute("data-can-sign-out")).toBe("true");
  expect(screen.queryByRole("banner")).toBeNull();
});
it("opens old dashboard links on Step 4 of the teacher workflow", async () => {
  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a&view=dashboard";
  mocks.fetch.mockResolvedValue(reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a" } }));
  render(<Workspace />);
  expect((await screen.findByText("Teacher workflow ea-task-a")).getAttribute("data-initial-step")).toBe("4");
});
it("opens old slides links inside the teacher workflow with Slides selected", async () => {
  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a&view=slides";
  mocks.fetch.mockResolvedValue(reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a" } }));
  render(<Workspace />);
  const workflow = await screen.findByText("Teacher workflow ea-task-a");
  expect(workflow.getAttribute("data-class-id")).toBe("ea-class-a");
  expect(workflow.getAttribute("data-initial-material-format")).toBe("slides");
  expect(workflow.getAttribute("data-initial-step")).toBeNull();
});
it("does not open an old slides link when workspace ownership verification fails", async () => {
  mocks.query = "classId=ea-class-other&assignmentId=ea-task-other&view=slides";
  mocks.fetch.mockResolvedValue(reply({ error: "Forbidden" }, false));
  render(<Workspace />); expect((await screen.findByRole("alert")).textContent).toContain("Forbidden");
  expect(screen.queryByText(/Teacher workflow/)).toBeNull();
});
it("does not expose the slide editor to students through view parameters", async () => {
  mocks.role = "student"; mocks.query = "classId=ea-class-a&assignmentId=ea-task-a&view=slides";
  mocks.fetch.mockResolvedValue(reply({ user: { ...student, classId: "ea-class-a", assignmentId: "ea-task-a" } }));
  render(<Workspace />); expect(await screen.findByText("Student workflow")).toBeTruthy();
  expect(screen.queryByText(/Teacher workflow/)).toBeNull();
  expect(screen.queryByRole("link", { name: "Slides" })).toBeNull();
});
it("frames the class list with the shared header", async () => {
  mocks.query = "classId=ea-class-a";
  mocks.fetch.mockResolvedValue(reply({ classroom: { id: "ea-class-a", name: "Physics · Period 3" }, assignments: [], members: [] }));
  render(<Workspace />); await screen.findByText("No tasks yet.");
  const header = screen.getByRole("banner");
  expect(header.querySelector('a[href="/teacher/classes"]')?.textContent).toBe("EngageAgent");
  expect(screen.getByRole("link", { name: "Physics · Period 3" }).getAttribute("href")).toBe("/teacher/classes?classId=ea-class-a");
  expect(screen.getByRole("link", { name: "Gallery" }).getAttribute("href")).toBe("/community");
  expect(screen.getByRole("button", { name: "Sign out of EngageAgent" })).toBeTruthy();
});
