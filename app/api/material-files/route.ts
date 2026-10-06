import { NextResponse } from "next/server";
import { hostMaterialFile } from "@/lib/material-files";
import { SlideRequestError } from "@/lib/slides/server";
import { WorkspaceError } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    return NextResponse.json(await hostMaterialFile(request), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SlideRequestError || error instanceof WorkspaceError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Material file hosting failed", { type: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: "File hosting is unavailable. Use the local save link." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
