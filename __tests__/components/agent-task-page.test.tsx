// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }));
vi.mock("@/app/components/AuthContext", () => ({ useAuth: mocks.auth }));
vi.mock("@/lib/client-auth", () => ({ agentTaskFetch: mocks.fetch }));
vi.mock("@/app/components/TeacherView", () => ({ default: () => <section aria-label="Teacher workflow" /> }));
vi.mock("@/app/components/TeacherDashboardView", () => ({ default: () => <section aria-label="Class results" /> }));
vi.mock("@/app/components/StudentView", () => ({ default: () => <section aria-label="Student activity" /> }));
import AgentTaskPage from "@/app/components/AgentTaskPage";

const GENIUS = "https://new-genius.test";
const teacher: UserContext = { geniusId: "t1", userId: "t1", name: "Teacher", email: null, role: "teacher" };
const student: UserContext = { geniusId: "s1", userId: "s1", name: "Student", email: null, role: "student", classId: "class-a", assignmentId: "assign-a" };
const task = { agentTaskId: "ea-agent-task-1", title: "Forces", ownerGeniusId: "t1", archived: false, createdAt: "", updatedAt: "" };
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
let postMessage: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ user: teacher, loading: false, error: null });
  postMessage = vi.fn();
  // Embedded: the parent is a separate window.
  vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage } as unknown as Window);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const message = (type: string, title = "Forces") => [{ type, version: 1, agentId: "EngageAgent", agentTaskId: "ea-agent-task-1", title }, GENIUS];

