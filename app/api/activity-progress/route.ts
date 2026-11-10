import { NextResponse } from "next/server";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { computeActivityProgress } from "@/lib/activity-progress-server";

/**
 * GET ?classId&assignmentId → { progress }: how far the teacher has got
 * through the activity's four steps (#176). Teachers only: this path is not
 * on the guard's student allowlist.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  try {
    const progress = await computeActivityProgress(params.get("classId")!, params.get("assignmentId")!);
    return NextResponse.json({ progress }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Progress isn't available right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
