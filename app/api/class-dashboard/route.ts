import { NextResponse } from "next/server";
import { guardWorkspaceClassRequest } from "@/lib/workspace-access";
import { sessionUser } from "@/lib/session";
import { addQuestionToBoard, BoardError, getClassDashboard } from "@/lib/class-dashboard";
import { WorkspaceError } from "@/lib/workspace";

/**
 * The class dashboard (#207). The class's own teacher, signed in to EngageAgent.
 * GET ?classId → { tasks, misconceptions, questions }
 * POST { classId, questionId, fromAssignmentId, toAssignmentId } → { board, added }
 */
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function failure(error: unknown) {
  if (error instanceof WorkspaceError) return json({ error: error.message }, error.status);
  if (error instanceof BoardError) return json({ error: error.message }, 400);
  console.error("Class dashboard request failed", { type: error instanceof Error ? error.name : "Unknown" });
  return json({ error: "The dashboard isn't available right now." }, 503);
}

export async function GET(request: Request) {
  const denied = await guardWorkspaceClassRequest(request);
  if (denied) return denied;
  try {
    const user = (await sessionUser())!;
    return json(await getClassDashboard(user, new URL(request.url).searchParams.get("classId")!.trim()));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceClassRequest(request);
  if (denied) return denied;
  try {
    const user = (await sessionUser())!;
    const body = (await request.json()) as { classId: string; questionId?: unknown; fromAssignmentId?: unknown; toAssignmentId?: unknown };
    return json(await addQuestionToBoard(user, body.classId.trim(), body));
  } catch (error) { return failure(error); }
}
