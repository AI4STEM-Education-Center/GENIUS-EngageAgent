// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workspace from "@/app/components/Workspace";
const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), query: "", role: "teacher", fetch: vi.fn(), workflow: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), useSearchParams: () => new URLSearchParams(mocks.query) }));
const teacher = { geniusId: "teacher", userId: "teacher", role: "teacher", name: "Teacher", email: null };
const student = { ...teacher, geniusId: "student", userId: "student", role: "student" };
vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => ({ user: mocks.role === "teacher" ? teacher : student, loading: false, error: null }) }));
type ViewProps = { user: { classId: string; assignmentId: string }; initialMaterialFormat?: string; initialStep?: number; initialView?: string; shell?: { homeHref?: string; classHref?: string; taskTitle?: string; canSignOut?: boolean } };
vi.mock("@/app/components/TeacherView", () => ({ default: ({ user, initialMaterialFormat, initialStep, initialView, shell }: ViewProps) => {
  mocks.workflow({ query: mocks.query, user, shell });
  return <p data-class-id={user.classId} data-task-title={shell?.taskTitle}
  data-initial-material-format={initialMaterialFormat} data-initial-step={initialStep} data-initial-view={initialView} data-home-href={shell?.homeHref} data-class-href={shell?.classHref}
  data-can-sign-out={String(!!shell?.canSignOut)}>Teacher workflow {user.assignmentId}</p>;
} }));
vi.mock("@/app/components/StudentView", () => ({ default: () => <p>Student workflow</p> }));
beforeEach(() => { mocks.query = ""; mocks.role = "teacher"; mocks.fetch.mockReset(); mocks.push.mockReset(); mocks.replace.mockReset(); mocks.workflow.mockReset(); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reply = (value: unknown, ok = true) => ({ ok, json: async () => value });
it("lets teachers create a class inside EngageAgent", async () => {
  mocks.fetch.mockResolvedValueOnce(reply({ classes: [] })).mockResolvedValueOnce(reply({ classroom: { id: "ea-class-created" } }));
  render(<Workspace />);
  await screen.findByText("No classes yet.");
  fireEvent.click(screen.getByRole("button", { name: "Add class" }));
  const dialog = screen.getByRole("dialog", { name: "Add a class" });
  fireEvent.change(within(dialog).getByLabelText("Class name"), { target: { value: "Physics" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add class" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/teacher/classes?classId=ea-class-created"));
  expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({ action: "createClass", name: "Physics" });
});
it("gives students join controls without teacher create controls", async () => {
  mocks.role = "student"; mocks.fetch.mockResolvedValue(reply({ classes: [] }));
  render(<Workspace />); await screen.findByText("No classes yet.");
  expect(screen.getByRole("button", { name: "Join class" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add class" })).toBeNull();
});
it("retains form input on a save failure", async () => {
  mocks.fetch.mockResolvedValueOnce(reply({ classes: [] })).mockResolvedValueOnce(reply({ error: "Storage unavailable" }, false));
  render(<Workspace />); await screen.findByText("No classes yet.");
  fireEvent.click(screen.getByRole("button", { name: "Add class" }));
  const dialog = screen.getByRole("dialog", { name: "Add a class" });
  fireEvent.change(within(dialog).getByLabelText("Class name"), { target: { value: "Keep my name" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add class" }));
  await within(dialog).findByText("Storage unavailable");
  expect((within(dialog).getByLabelText("Class name") as HTMLInputElement).value).toBe("Keep my name");
  expect(mocks.push).not.toHaveBeenCalled();
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
it("opens old dashboard links on the teacher's assignment dashboard", async () => {
  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a&view=dashboard";
  mocks.fetch.mockResolvedValue(reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a" } }));
  render(<Workspace />);
  const workflow = await screen.findByText("Teacher workflow ea-task-a");
  expect(workflow.getAttribute("data-initial-view")).toBe("dashboard");
  expect(workflow.getAttribute("data-initial-step")).toBeNull();
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
it.each([true, false])("ignores a previous task's late decoded response after the new task is verified (old request succeeds: %s)", async oldRequestSucceeds => {
  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a&view=gallery";
  let finishOld!: (value: unknown) => void;
  const oldBody = new Promise<unknown>(resolve => { finishOld = resolve; });
  mocks.fetch.mockResolvedValueOnce({ ok: oldRequestSucceeds, json: () => oldBody })
    .mockResolvedValueOnce(reply({ user: { ...teacher, classId: "ea-class-b", assignmentId: "ea-task-b", taskTitle: "Task B title" } }));
  const page = render(<Workspace />);
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  const oldSignal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
  mocks.query = "classId=ea-class-b&assignmentId=ea-task-b&view=gallery";
  page.rerender(<Workspace />);
  const current = await screen.findByText("Teacher workflow ea-task-b");
  expect(current.getAttribute("data-task-title")).toBe("Task B title");
  expect(oldSignal.aborted).toBe(true);
  await act(async () => finishOld(oldRequestSucceeds
    ? { user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a", taskTitle: "Old Task A title" } }
    : { error: "Old task request failed" }));
  expect(screen.queryByText("Teacher workflow ea-task-a")).toBeNull();
  expect(screen.getByText("Teacher workflow ea-task-b").getAttribute("data-task-title")).toBe("Task B title");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mocks.workflow.mock.calls.every(([value]) => value.user.assignmentId === "ea-task-b")).toBe(true);
});

it("never mounts the previous task under a newly selected task URL while verification is pending", async () => {
  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a";
  let finishNew!: (value: ReturnType<typeof reply>) => void;
  mocks.fetch.mockResolvedValueOnce(reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a", taskTitle: "Task A title" } }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
  const page = render(<Workspace />);
  expect((await screen.findByText("Teacher workflow ea-task-a")).getAttribute("data-task-title")).toBe("Task A title");
  mocks.workflow.mockClear();
  mocks.query = "classId=ea-class-b&assignmentId=ea-task-b&view=gallery";
  page.rerender(<Workspace />);
  // Also catch a transient render before the old data-clearing effect runs: a
  // task editor must never receive A's identity alongside B's route/shell.
  expect(mocks.workflow).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toBe("Loading workspace...");
  await act(async () => finishNew(reply({ user: { ...teacher, classId: "ea-class-b", assignmentId: "ea-task-b", taskTitle: "Task B title" } })));
  expect((await screen.findByText("Teacher workflow ea-task-b")).getAttribute("data-task-title")).toBe("Task B title");
});

it.each(["slides", "gallery"])("does not expose the teacher %s view to students through view parameters", async view => {
  mocks.role = "student"; mocks.query = `classId=ea-class-a&assignmentId=ea-task-a&view=${view}`;
  mocks.fetch.mockResolvedValue(reply({ user: { ...student, classId: "ea-class-a", assignmentId: "ea-task-a" } }));
  render(<Workspace />); expect(await screen.findByText("Student workflow")).toBeTruthy();
  expect(screen.queryByText(/Teacher workflow/)).toBeNull();
  expect(screen.queryByRole("link", { name: "Slides" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Gallery" })).toBeNull();
});
it("frames the class list with the shared header", async () => {
  mocks.query = "classId=ea-class-a";
  mocks.fetch.mockResolvedValue(reply({ classroom: { id: "ea-class-a", name: "Physics · Period 3" }, assignments: [], members: [] }));
  render(<Workspace />); await screen.findByText("No tasks yet.");
  const header = screen.getByRole("banner");
  expect(header.querySelector('a[href="/teacher/classes"]')?.textContent).toBe("EngageAgent");
  expect(screen.getByRole("link", { name: "Physics · Period 3" }).getAttribute("href")).toBe("/teacher/classes?classId=ea-class-a");
  expect(screen.getByRole("link", { name: "Gallery" }).getAttribute("href")).toBe("/teacher/classes?classId=ea-class-a&view=gallery");
  expect(screen.getByRole("button", { name: "Sign out of EngageAgent" })).toBeTruthy();
});

it("opens Gallery from the class list through existing workspace classes", async () => {
  mocks.fetch.mockResolvedValue(reply({ classes: [{ id: "ea-class-a", name: "Physics" }] }));
  const page = render(<Workspace />);
  await screen.findByRole("heading", { name: "My classes" });
  expect(screen.getByRole("link", { name: "Gallery" }).getAttribute("href")).toBe("/teacher/classes?view=gallery");

  mocks.query = "view=gallery";
  page.rerender(<Workspace />);
  expect(screen.getByRole("heading", { name: "Choose a class for your materials" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Physics" }).getAttribute("href")).toBe("/teacher/classes?classId=ea-class-a&view=gallery");
  expect(screen.getByRole("link", { name: "Gallery" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Back to my classes" }).getAttribute("href")).toBe("/teacher/classes");
  expect(screen.queryByRole("button", { name: "Add class" })).toBeNull();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls[0][0]).toBe("/api/workspace?");
  expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
});

it("uses the selected class to choose a Gallery task without class setup or data creation", async () => {
  mocks.query = "classId=ea-class-a&view=gallery";
  mocks.fetch.mockResolvedValue(reply({
    classroom: { id: "ea-class-a", name: "Physics", joinCode: "PRIVATECLASSCODE" },
    assignments: [{ id: "ea-task-a", title: "Collisions" }],
    members: [{ geniusId: "student", name: "A student" }],
  }));
  render(<Workspace />);
  await screen.findByRole("heading", { name: "Choose a task for your materials" });
  expect(screen.getByRole("link", { name: "Collisions" }).getAttribute("href")).toBe("/teacher/classes?classId=ea-class-a&view=gallery&assignmentId=ea-task-a");
  expect(screen.getByRole("link", { name: "All classes" }).getAttribute("href")).toBe("/teacher/classes?view=gallery");
  expect(screen.getByRole("link", { name: "Back to class" }).getAttribute("href")).toBe("/teacher/classes?classId=ea-class-a");
  expect(screen.queryByLabelText("New task title")).toBeNull();
  expect(screen.queryByRole("region", { name: "Class profile" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("PRIVATECLASSCODE")).toBeNull();
  expect(screen.queryByText("A student")).toBeNull();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls[0][0]).toBe("/api/workspace?classId=ea-class-a");
  expect(mocks.fetch.mock.calls[0][1].method).toBeUndefined();
});

it("opens Gallery only after the workspace verifies the task and keeps Gallery return links", async () => {
  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a&view=gallery";
  let complete: (value: unknown) => void = () => {};
  mocks.fetch.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<Workspace />);
  expect(screen.queryByText(/Teacher workflow/)).toBeNull();
  complete(reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a" } }));
  const workflow = await screen.findByText("Teacher workflow ea-task-a");
  expect(workflow.getAttribute("data-initial-view")).toBe("gallery");
  expect(workflow.getAttribute("data-initial-material-format")).toBeNull();
  expect(workflow.getAttribute("data-home-href")).toBe("/teacher/classes?view=gallery");
  expect(workflow.getAttribute("data-class-href")).toBe("/teacher/classes?classId=ea-class-a&view=gallery");
  expect(screen.queryByRole("banner")).toBeNull();
});

it("applies Gallery navigation to an already-mounted task without creating a new workspace", async () => {
  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a";
  mocks.fetch.mockResolvedValue(reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a" } }));
  const page = render(<Workspace />);
  const workflow = await screen.findByText("Teacher workflow ea-task-a");
  mocks.query += "&view=gallery";
  page.rerender(<Workspace />);
  const gallery = screen.getByText("Teacher workflow ea-task-a");
  expect(gallery).not.toBe(workflow);
  expect(gallery.getAttribute("data-initial-view")).toBe("gallery");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("keeps an unauthorized Gallery task closed", async () => {
  mocks.query = "classId=ea-class-other&assignmentId=ea-task-other&view=gallery";
  mocks.fetch.mockResolvedValue(reply({ error: "Forbidden" }, false));
  render(<Workspace />);
  expect((await screen.findByRole("alert")).textContent).toContain("Forbidden");
  expect(screen.queryByText(/Teacher workflow/)).toBeNull();
});

it("does not show Gallery selection or teacher controls on a student's class list", async () => {
  mocks.role = "student"; mocks.query = "view=gallery";
  mocks.fetch.mockResolvedValue(reply({ classes: [{ id: "ea-class-a", name: "Physics" }] }));
  render(<Workspace />);
  await screen.findByRole("heading", { name: "My classes" });
  expect(screen.getByRole("button", { name: "Join class" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Physics" }).getAttribute("href")).toBe("/student/classes?classId=ea-class-a");
  expect(screen.queryByRole("link", { name: "Gallery" })).toBeNull();
  expect(screen.queryByRole("heading", { name: /Choose a/ })).toBeNull();
});
it("links teachers to Lessons from their class pages, but not students", async () => {
  mocks.fetch.mockResolvedValue(reply({ classes: [] }));
  render(<Workspace />); await screen.findByText("No classes yet.");
  expect(screen.getByRole("link", { name: "Lessons" }).getAttribute("href")).toBe("/teacher/lessons");
  cleanup();
  mocks.role = "student";
  render(<Workspace />); await screen.findByText("No classes yet.");
  expect(screen.queryByRole("link", { name: "Lessons" })).toBeNull();
});
