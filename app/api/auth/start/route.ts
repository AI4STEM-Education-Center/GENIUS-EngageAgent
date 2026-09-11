import { NextResponse } from "next/server";
import { LOGIN_COOKIE, callbackUrl, challengeFor, geniusOrigin, randomValue, setCookie, signSession } from "@/lib/session";

export async function GET() {
  try {
    const state = randomValue(), nonce = randomValue(), verifier = randomValue();
    const destination = new URL("/api/sso/engage/authorize", geniusOrigin());
    destination.search = new URLSearchParams({
      redirect_uri: callbackUrl(), state, nonce,
      code_challenge: challengeFor(verifier), code_challenge_method: "S256",
    }).toString();
    const response = NextResponse.redirect(destination);
    setCookie(response, LOGIN_COOKIE, await signSession({ state, nonce, verifier }, "login", 600), 600);
    return response;
  } catch {
    return NextResponse.json({ error: "EngageAgent sign-in is not configured." }, { status: 503 });
  }
}
