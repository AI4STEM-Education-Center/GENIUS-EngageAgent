// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";
import AppHeader from "@/app/components/layout/AppHeader";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock("@/app/components/AuthContext", () => ({ useAuth: () => ({ isGeniusEmbed: false }) }));
const assign = vi.fn(), fetchMock = vi.fn();
beforeEach(() => {
  assign.mockReset(); fetchMock.mockReset(); sessionStorage.clear();
  const realWindow = window;
  vi.stubGlobal("window", new Proxy(realWindow, { get(target, key) { return key === "location" ? { assign } : Reflect.get(target, key); } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = { userName: "Teacher", homeHref: "#home", context: [{ label: "Physics", href: "#class" }], actions: [{ label: "Gallery", icon: null, href: "#gallery" }], canSignOut: true };

it.each([["EngageAgent", "#home"], ["Physics", "#class"], ["Gallery", "#gallery"]])("waits for the leave guard before navigating %s", (name, href) => {
  let proceed: (() => void) | undefined;
  const guard = vi.fn((next: () => void) => { proceed = next; });
  render(<AppHeader {...props} beforeNavigate={guard} />);
  const event = createEvent.click(screen.getByRole("link", { name }), { button: 0, cancelable: true });
  fireEvent(screen.getByRole("link", { name }), event);
  expect(event.defaultPrevented).toBe(true);
  expect(guard).toHaveBeenCalledTimes(1); expect(assign).not.toHaveBeenCalled();
  act(() => proceed?.());
  expect(assign).toHaveBeenCalledExactlyOnceWith(href);
});

it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])("preserves modified/new-tab links without leaving the current editor: %j", modifiers => {
  const guard = vi.fn(); render(<AppHeader {...props} beforeNavigate={guard} />);
  const link = screen.getByRole("link", { name: "Gallery" });
  const event = createEvent.click(link, { button: 0, cancelable: true, ...modifiers });
  fireEvent(link, event);
  expect(event.defaultPrevented).toBe(false);
  expect(guard).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
});

it("keeps ordinary links unchanged when no editor guard is provided", () => {
  render(<AppHeader {...props} />);
  const link = screen.getByRole("link", { name: "EngageAgent" });
  const event = createEvent.click(link, { button: 0, cancelable: true });
  fireEvent(link, event);
  expect(event.defaultPrevented).toBe(false); expect(assign).not.toHaveBeenCalled();
});

it("does not log out or clear the session until the teacher confirms leaving", async () => {
  sessionStorage.setItem("engage-sso-token", "synthetic-token");
  let proceed: (() => void) | undefined;
  const guard = vi.fn((next: () => void) => { proceed = next; });
  fetchMock.mockResolvedValue({ ok: true });
  render(<AppHeader {...props} beforeNavigate={guard} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out of EngageAgent" }));
  expect(guard).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("engage-sso-token")).toBe("synthetic-token");
  await act(async () => proceed?.());
  await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith("/"));
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/auth/logout", { method: "POST" });
  expect(sessionStorage.getItem("engage-sso-token")).toBeNull();
});

it("retains the session and reports a logout failure after the guard permits leaving", async () => {
  sessionStorage.setItem("engage-sso-token", "synthetic-token");
  fetchMock.mockResolvedValue({ ok: false });
  render(<AppHeader {...props} beforeNavigate={proceed => proceed()} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out of EngageAgent" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Unable to sign out");
  expect(assign).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("engage-sso-token")).toBe("synthetic-token");
});
