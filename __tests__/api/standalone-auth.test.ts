import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { GET as start } from "@/app/api/auth/start/route";
import { GET as callback } from "@/app/api/auth/callback/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { readSigned, signSession, SESSION_COOKIE, LOGIN_COOKIE, challengeFor, sessionUser } from "@/lib/session";
import { verifySSOToken } from "@/lib/auth";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined }) }));
const origin = "https://engageagent.ai4genius.org";
const fetchMock = vi.fn();
beforeEach(() => { jar.clear(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("SSO_SECRET", "standalone-unit-test-secret-only"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function loginRequest() {
  const response = await start();
  const cookie = response.cookies.get(LOGIN_COOKIE)!;
  jar.set(LOGIN_COOKIE, cookie.value);
  const login = await readSigned(cookie.value, "login");
  return { response, cookie, login, request: new Request(`${origin}/api/auth/callback?code=${"c".repeat(43)}&state=${login.state}`) };
}
async function idToken(nonce: unknown, role = "teacher", audience = "engageagent-login") {
  return new SignJWT({ geniusId: "genius-123", role, name: "Real identity", email: null, nonce })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("genius-learning-platform").setSubject("genius-123")
    .setAudience(audience).setIssuedAt().setExpirationTime("60s").sign(new TextEncoder().encode(process.env.SSO_SECRET));
}

describe("standalone SSO", () => {
  it("starts PKCE S256 with a host-only, secure, HttpOnly state cookie", async () => {
    const { response, cookie, login } = await loginRequest();
    const url = new URL(response.headers.get("location")!);
    expect(url.origin).toBe("https://learn.ai4genius.org");
    expect(url.pathname).toBe("/api/sso/engage/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback`);
    expect(url.searchParams.get("code_challenge")).toBe(challengeFor(login.verifier as string));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
    expect(cookie.domain).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["teacher", "student", "guest"])("returns a verified %s to EngageAgent, not GENIUS", async role => {
    const { login, request } = await loginRequest();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id_token: await idToken(login.nonce, role) }) });
    const response = await callback(request);
    expect(response.headers.get("location")).toBe(`${origin}/${role === "teacher" ? "teacher" : "student"}/classes`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ code_verifier: login.verifier, redirect_uri: `${origin}/api/auth/callback` });
    const session = response.cookies.get(SESSION_COOKIE)!;
    expect(session).toMatchObject({ secure: true, httpOnly: true, maxAge: 28800 });
    expect(response.cookies.get(LOGIN_COOKIE)?.maxAge).toBe(0);
    jar.set(SESSION_COOKIE, session.value);
    expect(await (await me()).json()).toMatchObject({ user: { geniusId: "genius-123", role } });
    await expect(verifySSOToken(session.value)).rejects.toThrow();
  });
  it("rejects missing, tampered, and expired login cookies before exchanging a code", async () => {
    const { request } = await loginRequest();
    for (const value of ["", "tampered", await signSession({ state: "x" }, "login", -1)]) {
      jar.set(LOGIN_COOKIE, value);
      const response = await callback(request);
      expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
      expect(response.headers.get("location")).toBe(`${origin}/?signInError=1`);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects state mismatch without contacting GENIUS", async () => {
    await loginRequest();
    await callback(new Request(`${origin}/api/auth/callback?code=${"c".repeat(43)}&state=wrong`));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["nonce", "audience", "role", "exchange"])("rejects invalid %s without creating a session", async kind => {
    const { login, request } = await loginRequest();
    fetchMock.mockResolvedValue({ ok: kind !== "exchange", json: async () => ({ id_token: await idToken(kind === "nonce" ? "wrong" : login.nonce, kind === "role" ? "admin" : "teacher", kind === "audience" ? "other-app" : "engageagent-login") }) });
    const response = await callback(request);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(response.headers.get("location")).toContain("signInError=1");
  });
  it("rejects an expired application session", async () => {
    jar.set(SESSION_COOKIE, await signSession({ user: { geniusId: "genius-123", role: "teacher" } }, "session", -1));
    expect(await sessionUser()).toBeNull();
    expect((await me()).status).toBe(401);
  });
  it("requires same-origin logout and clears both cookies", async () => {
    expect((await logout(new Request(`${origin}/api/auth/logout`, { method: "POST", headers: { origin: "https://evil.example" } }))).status).toBe(403);
    const response = await logout(new Request(`${origin}/api/auth/logout`, { method: "POST", headers: { origin } }));
    expect(response.cookies.get(SESSION_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(LOGIN_COOKIE)?.maxAge).toBe(0);
  });
});
