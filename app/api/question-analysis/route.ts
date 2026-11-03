import { NextResponse } from "next/server";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { getTaskQuestions } from "@/lib/class-questions-server";

/**
 * The students' questions for a task, sorted into discussion themes (#182).
 * GET ?classId&assignmentId → TaskQuestions. Teachers only: the guard keeps
 * this path off the student allowlist, since it shows who asked what.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  try {
    const questions = await getTaskQuestions(params.get("classId")!, params.get("assignmentId")!);
    return NextResponse.json(questions, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Student questions couldn't be loaded right now." }, { status: 502 });
  }
}
