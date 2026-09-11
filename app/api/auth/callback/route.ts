import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySSOToken } from "@/lib/auth";
import { appOrigin, callbackUrl, geniusOrigin, LOGIN_COOKIE, readSigned, SESSION_COOKIE, setCookie, signSession } from "@/lib/session";

export async function GET(request: Request) {
  const fail = () => {
    const response = NextResponse.redirect(new URL("/?signInError=1", appOrigin()));
    setCookie(response, LOGIN_COOKIE, "", 0);
    return response;
  };
  try {
    const params = new URL(request.url).searchParams;
    const saved = (await cookies()).get(LOGIN_COOKIE)?.value;
    const code = params.get("code");
    if (!saved || !code || !/^[A-Za-z0-9_-]{43}$/.test(code)) return fail();
    const login = await readSigned(saved, "login");
    if (login.state !== params.get("state") || typeof login.nonce !== "string" || typeof login.verifier !== "string") return fail();
    const exchange = await fetch(new URL("/api/sso/engage/token", geniusOrigin()), {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ code, code_verifier: login.verifier, redirect_uri: callbackUrl() }),
      signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!exchange.ok) return fail();
    const data = await exchange.json();
    if (typeof data.id_token !== "string") return fail();
    const user = await verifySSOToken(data.id_token, { audience: "engageagent-login", nonce: login.nonce });
    const path = user.role === "teacher" ? "/teacher/classes" : "/student/classes";
    const response = NextResponse.redirect(new URL(path, appOrigin()));
    setCookie(response, LOGIN_COOKIE, "", 0);
    setCookie(response, SESSION_COOKIE, await signSession({ user }, "session", 8 * 3600), 8 * 3600);
    return response;
  } catch { return fail(); }
}
