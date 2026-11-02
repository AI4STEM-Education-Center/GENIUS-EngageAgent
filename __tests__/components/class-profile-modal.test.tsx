// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ClassProfileModal, { useClassProfile } from "@/app/components/ClassProfileModal";
import { EMPTY_CLASS_PROFILE, type ClassProfile } from "@/lib/class-profile";

let fetchMock: ReturnType<typeof vi.fn>;
let reply: { ok: boolean; body: unknown };

beforeEach(() => {
  reply = { ok: true, body: { classProfile: { class_id: "c1", status: "saved" } } };
  fetchMock = vi.fn(async () => ({ ok: reply.ok, json: async () => reply.body }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (props: Partial<Parameters<typeof ClassProfileModal>[0]> = {}) => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <ClassProfileModal classId="c1" assignmentId="a1" firstVisit profile={null} onClose={onClose} onSaved={onSaved} {...props} />,
  );
  return { onClose, onSaved };
};

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const sentBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);

it("asks the three questions with the wording from the design", () => {
  open();
  expect(screen.getByRole("dialog", { name: "Tell EngageAgent about this class" })).toBeTruthy();
  expect(screen.getByText("Before you start · asked once")).toBeTruthy();
  expect(screen.getByText("Used only to tailor materials. Never used to describe or label students.")).toBeTruthy();
  expect(screen.getByText("Which best describes where your school is located?")).toBeTruthy();
  expect(screen.getByText("Which groups are most represented in this class?")).toBeTruthy();
  expect(screen.getByText("What type of class is this?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
});

it("saves the answers, with groups in the order they were picked", async () => {
  const { onSaved } = open();
  press(/^Suburb/);
  press("Asian");
  press("White");
  press("Honors");
  fireEvent.click(screen.getByLabelText("Includes English learners (ELs)"));
  expect(screen.getByText("Order: Asian, White")).toBeTruthy();

  press("Save");
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/class-profile");
  expect(sentBody()).toEqual({
    classId: "c1",
    assignmentId: "a1",
    profile: {
      locale: "suburb",
      groups: ["asian", "white"],
      groupAlternative: null,
      classType: "honors",
      englishLearners: true,
      iepOr504: false,
    },
  });
});

it("allows only three groups and explains why", () => {
  open();
  for (const group of ["Asian", "White", "Hispanic or Latino"]) press(group);
  press("Black or African American");
  expect(screen.getByText("Up to three — remove one first")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Black or African American" }).getAttribute("aria-pressed")).toBe("false");

  press("Asian");
  expect(screen.getByText("Order: White, Hispanic or Latino")).toBeTruthy();
});

it("clears the groups when Not sure is chosen", () => {
  open();
  press("Asian");
  press("Not sure");
  expect(screen.getByRole("button", { name: "Asian" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: "Not sure" }).getAttribute("aria-pressed")).toBe("true");
});

it("Skip for now records the skip on the first visit", async () => {
  const { onSaved } = open();
  press("Skip for now");
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(sentBody()).toEqual({ classId: "c1", assignmentId: "a1", skip: true });
});

it("opens later with the saved answers, and Cancel closes without saving", () => {
  const saved: ClassProfile = {
    ...EMPTY_CLASS_PROFILE,
    class_id: "c1",
    status: "saved",
    locale: "rural",
    groups: ["white"],
    updated_at: "",
  };
  const { onClose } = open({ firstVisit: false, profile: saved });
  expect(screen.getByText("Class profile")).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Rural/ }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "White" }).getAttribute("aria-pressed")).toBe("true");

  press("Cancel");
  expect(onClose).toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows the error and stays open when saving fails", async () => {
  reply = { ok: false, body: { error: "Choose up to 3 groups." } };
  const { onSaved } = open();
  press("Save");
  expect(await screen.findByText("Choose up to 3 groups.")).toBeTruthy();
  expect(onSaved).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
});

function Page({ enabled = true }: { enabled?: boolean }) {
  const classProfile = useClassProfile({ classId: "c1", assignmentId: "a1", enabled });
  return (
    <>
      <button type="button" onClick={classProfile.openEditor}>Open class profile</button>
      {classProfile.element}
    </>
  );
}

const respond = (...bodies: { ok: boolean; body: unknown }[]) => {
  fetchMock.mockImplementation(async () => {
    const next = bodies.length > 1 ? bodies.shift()! : bodies[0];
    return { ok: next.ok, json: async () => next.body };
  });
};

it("opens by itself on the teacher's first visit, then confirms the save", async () => {
  respond({ ok: true, body: { classProfile: null } }, { ok: true, body: { classProfile: { ...EMPTY_CLASS_PROFILE, class_id: "c1", status: "saved", updated_at: "" } } });
  render(<Page />);
  expect(await screen.findByText("Before you start · asked once")).toBeTruthy();
  expect(fetchMock.mock.calls[0][0]).toBe("/api/class-profile?classId=c1&assignmentId=a1");
  expect(document.activeElement).toBe(screen.getByRole("dialog"));

  press("Save");
  expect(await screen.findByText("Class profile saved")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("does not open by itself once the teacher has saved or skipped", async () => {
  respond({ ok: true, body: { classProfile: { ...EMPTY_CLASS_PROFILE, class_id: "c1", status: "skipped", updated_at: "" } } });
  render(<Page />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();

  press("Open class profile");
  expect(screen.getByText("Class profile")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
});

it("stays closed when the profile can't be loaded or there is no class", async () => {
  respond({ ok: false, body: { error: "Sign-in required." } });
  render(<Page />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();
  cleanup();

  fetchMock.mockClear();
  render(<Page enabled={false} />);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("Skip for now closes without the saved message", async () => {
  respond({ ok: true, body: { classProfile: null } }, { ok: true, body: { classProfile: { ...EMPTY_CLASS_PROFILE, class_id: "c1", status: "skipped", updated_at: "" } } });
  render(<Page />);
  await screen.findByRole("button", { name: "Skip for now" });
  press("Skip for now");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByText("Class profile saved")).toBeNull();
});
