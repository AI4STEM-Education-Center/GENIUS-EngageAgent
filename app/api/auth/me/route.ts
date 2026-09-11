import { NextResponse } from "next/server";
import { sessionUser } from "@/lib/session";

export async function GET() {
  const user = await sessionUser();
  return NextResponse.json({ user }, { status: user ? 200 : 401, headers: { "Cache-Control": "no-store" } });
}