describe("/create", () => {
  it("posts genius.task-created to the GENIUS origin only after the save succeeds", async () => {
    mocks.fetch.mockResolvedValueOnce(reply(503, { error: "Storage unavailable." })).mockResolvedValueOnce(reply(201, { task }));
    render(<AgentTaskPage mode="create" taskId={null} geniusOrigin={GENIUS} />);
    fireEvent.change(screen.getByLabelText("Activity title"), { target: { value: "Forces" } });
    fireEvent.click(screen.getByRole("button", { name: "Create activity" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Storage unavailable.");
    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create activity" }));
    await screen.findByText(/is ready/);
    expect(mocks.fetch).toHaveBeenLastCalledWith({ action: "create", title: "Forces" });
    expect(postMessage.mock.calls).toEqual([message("genius.task-created")]);
  });
  it("never broadcasts when no valid GENIUS origin is configured", async () => {
    mocks.fetch.mockResolvedValue(reply(201, { task }));
    render(<AgentTaskPage mode="create" taskId={null} geniusOrigin={null} />);
    fireEvent.change(screen.getByLabelText("Activity title"), { target: { value: "Forces" } });
    fireEvent.click(screen.getByRole("button", { name: "Create activity" }));
    await screen.findByText(/is ready/);
    expect(postMessage).not.toHaveBeenCalled();
  });
  it("is teacher-only", () => {
    mocks.auth.mockReturnValue({ user: student, loading: false, error: null });
    render(<AgentTaskPage mode="create" taskId={null} geniusOrigin={GENIUS} />);
    expect(screen.getByRole("heading").textContent).toBe("Teacher access required");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("/edit", () => {
  it("posts genius.task-updated after saving, and shows setup only without a class", async () => {
    mocks.fetch.mockResolvedValueOnce(reply(200, { task, links: [] })).mockResolvedValueOnce(reply(200, { task: { ...task, title: "Motion" } }));
    render(<AgentTaskPage mode="edit" taskId="ea-agent-task-1" geniusOrigin={GENIUS} />);
    const input = await screen.findByLabelText("Activity title");
    expect(mocks.fetch).toHaveBeenCalledWith({ action: "open", allowArchived: false, taskId: "ea-agent-task-1" });
    expect(screen.queryByLabelText("Teacher workflow")).toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Motion" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved.");
    expect(postMessage.mock.calls).toEqual([message("genius.task-updated", "Motion")]);
  });
  it("opens the class workflow when GENIUS signs a class", async () => {
    mocks.auth.mockReturnValue({ user: { ...teacher, classId: "class-a", assignmentId: "assign-a" }, loading: false, error: null });
    mocks.fetch.mockResolvedValue(reply(200, { task, links: [] }));
    render(<AgentTaskPage mode="edit" taskId="ea-agent-task-1" geniusOrigin={GENIUS} />);
    expect(await screen.findByLabelText("Teacher workflow")).toBeTruthy();
  });
  it("shows ownership and missing-task errors without messaging GENIUS", async () => {
    mocks.fetch.mockResolvedValue(reply(403, { error: "You do not have access to this activity." }));
    render(<AgentTaskPage mode="edit" taskId="ea-agent-task-1" geniusOrigin={GENIUS} />);
    expect((await screen.findByRole("alert")).textContent).toBe("You do not have access to this activity.");
    cleanup();
    render(<AgentTaskPage mode="edit" taskId={null} geniusOrigin={GENIUS} />);
    expect(screen.getByRole("alert").textContent).toBe("This link is missing its task_id.");
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("/view", () => {
  it("shows class results only when GENIUS signs a class", async () => {
    mocks.fetch.mockResolvedValue(reply(200, { task, links: [{ classId: "class-a" }] }));
    render(<AgentTaskPage mode="view" taskId="ea-agent-task-1" geniusOrigin={GENIUS} />);
    await screen.findByText("Used by 1 GENIUS class.");
    expect(screen.queryByLabelText("Class results")).toBeNull();
    cleanup();
    mocks.auth.mockReturnValue({ user: { ...teacher, classId: "class-a", assignmentId: "assign-a" }, loading: false, error: null });
    render(<AgentTaskPage mode="view" taskId="ea-agent-task-1" geniusOrigin={GENIUS} />);
    expect(await screen.findByLabelText("Class results")).toBeTruthy();
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("/delete", () => {
  it("asks for confirmation, archives, then posts genius.task-deleted", async () => {
    mocks.fetch.mockResolvedValueOnce(reply(200, { task, links: [] })).mockResolvedValueOnce(reply(200, { task: { ...task, archived: true } }));
    render(<AgentTaskPage mode="delete" taskId="ea-agent-task-1" geniusOrigin={GENIUS} />);
    const button = await screen.findByRole("button", { name: "Archive activity" });
    expect(mocks.fetch).toHaveBeenCalledWith({ action: "open", allowArchived: true, taskId: "ea-agent-task-1" });
    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByText(/is archived/);
    expect(mocks.fetch).toHaveBeenLastCalledWith({ action: "archive", taskId: "ea-agent-task-1" });
    expect(postMessage.mock.calls).toEqual([message("genius.task-deleted")]);
  });
  it("does not message GENIUS when archiving fails", async () => {
    mocks.fetch.mockResolvedValueOnce(reply(200, { task, links: [] })).mockResolvedValueOnce(reply(503, { error: "Storage unavailable." }));
    render(<AgentTaskPage mode="delete" taskId="ea-agent-task-1" geniusOrigin={GENIUS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Archive activity" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Storage unavailable.");
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("/launch", () => {
  it("opens the student activity for a launchable task", async () => {
    mocks.auth.mockReturnValue({ user: student, loading: false, error: null });
    mocks.fetch.mockResolvedValue(reply(200, { task: { agentTaskId: "ea-agent-task-1", title: "Forces" } }));
    render(<AgentTaskPage mode="launch" taskId="ea-agent-task-1" geniusOrigin={GENIUS} />);
    expect(await screen.findByLabelText("Student activity")).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledWith({ action: "launch", taskId: "ea-agent-task-1" });
  });
  it("tells students when the activity was archived", async () => {
    mocks.auth.mockReturnValue({ user: student, loading: false, error: null });
    mocks.fetch.mockResolvedValue(reply(410, { error: "This activity is no longer available." }));
    render(<AgentTaskPage mode="launch" taskId="ea-agent-task-1" geniusOrigin={GENIUS} />);
    expect((await screen.findByRole("alert")).textContent).toBe("This activity is no longer available.");
    expect(screen.queryByLabelText("Student activity")).toBeNull();
  });
});
