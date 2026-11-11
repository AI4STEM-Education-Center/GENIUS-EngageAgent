// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workspace from "@/app/components/Workspace";

// The class profile is part of adding a class, and shown and edited on the class page (#173).
const mocks = vi.hoisted(() => ({ query: "", role: "teacher", profile: null as unknown, adds: [] as Record<string, unknown>[], saves: [] as unknown[], addReply: null as null | (() => unknown), profileReadFails: false, push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams(mocks.query) }));
const teacher = { geniusId: "teacher", userId: "teacher", role: "teacher", name: "Teacher", email: null };
const student = { ...teacher, geniusId: "student", userId: "student", role: "student" };
vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => ({ user: mocks.role === "teacher" ? teacher : student, loading: false, error: null }) }));
vi.mock("@/app/components/TeacherView", () => ({ default: () => <p>Teacher workflow</p> }));
vi.mock("@/app/components/StudentView", () => ({ default: () => <p>Student workflow</p> }));

const classDetail = { classroom: { id: "ea-class-a", name: "Physics", joinCode: "ABCDEF0123456789" }, assignments: [{ id: "ea-task-a", title: "Collisions", createdAt: "" }], members: [] };
const saved = { class_id: "ea-class-a", status: "saved", locale: "rural", groups: ["hispanic_latino", "white"], groupAlternative: null, classType: "honors", englishLearners: true, iepOr504: false, updated_at: "" };

