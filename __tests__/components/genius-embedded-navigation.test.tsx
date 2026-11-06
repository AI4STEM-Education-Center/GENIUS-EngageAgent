// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/app/components/AuthContext";
import TeacherView from "@/app/components/TeacherView";
import StudentView from "@/app/components/StudentView";
import TeacherDashboardView from "@/app/components/TeacherDashboardView";
import type { UserContext } from "@/lib/auth";
import { lessonResponse } from "../fixtures/lesson-responses";

vi.mock("@/lib/genius-notify", () => ({ notifyTaskCompleted: vi.fn(), notifyTaskReopened: vi.fn() }));
vi.mock("@/app/components/StudentQuizView", () => ({ default: () => <section aria-label="Quiz content" /> }));
vi.mock("@/app/components/StudentContentReviewView", () => ({ default: () => <section aria-label="Materials content" /> }));
vi.mock("@/app/components/SurveyResultsSection", () => ({ default: () => null }));

const fetchMock = vi.fn();
let currentUser: UserContext;

function Workflow({ dashboard = false }: { dashboard?: boolean }) {
  const { user, loading } = useAuth();
  if (loading || !user) return <p>Signing in</p>;
  if (dashboard) return <TeacherDashboardView user={user} />;
  const shell = {
    homeHref: `/${user.role}/classes`,
    classHref: `/${user.role}/classes?classId=${user.classId}`,
    canSignOut: true,
    taskTitle: "Collisions",
  };
  return user.role === "teacher" ? <TeacherView user={user} shell={shell} /> : <StudentView user={user} shell={shell} />;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: string) => ({
    ok: true,
    json: async () => {
      if (input.startsWith("/api/auth/")) return { user: currentUser };
      if (input.startsWith("/api/material-gallery")) return { items: [] };
      const lesson = lessonResponse(input, undefined, { learning_objective: "Test objective" });
      if (lesson) return lesson;
      if (input.startsWith("/api/activity-status")) return { activities: [
        { id: "assessment", status: "available" },
        { id: "content-review", status: "available" },
        { id: "content-rating", status: "locked" },
      ] };
      return {};
    },
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function signIn(role: "teacher" | "student", embedded: boolean) {
  // Use the same task identifiers in each mode: verification, rather than an
  // identifier prefix or the presence of task context, determines embedding.
  currentUser = {
    geniusId: `genius-${role}`, userId: `genius-${role}`, name: `Test ${role}`,
    email: null, role, classId: "genius-class", assignmentId: "genius-assignment",
  };
  window.history.replaceState({}, "", embedded ? "/launch?sso_token=verified-launch" : `/${role}/classes`);
}

it.each(["teacher", "student"] as const)("keeps %s lesson steps usable while removing app navigation after verified GENIUS sign-in", async role => {
  signIn(role, true);
  const view = render(<AuthProvider><Workflow /></AuthProvider>);
  const steps = within(await screen.findByRole("navigation", { name: role === "teacher" ? "Teacher steps" : "Student steps" }));
  expect(steps.getAllByRole("button")).toHaveLength(4);
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "EngageAgent" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Gallery" })).toBeNull();
  expect(screen.queryByRole("link", { name: "My classes" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign out of EngageAgent" })).toBeNull();

  const next = steps.getByRole("button", { name: role === "teacher" ? /Strategy/ : /Explore and ask/ });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(next);
  expect(next.getAttribute("aria-current")).toBe("step");
  if (role === "teacher") {
    fireEvent.click(steps.getByRole("button", { name: /Questions & discussion/ }));
    expect(await screen.findByRole("heading", { name: "Questions & discussion" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Assignment summary" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to workflow" })).toBeNull();
  }

  // The token has been removed from the URL. A reload of this history entry
  // still verifies the persisted credential and suppresses the app header.
  view.unmount();
  fetchMock.mockClear();
  render(<AuthProvider><Workflow /></AuthProvider>);
  await screen.findByRole("navigation", { name: role === "teacher" ? "Teacher steps" : "Student steps" });
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/verify")).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/me")).toBe(false);
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "EngageAgent" })).toBeNull();
});

it.each(["teacher", "student"] as const)("preserves the %s app header and lesson steps for standalone cookie sessions", async role => {
  signIn(role, false);
  render(<AuthProvider><Workflow /></AuthProvider>);
  const header = within(await screen.findByRole("banner"));
  expect(header.getByRole("navigation", { name: "EngageAgent" })).toBeTruthy();
  expect(header.getByRole("button", { name: "Sign out of EngageAgent" })).toBeTruthy();
  expect(header.getByRole(role === "teacher" ? "button" : "link", { name: role === "teacher" ? "Gallery" : "My classes" })).toBeTruthy();
  const steps = within(screen.getByRole("navigation", { name: role === "teacher" ? "Teacher steps" : "Student steps" }));
  expect(steps.getAllByRole("button")).toHaveLength(4);
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/me")).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/verify")).toBe(false);
});

it("keeps Gallery reachable after a verified GENIUS launch in a new tab with no iframe", async () => {
  signIn("teacher", true);
  expect(window.top).toBe(window.self);
  function VerifiedLaunch() {
    const { isGeniusEmbed } = useAuth();
    return <><output aria-label="Verified GENIUS context">{String(isGeniusEmbed)}</output><Workflow /></>;
  }
  const view = render(<AuthProvider><VerifiedLaunch /></AuthProvider>);
  await screen.findByRole("navigation", { name: "Teacher steps" });
  await waitFor(() => expect(screen.getByLabelText("Verified GENIUS context").textContent).toBe("true"));
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "EngageAgent" })).toBeNull();
  const entry = within(screen.getByRole("navigation", { name: "Material library" })).getByRole("button", { name: "Gallery" });
  expect((entry as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(entry);
  expect(await screen.findByRole("region", { name: "Gallery workspace" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Teacher steps" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Engagement materials" })).toBeNull();
  expect(screen.queryByRole("banner")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to task" }));
  const assessment = within(screen.getByRole("navigation", { name: "Teacher steps" })).getByRole("button", { name: /Assessment/ });
  expect(assessment.getAttribute("aria-current")).toBe("step");
  // The verified history entry survives a reload after the launch token is removed.
  view.unmount(); fetchMock.mockClear();
  render(<AuthProvider><VerifiedLaunch /></AuthProvider>);
  expect(await screen.findByRole("navigation", { name: "Material library" })).toBeTruthy();
  expect(screen.getByLabelText("Verified GENIUS context").textContent).toBe("true");
  expect(screen.queryByRole("banner")).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/verify")).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/me")).toBe(false);
});

it.each([true, false])("shows legacy dashboard navigation only outside GENIUS (embedded: %s)", async embedded => {
  signIn("teacher", embedded);
  render(<AuthProvider><Workflow dashboard /></AuthProvider>);
  expect(await screen.findByRole("heading", { name: "Assignment summary" })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh dashboard" })).toBeTruthy());
  if (embedded) {
    expect(screen.queryByRole("link", { name: "Back to workflow" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Community Gallery" })).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  } else {
    expect(screen.getByRole("link", { name: "Back to workflow" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Community Gallery" })).toBeTruthy();
  }
});
