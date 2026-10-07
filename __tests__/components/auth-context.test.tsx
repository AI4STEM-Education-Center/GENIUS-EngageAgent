// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import { AuthProvider, useAuth } from "@/app/components/AuthContext";

const fetchMock = vi.fn();
const storageKey = "engage-sso-token";
const teacher = {
  geniusId: "genius-teacher-1", userId: "genius-teacher-1", name: "Teacher",
  role: "teacher", classId: "class-1", assignmentId: "assignment-1",
};

function AuthProbe() {
  const state = useAuth();
  return <output data-testid="auth-state">{JSON.stringify(state)}</output>;
}

function mount() {
  return render(<AuthProvider><AuthProbe /></AuthProvider>);
}

async function settled() {
  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId("auth-state").textContent!).loading).toBe(false);
  });
  return JSON.parse(screen.getByTestId("auth-state").textContent!);
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ user: null }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AuthProvider", () => {
  it("treats direct visits as signed out, not an authentication error", async () => {
    mount();
    expect(await settled()).toEqual({ user: null, loading: false, error: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", { cache: "no-store" });
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("verifies fresh GENIUS tokens and preserves teacher, class, assignment and geniusId", async () => {
    window.history.replaceState({}, "", "/?sso_token=fresh-token&lesson=2#quiz");
    window.sessionStorage.setItem(storageKey, "old-token");
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: teacher }) });
    mount();
    expect(await settled()).toEqual({ user: teacher, loading: false, error: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "fresh-token" }),
    });
    expect(window.sessionStorage.getItem(storageKey)).toBe("fresh-token");
    expect(scopedClientAuthHeaders(teacher)).toEqual({ Authorization: "Bearer fresh-token" });
    expect(window.location.search).toBe("?lesson=2");
    expect(window.location.hash).toBe("#quiz");
  });

  it("reverifies a stored token when revisiting the app", async () => {
    window.sessionStorage.setItem(storageKey, "stored-token");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: teacher }) });
    mount();
    expect((await settled()).user).toEqual(teacher);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ token: "stored-token" });
  });

  it.each(["expired", "invalid signature"])("rejects and clears an %s stored token", async (error) => {
    window.sessionStorage.setItem(storageKey, "rejected-token");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error }) });
    mount();
    expect(await settled()).toEqual({ user: null, loading: false, error });
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("does not accept an unverified token during a network failure", async () => {
    window.history.replaceState({}, "", "/?sso_token=unverified-token");
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    mount();
    expect(await settled()).toEqual({ user: null, loading: false, error: "Network unavailable" });
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("shows normal signed-out state when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage denied"); });
    mount();
    expect(await settled()).toEqual({ user: null, loading: false, error: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", { cache: "no-store" });
  });

  it("restores a standalone session and discards stale iframe credentials", async () => {
    window.history.replaceState({}, "", "/teacher/classes");
    window.sessionStorage.setItem(storageKey, "old-iframe-token");
    const identity = { ...teacher, classId: undefined, assignmentId: undefined };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: identity }) });
    mount();
    expect((await settled()).user).toEqual(identity);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scopedClientAuthHeaders(teacher)).toEqual({});
  });

  it("does not use legacy credentials to enter a standalone workspace", async () => {
    window.history.replaceState({}, "", "/student/classes");
    window.sessionStorage.setItem(storageKey, "old-iframe-token");
    mount();
    expect((await settled()).user).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it("keeps verified embedded API auth working in memory when third-party storage is disabled", async () => {
  window.history.replaceState({}, "", "/?sso_token=memory-only-token");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage denied"); });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: teacher }) });
  const view = mount();
  expect((await settled()).user).toEqual(teacher);
  expect(scopedClientAuthHeaders(teacher)).toEqual({ Authorization: "Bearer memory-only-token" });
  expect(window.location.search).toBe("");
  view.unmount();
  expect(scopedClientAuthHeaders(teacher)).toEqual({});
});


it("verifies the original URL token during React effect replay without reviving an inactive request", async () => {
  window.history.replaceState({}, "", "/?sso_token=replay-token");
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: teacher }) });
  render(<StrictMode><AuthProvider><AuthProbe /></AuthProvider></StrictMode>);
  expect((await settled()).user).toEqual(teacher);
  expect(scopedClientAuthHeaders(teacher)).toEqual({ Authorization: "Bearer replay-token" });
  expect(window.location.search).toBe("");
  expect(fetchMock.mock.calls.every(([url]) => url === "/api/auth/verify")).toBe(true);
});

