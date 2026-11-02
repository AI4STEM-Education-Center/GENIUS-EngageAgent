// @vitest-environment jsdom
// The student's top menu (#180): "My classes" and "Class tasks" beside the profile.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { studentNavActions } from "@/app/components/layout/studentNav";

vi.mock("@/lib/genius-notify", () => ({ notifyTaskCompleted: vi.fn(), notifyTaskReopened: vi.fn() }));
vi.mock("@/app/components/StudentQuizView", () => ({ default: () => <section aria-label="Quiz content" /> }));
vi.mock("@/app/components/StudentContentReviewView", () => ({ default: () => <section aria-label="Materials content" /> }));
import StudentView from "@/app/components/StudentView";

const student: UserContext = { geniusId: "s", userId: "s", name: "Sam Student", email: null, role: "student", classId: "ea-class-one", assignmentId: "ea-task-one" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ activities: [] }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const menu = () => within(screen.getByRole("navigation", { name: "EngageAgent" }));

it("links a workspace student to their classes and this class's tasks", () => {
  render(<StudentView user={student} shell={{ homeHref: "/student/classes", classHref: "/student/classes?classId=ea-class-one", canSignOut: true }} />);
  expect(menu().getByRole("link", { name: "My classes" }).getAttribute("href")).toBe("/student/classes");
  expect(menu().getByRole("link", { name: "Class tasks" }).getAttribute("href")).toBe("/student/classes?classId=ea-class-one");
  expect(menu().getByText("Sam Student")).toBeTruthy();
});

it("shows no links inside GENIUS, which has its own navigation", () => {
  render(<StudentView user={student} shell={{ taskTitle: "Lesson 1" }} />);
  expect(menu().queryByText("My classes")).toBeNull();
  expect(menu().queryByText("Class tasks")).toBeNull();
});

it("marks the page the student is on", () => {
  const onClasses = studentNavActions({ homeHref: "/student/classes" }, "classes");
  expect(onClasses.map(a => [a.label, a.active])).toEqual([["My classes", true]]);
  const inClass = studentNavActions({ homeHref: "/student/classes", classHref: "/student/classes?classId=c" }, "tasks");
  expect(inClass.map(a => [a.label, a.active])).toEqual([["My classes", false], ["Class tasks", true]]);
});
