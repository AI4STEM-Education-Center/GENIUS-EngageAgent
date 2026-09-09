// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(window.location.search).toBe("?lesson=2");
    expect(window.location.hash).toBe("#quiz");
  });

  it("reverifies a stored token when revisiting the app", async () => {
    window.sessionStorage.setItem(storageKey, "stored-token");
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: teacher }) });
    mount();
    expect((await settled()).user).toEqual(teacher);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "stored-token" });
  });

  it.each(["expired", "invalid signature"])("rejects and clears an %s stored token", async (error) => {
    window.sessionStorage.setItem(storageKey, "rejected-token");
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
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
