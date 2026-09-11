import { NextResponse } from "next/server";
import { LOGIN_COOKIE, SESSION_COOKIE, sameOriginRequest, setCookie } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  setCookie(response, SESSION_COOKIE, "", 0);
  setCookie(response, LOGIN_COOKIE, "", 0);
  return response;
}
