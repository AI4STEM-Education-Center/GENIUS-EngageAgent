import { NextResponse } from "next/server";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { getQuizStatus, putTaskDoc } from "@/lib/nosql";
import type { ReportRelease } from "@/lib/quiz-report";

/**
 * Releases the task's quiz feedback reports to students (#182).
 * POST { classId, assignmentId, reason: "taught" | "early" }. Teachers only:
 * this path is not on the guard's student allowlist.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { classId, assignmentId, reason } = (await request.json()) as { classId: string; assignmentId: string; reason?: unknown };
  if (reason !== "taught" && reason !== "early") return NextResponse.json({ error: "reason must be taught or early." }, { status: 400 });
  const quiz = await getQuizStatus(classId, assignmentId);
  if (!quiz?.lesson_number || quiz.status === "draft") return NextResponse.json({ error: "Publish the quiz before releasing reports." }, { status: 409 });
  const release: ReportRelease = { releasedAt: new Date().toISOString(), reason, lessonNumber: quiz.lesson_number };
  await putTaskDoc(classId, assignmentId, "report_release", release);
  return NextResponse.json({ release });
}
