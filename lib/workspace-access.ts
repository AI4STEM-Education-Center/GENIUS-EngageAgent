import { NextResponse } from "next/server";
import { sessionUser, sameOriginRequest } from "./session";
import { isWorkspaceClass, workspaceContext, WorkspaceError } from "./workspace";
import { getQuizStatus } from "./nosql";
import { computeActivityStatuses } from "./activity-status";

const deny = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function guardWorkspaceRequest(request: Request, context?: { classId: string; assignmentId: string }) {
  const url = new URL(request.url);
  const write = !["GET", "HEAD"].includes(request.method);
  let fields: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (write) {
    try { fields = await request.clone().json(); }
    catch { return deny("Invalid request body.", 400); }
    if (!fields || typeof fields !== "object") return deny("Invalid request body.", 400);
  }
  const rawClassId = context?.classId || fields.classId;
  const classId = typeof rawClassId === "string" ? rawClassId.trim() : rawClassId;
  if (!isWorkspaceClass(classId)) return null;
  const rawAssignmentId = context?.assignmentId || fields.assignmentId;
  const assignmentId = typeof rawAssignmentId === "string" ? rawAssignmentId.trim() : rawAssignmentId;
  if (typeof assignmentId !== "string") return deny("Assignment is required.", 400);
  const user = await sessionUser();
  if (!user) return deny("Sign-in required.", 401);
  if (write && !sameOriginRequest(request)) return deny("Invalid request origin.", 403);
  try {
    await workspaceContext(user, classId, assignmentId);
    if (url.pathname === "/api/auto-answer-test-students") return deny("Test answers are not available in live workspace classes.", 403);
    if (user.role === "teacher") {
      if (write && ["/api/student-answers", "/api/content-rating", "/api/review-questions"].includes(url.pathname)) return deny("Student account required.", 403);
      if (fields.publishedBy && fields.publishedBy !== user.geniusId) return deny("Invalid GENIUS ID.", 403);
      return null;
    }
    const ownRecords = ["/api/student-answers", "/api/content-rating", "/api/review-questions", "/api/activity-status"].includes(url.pathname);
    if (ownRecords && fields.studentId !== user.geniusId) return deny("You can only access your own responses.", 403);
    if (!ownRecords && (write || !["/api/quiz-status", "/api/content-publish"].includes(url.pathname))) return deny("Teacher access required.", 403);
    if (write && url.pathname === "/api/student-answers") {
      const quiz = await getQuizStatus(classId, assignmentId);
      if (quiz?.status !== "published" || fields.lessonNumber !== quiz.lesson_number) return deny("This quiz is not open for responses.", 409);
      if (fields.studentName !== user.name) return deny("Invalid student identity.", 403);
    }
    if (write && (url.pathname === "/api/review-questions" || url.pathname === "/api/content-rating")) {
      const activityId = url.pathname === "/api/review-questions" ? "content-review" : "content-rating";
      const statuses = await computeActivityStatuses(classId, assignmentId, user.geniusId);
      // Allow "available" (in progress) and "completed" (revising an already-submitted
      // response, e.g. changing a rating) — only block while still "locked".
      if (statuses[activityId] === "locked") return deny("This activity is not open yet.", 409);
    }
    return null;
  } catch (error) {
    if (error instanceof WorkspaceError) return deny(error.message, error.status);
    return deny("Unable to verify class access.", 503);
  }
}
