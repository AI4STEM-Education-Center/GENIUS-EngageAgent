// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import DashboardPage from "@/app/dashboard/page";
import { useAuth } from "@/app/components/AuthContext";
import type { UserContext } from "@/lib/auth";
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

vi.mock("@/app/components/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/app/components/TeacherView", () => ({ default: () => <p>Teacher workflow</p> }));
vi.mock("@/app/components/StudentView", () => ({ default: () => <p>Student workflow</p> }));
vi.mock("@/app/components/TeacherDashboardView", () => ({ default: () => <p>Teacher dashboard</p> }));

const user: UserContext = {
  geniusId: "teacher-1", userId: "teacher-1", name: "Teacher", email: null,
  role: "teacher", classId: "class-1", assignmentId: "assignment-1",
};

beforeEach(() => {
  replace.mockClear();
  vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, error: null });
});
afterEach(cleanup);

describe.each([
  ["home", Home],
  ["dashboard", DashboardPage],
] as const)("%s direct entry", (_name, Page) => {
  it("offers normal GENIUS sign-in when there is no session", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { name: "EngageAgent" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("No SSO token provided.")).toBeNull();
    expect(screen.queryByText("Authentication Required")).toBeNull();
    const link = screen.getByRole("link", { name: "Sign in with GENIUS" });
    expect(link.getAttribute("href")).toBe("/api/auth/start");
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("referrerPolicy")).toBe("no-referrer");
    expect(screen.queryByText(/Teacher workflow|Student workflow|Teacher dashboard/)).toBeNull();
  });

  it("offers reauthentication without exposing raw verification errors", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, error: "signature verification failed" });
    render(<Page />);
    expect(screen.getByRole("alert").textContent).toContain("session could not be verified");
    expect(screen.queryByText("signature verification failed")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in with GENIUS" })).toBeTruthy();
  });

  it("waits for verification instead of showing sign-in while loading", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: true, error: null });
    render(<Page />);
    expect(screen.getByText("Authenticating...")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in with GENIUS" })).toBeNull();
  });
});

describe("authenticated routing", () => {
  it.each(["teacher", "student", "guest"] as const)("opens the independent %s workspace without an assignment", role => {
    vi.mocked(useAuth).mockReturnValue({ user: { ...user, role, classId: undefined, assignmentId: undefined }, loading: false, error: null });
    render(<Home />);
    expect(replace).toHaveBeenCalledWith(role === "teacher" ? "/teacher/classes" : "/student/classes");
    expect(screen.queryByText(/Teacher workflow|Student workflow/)).toBeNull();
  });
  it("preserves the teacher home workflow", () => {
    vi.mocked(useAuth).mockReturnValue({ user, loading: false, error: null });
    render(<Home />);
    expect(screen.getByText("Teacher workflow")).toBeTruthy();
  });

  it.each(["student", "guest"] as const)("preserves the %s home workflow", (role) => {
    vi.mocked(useAuth).mockReturnValue({ user: { ...user, role }, loading: false, error: null });
    render(<Home />);
    expect(screen.getByText("Student workflow")).toBeTruthy();
  });

  it("preserves the authenticated teacher dashboard", () => {
    vi.mocked(useAuth).mockReturnValue({ user, loading: false, error: null });
    render(<DashboardPage />);
    expect(screen.getByText("Teacher dashboard")).toBeTruthy();
  });

  it.each(["student", "guest"] as const)("still denies %s access to the teacher dashboard", (role) => {
    vi.mocked(useAuth).mockReturnValue({ user: { ...user, role }, loading: false, error: null });
    render(<DashboardPage />);
    expect(screen.getByText("Teacher Dashboard Only")).toBeTruthy();
    expect(screen.queryByText("Teacher dashboard")).toBeNull();
  });
});
