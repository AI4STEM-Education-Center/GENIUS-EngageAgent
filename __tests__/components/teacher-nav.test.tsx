// @vitest-environment jsdom
// The teacher's top menu (#208): My class, Tasks, Lessons, Dashboard, Gallery.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AppHeader from "@/app/components/layout/AppHeader";
import { teacherNavActions } from "@/app/components/layout/teacherNav";

vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => ({ isGeniusEmbed: false }) }));
afterEach(cleanup);

const header = (actions: ReturnType<typeof teacherNavActions>) => {
  render(<AppHeader userName="Ms. Patel" homeHref="/teacher/classes" actions={actions} />);
  return within(screen.getByRole("navigation", { name: "EngageAgent" }));
};
const labels = () => Array.from(screen.getByRole("navigation", { name: "EngageAgent" }).querySelectorAll("a, button"), item => item.textContent);

it("lists the five items in order, linked to the class in view", () => {
  const menu = header(teacherNavActions({ classId: "ea-class-1", current: "tasks" }));
  expect(labels()).toEqual(["My class", "Tasks", "Lessons", "Dashboard", "Gallery"]);
  expect(menu.getByRole("link", { name: "My class" }).getAttribute("href")).toBe("/teacher/classes");
  expect(menu.getByRole("link", { name: "Tasks" }).getAttribute("href")).toBe("/teacher/classes?classId=ea-class-1");
  expect(menu.getByRole("link", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
  expect(menu.getByRole("link", { name: "Lessons" }).getAttribute("href")).toBe("/teacher/lessons");
  expect(menu.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/teacher/classes?classId=ea-class-1&view=dashboard");
  expect(menu.getByRole("link", { name: "Gallery" }).getAttribute("href")).toBe("/teacher/classes?classId=ea-class-1&view=gallery");
});

it("waits for a class before Tasks and Dashboard, and says why", () => {
  const menu = header(teacherNavActions({ current: "lessons" }));
  expect(labels()).toEqual(["My class", "Tasks", "Lessons", "Dashboard", "Gallery"]);
  for (const name of ["Tasks", "Dashboard"]) {
    const item = menu.getByRole("button", { name }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("Choose a class first");
  }
  expect(menu.getByRole("link", { name: "Lessons" }).getAttribute("aria-current")).toBe("page");
  expect(menu.getByRole("link", { name: "Gallery" }).getAttribute("href")).toBe("/teacher/classes?view=gallery");
});

it("opens a task's gallery in place", () => {
  const openGallery = vi.fn();
  const menu = header(teacherNavActions({ classId: "ea-class-1", gallery: { onClick: openGallery, active: true } }));
  const gallery = menu.getByRole("button", { name: "Gallery" });
  expect(gallery.getAttribute("aria-current")).toBe("page");
  fireEvent.click(gallery);
  expect(openGallery).toHaveBeenCalledTimes(1);
});

it("keeps Tasks and Dashboard for EngageAgent's own classes; a GENIUS class opens its tasks from GENIUS", () => {
  const menu = header(teacherNavActions({ classId: "genius-class-42" }));
  for (const name of ["Tasks", "Dashboard"]) {
    const item = menu.getByRole("button", { name }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("Open this class's tasks from GENIUS");
  }
  expect(menu.getByRole("link", { name: "Gallery" }).getAttribute("href")).toBe("/teacher/classes?view=gallery");
});
