"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { UserContext } from "@/lib/auth";
import { clearVerifiedClientAuth, setVerifiedClientAuth } from "@/lib/client-auth";
import {
  getMockUser,
  MOCK_USER_QUERY_PARAM,
  MOCK_USER_STORAGE_KEY,
  parseMockUserRole,
  type MockUserRole,
} from "@/lib/mock-auth";

type AuthState = {
  user: UserContext | null;
  loading: boolean;
  error: string | null;
};

const AuthCtx = createContext<AuthState>({
  user: null,
  loading: true,
  error: null,
});

const TOKEN_STORAGE_KEY = "engage-sso-token";
const EMBEDDED_LAUNCH_STATE = "engageEmbeddedLaunch";
type EmbeddedLaunchScope = { classId: string; assignmentId: string };

function embeddedLaunchScope(): EmbeddedLaunchScope | null {
  const scope = window.history.state?.[EMBEDDED_LAUNCH_STATE];
  return scope && typeof scope.classId === "string" && scope.classId
    && !scope.classId.startsWith("ea-class-") && typeof scope.assignmentId === "string" && scope.assignmentId
    ? { classId: scope.classId, assignmentId: scope.assignmentId } : null;
}

function rememberEmbeddedLaunch(scope: EmbeddedLaunchScope | null) {
  const state = { ...window.history.state };
  if (scope) state[EMBEDDED_LAUNCH_STATE] = scope;
  else delete state[EMBEDDED_LAUNCH_STATE];
  // This non-secret marker belongs to this history entry, not every future
  // visit to EngageAgent. The stored credential must still be verified.
  window.history.replaceState(state, "", window.location.href);
}

export const useAuth = () => useContext(AuthCtx);

export function readStoredSSOToken(): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSSOToken(token: string) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // The verified identity remains available in memory for this embedded visit.
  }
}

function clearStoredSSOToken() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function readStoredMockUser(): UserContext | null {
  if (typeof window === "undefined") return null;

  try {
    const role = parseMockUserRole(
      window.sessionStorage.getItem(MOCK_USER_STORAGE_KEY),
    );
    return role ? getMockUser(role) : null;
  } catch {
    return null;
  }
}

function storeMockUser(role: MockUserRole) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(MOCK_USER_STORAGE_KEY, role);
  } catch {
    // Ignore storage failures and fall back to query-param auth only.
  }
}

function clearStoredMockUser() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(MOCK_USER_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function replaceUrlSearchParam(name: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete(name);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

function parseSSOFromUrl(): string | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const token = url.searchParams.get("sso_token");
  if (!token) {
    return null;
  }

  replaceUrlSearchParam("sso_token");
  return token;
}

function parseMockUserFromUrl(): UserContext | null {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const role = parseMockUserRole(url.searchParams.get(MOCK_USER_QUERY_PARAM));
  if (!role) {
    return null;
  }

  clearStoredSSOToken();
  storeMockUser(role);
  replaceUrlSearchParam(MOCK_USER_QUERY_PARAM);

  return getMockUser(role);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialUrlToken = useRef<string | null>(null);
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    clearVerifiedClientAuth();
    const run = async () => {
      const authenticateToken = async (token: string, expectedScope?: EmbeddedLaunchScope) => {
        try {
          const res = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(
              (body as Record<string, string>).error ?? "Authentication failed.",
            );
          }
          const data = await res.json();
          if (!active) return;
          const verifiedUser = data.user as UserContext;
          if (expectedScope && (verifiedUser.classId !== expectedScope.classId || verifiedUser.assignmentId !== expectedScope.assignmentId)) {
            throw new Error("Reopen this activity from GENIUS to sign in.");
          }
          storeSSOToken(token);
          setVerifiedClientAuth(token, verifiedUser);
          rememberEmbeddedLaunch(verifiedUser.classId && verifiedUser.assignmentId && !verifiedUser.classId.startsWith("ea-class-")
            ? { classId: verifiedUser.classId, assignmentId: verifiedUser.assignmentId } : null);
          clearStoredMockUser();
          setState({ user: data.user as UserContext, loading: false, error: null });
        } catch (err) {
          if (!active) return;
          clearVerifiedClientAuth();
          clearStoredSSOToken();
          setState({
            user: null,
            loading: false,
            error: expectedScope ? "Reopen this activity from GENIUS to sign in."
              : err instanceof Error ? err.message : "Authentication failed.",
          });
        }
      };

      const standaloneWorkspace = /^\/(teacher|student)\/classes/.test(window.location.pathname);
      if (standaloneWorkspace) rememberEmbeddedLaunch(null);
      // Retain the removed URL credential across React's development effect
      // replay until verification finishes, without putting it back in the URL.
      const parsedToken = parseSSOFromUrl();
      const urlToken = standaloneWorkspace ? null : initialUrlToken.current || parsedToken;
      initialUrlToken.current = urlToken;
      if (urlToken) {
        await authenticateToken(urlToken);
        return;
      }

      const launchScope = standaloneWorkspace ? null : embeddedLaunchScope();
      if (launchScope) {
        const storedToken = readStoredSSOToken();
        if (storedToken) await authenticateToken(storedToken, launchScope);
        else setState({ user: null, loading: false, error: "Reopen this activity from GENIUS to sign in." });
        return;
      }

      const embeddedToken = !standaloneWorkspace && window.self !== window.top ? readStoredSSOToken() : null;
      if (embeddedToken) {
        await authenticateToken(embeddedToken);
        return;
      }

      // Standalone navigation uses the application's HttpOnly session, not an iframe token.
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (!active) return;
        if (response.ok) {
          const data = await response.json();
          if (!active) return;
          if (data.user?.geniusId) {
            rememberEmbeddedLaunch(null);
            clearStoredSSOToken();
            clearStoredMockUser();
            setState({ user: data.user, loading: false, error: null });
            return;
          }
        }
        if (response.status !== 401) throw new Error("Session check failed.");
      } catch {
        setState({ user: null, loading: false, error: "Unable to check your session. Please try again." });
        return;
      }

      if (standaloneWorkspace) {
        clearStoredSSOToken();
        setState({ user: null, loading: false, error: null });
        return;
      }

      const mockUserFromUrl = parseMockUserFromUrl();
      if (mockUserFromUrl) {
        await Promise.resolve();
        setState({ user: mockUserFromUrl, loading: false, error: null });
        return;
      }

      const storedToken = readStoredSSOToken();
      if (storedToken) {
        await authenticateToken(storedToken);
        return;
      }

      const storedMockUser = process.env.NODE_ENV === "production" ? null : readStoredMockUser();
      if (storedMockUser) {
        await Promise.resolve();
        setState({ user: storedMockUser, loading: false, error: null });
        return;
      }

      await Promise.resolve();
      rememberEmbeddedLaunch(null);
      setState({ user: null, loading: false, error: new URL(window.location.href).searchParams.has("signInError") ? "GENIUS sign-in could not be completed. Please try again." : null });
    };
    run();
    return () => { active = false; clearVerifiedClientAuth(); };
  }, []);

  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}
