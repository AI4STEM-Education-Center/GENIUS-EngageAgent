"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { UserContext } from "@/lib/auth";
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

export const useAuth = () => useContext(AuthCtx);

function readStoredSSOToken(): string | null {
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
    // Ignore storage failures and fall back to query-param auth only.
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
  window.history.replaceState({}, "", nextUrl);
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
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const run = async () => {
      const authenticateToken = async (token: string) => {
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
          storeSSOToken(token);
          clearStoredMockUser();
          setState({ user: data.user as UserContext, loading: false, error: null });
        } catch (err) {
          clearStoredSSOToken();
          setState({
            user: null,
            loading: false,
            error: err instanceof Error ? err.message : "Authentication failed.",
          });
        }
      };

      const urlToken = parseSSOFromUrl();
      if (urlToken) {
        await authenticateToken(urlToken);
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

      const storedMockUser = readStoredMockUser();
      if (storedMockUser) {
        await Promise.resolve();
        setState({ user: storedMockUser, loading: false, error: null });
        return;
      }

      await Promise.resolve();
      setState({ user: null, loading: false, error: null });
    };
    run();
  }, []);

  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}