async function verifiedEmbeddedVisit() {
  window.history.replaceState({ existingFrameworkState: true }, "", "/?sso_token=embedded-launch-token");
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: teacher }) });
  const view = mount();
  expect((await settled()).user).toEqual(teacher);
  view.unmount();
  fetchMock.mockReset();
}

it("keeps a verified GENIUS launch scoped on top-level reload despite an unrelated standalone cookie", async () => {
  await verifiedEmbeddedVisit();
  const unrelated = { ...teacher, geniusId: "different-native-teacher", classId: undefined, assignmentId: undefined };
  fetchMock.mockImplementation(async url => ({ ok: true, json: async () => ({ user: url === "/api/auth/me" ? unrelated : teacher }) }));
  mount();
  expect((await settled()).user).toEqual(teacher);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/auth/verify"]);
  expect(scopedClientAuthHeaders(teacher)).toEqual({ Authorization: "Bearer embedded-launch-token" });
  expect(window.history.state.existingFrameworkState).toBe(true);
  expect(JSON.stringify(window.history.state)).not.toContain("embedded-launch-token");
  expect(window.location.href).not.toContain("embedded-launch-token");
});

it.each(["/teacher/classes", "/student/classes"])("uses the standalone cookie for an explicit %s visit and clears the embedded marker", async path => {
  await verifiedEmbeddedVisit();
  // Keep the prior history metadata to prove the explicit native route wins.
  window.history.replaceState(window.history.state, "", path);
  const native = { ...teacher, geniusId: "native-user", classId: undefined, assignmentId: undefined };
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: native }) });
  mount();
  expect((await settled()).user).toEqual(native);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/auth/me"]);
  expect(window.history.state).toEqual({ existingFrameworkState: true });
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  expect(scopedClientAuthHeaders(teacher)).toEqual({});
});

it.each(["expired", "invalid signature", "different task"])("fails closed for a marked launch with an %s credential instead of choosing a cookie identity", async reason => {
  await verifiedEmbeddedVisit();
  fetchMock.mockImplementation(async url => url === "/api/auth/me"
    ? { ok: true, json: async () => ({ user: { ...teacher, classId: undefined, assignmentId: undefined } }) }
    : reason === "different task"
      ? { ok: true, json: async () => ({ user: { ...teacher, assignmentId: "other-task" } }) }
      : { ok: false, json: async () => ({ error: reason }) });
  mount();
  expect(await settled()).toEqual({ user: null, loading: false, error: "Reopen this activity from GENIUS to sign in." });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/auth/verify"]);
  expect(scopedClientAuthHeaders(teacher)).toEqual({});
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
});

it("requires a fresh GENIUS launch when a marked page loses its stored credential", async () => {
  await verifiedEmbeddedVisit();
  window.sessionStorage.clear();
  mount();
  expect(await settled()).toEqual({ user: null, loading: false, error: "Reopen this activity from GENIUS to sign in." });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not give a stale token priority during a separate standalone root visit", async () => {
  await verifiedEmbeddedVisit();
  window.history.pushState({}, "", "/");
  const native = { ...teacher, classId: undefined, assignmentId: undefined };
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: native }) });
  mount();
  expect((await settled()).user).toEqual(native);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/auth/me"]);
  expect(window.history.state).toEqual({});
});
