import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { UserContext } from "./auth";

export const SESSION_COOKIE = "engage-session-v1";
export const LOGIN_COOKIE = "engage-login-v1";
export const appOrigin = () => process.env.ENGAGE_APP_URL || "https://engageagent.ai4genius.org";
export const geniusOrigin = () => process.env.GENIUS_URL || "https://learn.ai4genius.org";
/** The window that embeds the GENIUS standard URLs and receives genius.task-* messages.
 * The new GENIUS may live on a different origin from SSO, so it can be set on its own.
 * Returns null rather than a wildcard when the value is not a valid http(s) origin. */
export const geniusEmbedOrigin = () => {
  try {
    const url = new URL(process.env.GENIUS_EMBED_ORIGIN || geniusOrigin());
    return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
  } catch { return null; }
};
/** Every GENIUS window that may host the standard URLs: the configured embed
 * origin first, then the other sites allowed to embed EngageAgent
 * (ALLOWED_ORIGINS), such as staging. Never a wildcard, never EngageAgent itself. */
export const geniusEmbedOrigins = () => {
  const origins: string[] = [];
  const primary = geniusEmbedOrigin();
  if (primary) origins.push(primary);
  let app: string | null = null;
  try { app = new URL(appOrigin()).origin; } catch { app = null; }
  for (const entry of (process.env.ALLOWED_ORIGINS ?? "").split(",").map(o => o.trim()).filter(Boolean)) {
    try {
      const url = new URL(entry);
      const allowed = url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
      if (allowed && url.origin !== app && !origins.includes(url.origin)) origins.push(url.origin);
    } catch { /* Not an origin. */ }
  }
  return origins;
};
export const callbackUrl =() => `${appOrigin()}/api/auth/callback`;
export const randomValue = () => randomBytes(32).toString("base64url");
export const challengeFor = (value: string) => createHash("sha256").update(value).digest("base64url");

function sessionKey() {
  const secret = process.env.SSO_SECRET;
  if (!secret) throw new Error("SSO_SECRET is not configured.");
  // Application sessions must not be interchangeable with GENIUS SSO tokens.
  return createHash("sha256").update(`engageagent-session-v1\0${secret}`).digest();
}

export async function signSession(payload: JWTPayload, purpose: "login" | "session", seconds: number) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" })
    .setIssuer("engageagent").setAudience(purpose).setIssuedAt()
    .setExpirationTime(`${seconds}s`).sign(sessionKey());
}

export async function readSigned(value: string, purpose: "login" | "session") {
  return (await jwtVerify(value, sessionKey(), {
    issuer: "engageagent", audience: purpose, algorithms: ["HS256"], requiredClaims: ["exp", "iat"],
  })).payload;
}

export function setCookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, {
    httpOnly: true, secure: appOrigin().startsWith("https:"), sameSite: "lax", path: "/", maxAge,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
}

export async function sessionUser(): Promise<UserContext | null> {
  try {
    const value = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!value) return null;
    const payload = await readSigned(value, "session");
    const user = payload.user as UserContext | undefined;
    if (!user?.geniusId || !["teacher", "student", "guest"].includes(user.role)) return null;
    return user;
  } catch { return null; }
}

export function sameOriginRequest(request: Request) {
  return request.headers.get("origin") === appOrigin();
}
