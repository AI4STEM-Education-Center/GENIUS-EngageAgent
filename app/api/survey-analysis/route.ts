import { NextResponse } from "next/server";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { getTaskInterests } from "@/lib/task-interests";

/**
 * Students' common daily experiences for a learning task (#114).
 *
 * GET ?classId&assignmentId → { interests: TaskInterests | null }
 *
 * The analysis updates automatically: if new survey responses have arrived
 * since it was saved, this request brings it up to date first (only the new
 * responses are analyzed). Server code can call getTaskInterests directly.
 *
 * Teacher-only in live GENIUS classes via guardWorkspaceRequest (this path
 * isn't on the student allowlist).
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("classId");
  const assignmentId = searchParams.get("assignmentId");
  if (!classId || !assignmentId) {
    return NextResponse.json({ error: "classId and assignmentId are required." }, { status: 400 });
  }

  try {
    const interests = await getTaskInterests(classId, assignmentId);
    return NextResponse.json({ interests }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Student interests could not be analyzed right now. Please try again." },
      { status: 502 },
    );
  }
}