beforeEach(() => {
  mocks.query = ""; mocks.role = "teacher"; mocks.profile = null; mocks.adds = []; mocks.saves = []; mocks.addReply = null; mocks.profileReadFails = false; mocks.push.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
    if (input.startsWith("/api/class-profile")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        mocks.saves.push(body);
        mocks.profile = { ...saved, ...body.profile };
      }
      if (mocks.profileReadFails) return reply({ error: "Storage unavailable" }, false);
      return reply({ classProfile: mocks.profile });
    }
    if (input.startsWith("/api/workspace?classId=ea-class-a&assignmentId")) return reply({ user: { ...teacher, classId: "ea-class-a", assignmentId: "ea-task-a" } });
    if (input === "/api/workspace" && init?.method === "POST") {
      mocks.adds.push(JSON.parse(String(init.body)));
      return mocks.addReply ? mocks.addReply() : reply({ classroom: { id: "ea-class-new" } });
    }
    if (input.startsWith("/api/workspace?classId")) return reply(classDetail);
    if (input.startsWith("/api/workspace")) return reply({ classes: [{ id: "ea-class-a", name: "Physics" }] });
    throw new Error(`Unexpected request ${input}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const profileRequests = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/class-profile"));
const openAddClass = async () => {
  render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Add class" }));
  return screen.getByRole("dialog", { name: "Add a class" });
};
const nameBox = (dialog: HTMLElement) => within(dialog).getByLabelText("Class name") as HTMLInputElement;
const submitButton = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Add class" }) as HTMLButtonElement;

it("asks for the name and the class profile in one step, and saves them together", async () => {
  const dialog = await openAddClass();
  expect(document.activeElement).toBe(nameBox(dialog));
  // Same wording as the design.
  expect(within(dialog).getByText("Tell EngageAgent about this class")).toBeTruthy();
  expect(within(dialog).getByText("Used only to tailor materials. Never used to describe or label students.")).toBeTruthy();
  expect(within(dialog).getByText("Which best describes where your school is located?")).toBeTruthy();
  expect(within(dialog).getByText("Which groups are most represented in this class?")).toBeTruthy();
  expect(within(dialog).getByText("What type of class is this?")).toBeTruthy();

  fireEvent.change(nameBox(dialog), { target: { value: "  Biology  " } });
  fireEvent.click(within(dialog).getByRole("button", { name: /^Suburb/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "White" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Asian" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Honors" }));
  fireEvent.click(within(dialog).getByLabelText("Includes English learners (ELs)"));
  fireEvent.click(submitButton(dialog));

  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/teacher/classes?classId=ea-class-new"));
  expect(mocks.adds).toEqual([{ action: "createClass", name: "  Biology  ", profile: {
    locale: "suburb", groups: ["white", "asian"], groupAlternative: null, classType: "honors", englishLearners: true, iepOr504: false,
  } }]);
  // One request does it all, and the dialog is gone.
  expect(profileRequests()).toHaveLength(0);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("adds a class with only a name, without saving a blank profile", async () => {
  const dialog = await openAddClass();
  fireEvent.change(nameBox(dialog), { target: { value: "Biology" } });
  fireEvent.click(submitButton(dialog));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  expect(mocks.adds).toEqual([{ action: "createClass", name: "Biology" }]);
});

it("counts a checkbox or Not sure as an answer", async () => {
  const dialog = await openAddClass();
  fireEvent.change(nameBox(dialog), { target: { value: "Biology" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Not sure" }));
  fireEvent.click(submitButton(dialog));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  expect(mocks.adds[0].profile).toMatchObject({ groupAlternative: "not_sure", groups: [] });
});

it("needs a class name first, even when Enter is pressed", async () => {
  const dialog = await openAddClass();
  expect(submitButton(dialog).disabled).toBe(true);
  fireEvent.change(nameBox(dialog), { target: { value: "   " } });
  expect(submitButton(dialog).disabled).toBe(true);
  fireEvent.submit(nameBox(dialog).form!);
  expect(mocks.adds).toHaveLength(0);
  fireEvent.change(nameBox(dialog), { target: { value: "Biology" } });
  expect(submitButton(dialog).disabled).toBe(false);
});

it("adds only one class when it is submitted twice", async () => {
  let finish: (reply: unknown) => void = () => {};
  mocks.addReply = () => new Promise(resolve => { finish = resolve; });
  const dialog = await openAddClass();
  fireEvent.change(nameBox(dialog), { target: { value: "Biology" } });
  fireEvent.submit(nameBox(dialog).form!);
  fireEvent.submit(nameBox(dialog).form!);
  expect(await within(dialog).findByRole("button", { name: "Saving…" })).toBeTruthy();
  expect(mocks.adds).toHaveLength(1);
  // Escape can't close it midway.
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Add a class" })).toBeTruthy();
  finish({ ok: true, json: async () => ({ classroom: { id: "ea-class-new" } }) });
  await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
});

it("keeps everything typed when adding fails, including a reply that isn't JSON", async () => {
  mocks.addReply = () => ({ ok: false, json: async () => ({ error: "Storage unavailable" }) });
  const dialog = await openAddClass();
  fireEvent.change(nameBox(dialog), { target: { value: "Biology" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Honors" }));
  fireEvent.click(submitButton(dialog));
  await within(dialog).findByText("Storage unavailable");
  expect(nameBox(dialog).value).toBe("Biology");
  expect(within(dialog).getByRole("button", { name: "Honors" }).getAttribute("aria-pressed")).toBe("true");
  expect(submitButton(dialog).disabled).toBe(false);
  expect(mocks.push).not.toHaveBeenCalled();

  mocks.addReply = () => ({ ok: false, json: async () => { throw new SyntaxError("Unexpected token <"); } });
  fireEvent.click(submitButton(dialog));
  await within(dialog).findByText("Couldn't add the class.");
});

it("Cancel and Escape add nothing, and focus goes back to the Add class button", async () => {
  const dialog = await openAddClass();
  fireEvent.change(nameBox(dialog), { target: { value: "Biology" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add class" }));

  fireEvent.click(screen.getByRole("button", { name: "Add class" }));
  // It starts fresh next time.
  expect(nameBox(screen.getByRole("dialog", { name: "Add a class" })).value).toBe("");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.adds).toHaveLength(0);
});

it("doesn't pop up on a class page, even with no profile, and offers to add it there", async () => {
  mocks.query = "classId=ea-class-a";
  render(<Workspace />);
  const section = await screen.findByRole("region", { name: "Class profile" });
  await within(section).findByText("Not set yet.");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(profileRequests()[0][0]).toBe("/api/class-profile?classId=ea-class-a");

  fireEvent.click(within(section).getByRole("button", { name: "Add class profile" }));
  const dialog = await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" });
  expect(within(dialog).queryByRole("button", { name: "Skip for now" })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: /^Rural/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Honors" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.saves[0]).toMatchObject({ classId: "ea-class-a", profile: { locale: "rural", classType: "honors" } });
  expect(mocks.saves[0]).not.toHaveProperty("assignmentId");
  expect(within(section).getByText("Rural")).toBeTruthy();
  expect(screen.getByText("Class profile saved")).toBeTruthy();
});

it("shows a saved profile above the tasks, and Edit opens it filled in", async () => {
  mocks.query = "classId=ea-class-a"; mocks.profile = saved;
  render(<Workspace />);
  const section = await screen.findByRole("region", { name: "Class profile" });
  await within(section).findByText("Rural");
  expect(within(section).getByText("Hispanic or Latino, White")).toBeTruthy();
  expect(within(section).getByText("Honors")).toBeTruthy();
  expect(within(section).getByText("English learners")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(section.compareDocumentPosition(screen.getByLabelText("New task title")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(within(section).getByRole("button", { name: "Edit class profile" }));
  const dialog = await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" });
  expect(within(dialog).getByRole("button", { name: /^Rural/ }).getAttribute("aria-pressed")).toBe("true");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
});

it("treats an older skipped profile as not set", async () => {
  mocks.query = "classId=ea-class-a"; mocks.profile = { ...saved, status: "skipped", locale: null, groups: [], classType: null, englishLearners: false };
  render(<Workspace />);
  const section = await screen.findByRole("region", { name: "Class profile" });
  await within(section).findByText("Not set yet.");
  expect(within(section).getByRole("button", { name: "Add class profile" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("tells the teacher when the class was added but its profile didn't save, until it is added again", async () => {
  mocks.addReply = () => ({ ok: true, json: async () => ({ classroom: { id: "ea-class-a" }, profileSaved: false }) });
  const page = render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Add class" }));
  const dialog = screen.getByRole("dialog", { name: "Add a class" });
  fireEvent.change(nameBox(dialog), { target: { value: "Physics" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Honors" }));
  fireEvent.click(submitButton(dialog));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/teacher/classes?classId=ea-class-a"));

  // What the router does next: the same page, now on the new class.
  mocks.query = "classId=ea-class-a";
  page.rerender(<Workspace />);

  const section = await screen.findByRole("region", { name: "Class profile" });
  expect((await within(section).findByRole("alert")).textContent).toContain("didn't save");
  // No error on the page itself, and no pop-up.
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(within(section).queryByText("Not set yet.")).toBeNull();

  fireEvent.click(await within(section).findByRole("button", { name: "Add class profile" }));
  const form = await screen.findByRole("dialog", { name: "Tell EngageAgent about this class" });
  fireEvent.click(within(form).getByRole("button", { name: "Honors" }));
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await within(section).findByText("Honors");
  expect(within(section).queryByRole("alert")).toBeNull();
});

it("still warns that the profile didn't save when the profile can't be read either", async () => {
  mocks.addReply = () => ({ ok: true, json: async () => ({ classroom: { id: "ea-class-a" }, profileSaved: false }) });
  mocks.profileReadFails = true;
  const page = render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Add class" }));
  const dialog = screen.getByRole("dialog", { name: "Add a class" });
  fireEvent.change(nameBox(dialog), { target: { value: "Physics" } });
  fireEvent.click(submitButton(dialog));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  mocks.query = "classId=ea-class-a";
  page.rerender(<Workspace />);
  const section = await screen.findByRole("region", { name: "Class profile" });
  expect((await within(section).findByRole("alert")).textContent).toContain("didn't save");
});

it("only warns on the class whose profile didn't save", async () => {
  mocks.addReply = () => ({ ok: true, json: async () => ({ classroom: { id: "ea-class-other" }, profileSaved: false }) });
  const page = render(<Workspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Add class" }));
  const dialog = screen.getByRole("dialog", { name: "Add a class" });
  fireEvent.change(nameBox(dialog), { target: { value: "Other" } });
  fireEvent.click(submitButton(dialog));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  mocks.query = "classId=ea-class-a";
  page.rerender(<Workspace />);
  const section = await screen.findByRole("region", { name: "Class profile" });
  await within(section).findByText("Not set yet.");
  expect(within(section).queryByRole("alert")).toBeNull();
});

it("shows an error instead of crashing if the server doesn't send the new class back", async () => {
  mocks.addReply = () => ({ ok: true, json: async () => ({}) });
  const dialog = await openAddClass();
  fireEvent.change(nameBox(dialog), { target: { value: "Biology" } });
  fireEvent.click(submitButton(dialog));
  await within(dialog).findByText("Couldn't add the class.");
  expect(mocks.push).not.toHaveBeenCalled();
});

it("isn't offered to students or in Gallery, and the profile isn't on student, list or task pages", async () => {
  mocks.role = "student";
  render(<Workspace />);
  await screen.findByRole("button", { name: "Join class" });
  expect(screen.queryByRole("button", { name: "Add class" })).toBeNull();
  cleanup();

  mocks.query = "classId=ea-class-a";
  render(<Workspace />);
  await screen.findByText("Collisions");
  expect(screen.queryByRole("region", { name: "Class profile" })).toBeNull();
  cleanup();

  mocks.role = "teacher"; mocks.query = "view=gallery";
  render(<Workspace />);
  await screen.findByRole("heading", { name: "Choose a class for your materials" });
  expect(screen.queryByRole("button", { name: "Add class" })).toBeNull();
  cleanup();

  mocks.query = "classId=ea-class-a&view=gallery";
  render(<Workspace />);
  await screen.findByRole("heading", { name: "Choose a task for your materials" });
  expect(screen.queryByRole("region", { name: "Class profile" })).toBeNull();
  cleanup();

  mocks.query = "classId=ea-class-a&assignmentId=ea-task-a";
  render(<Workspace />);
  await screen.findByText("Teacher workflow");
  expect(screen.queryByRole("region", { name: "Class profile" })).toBeNull();

  expect(profileRequests()).toHaveLength(0);
});

it("the class list has only the Add class button, and class pages still make tasks", async () => {
  render(<Workspace />);
  await screen.findByRole("button", { name: "Add class" });
  expect(screen.queryByLabelText("New class name")).toBeNull();
  expect(screen.queryByLabelText("Class code")).toBeNull();
  cleanup();

  mocks.query = "classId=ea-class-a";
  render(<Workspace />);
  await screen.findByLabelText("New task title");
  expect(screen.queryByRole("button", { name: "Add class" })).toBeNull();
});
