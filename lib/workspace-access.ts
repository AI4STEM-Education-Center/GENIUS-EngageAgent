import { NextResponse } from "next/server";
import { sessionUser, sameOriginRequest } from "./session";
import { isWorkspaceClass, workspaceContext, WorkspaceError } from "./workspace";
import { getQuizStatus } from "./nosql";
import { computeActivityStatuses } from "./activity-status";
import { verifySSOToken } from "./auth";
import { authorizeSlideAccess, SlideRequestError } from "./slides/server";

const deny = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

// Use after guardWorkspaceRequest has verified the request's class/task scope.
export async function workspaceRequestUser(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const token = /^Bearer ([^\s]+)$/iu.exec(authorization)?.[1];
    return token ? verifySSOToken(token) : null;
  }
  return sessionUser();
}

export async function guardWorkspaceRequest(request: Request, context?: { classId: string; assignmentId: string }) {
  const url = new URL(request.url);
  // URLSearchParams.get() reads the first value; Object.fromEntries() keeps
  // the last. Reject ambiguity before authorizing or any handler reads scope.
  const queryKeys = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (queryKeys.has(key)) return deny("Repeated query parameters are not allowed.", 400);
    queryKeys.add(key);
  }
  const write = !["GET", "HEAD"].includes(request.method);
  let fields: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (write) {
    try { fields = await request.clone().json(); }
    catch { return deny("Invalid request body.", 400); }
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return deny("Invalid request body.", 400);
  }
  const rawClassId = context?.classId || fields.classId;
  const classId = typeof rawClassId === "string" ? rawClassId.trim() : rawClassId;
  const rawAssignmentId = context?.assignmentId || fields.assignmentId;
  const assignmentId = typeof rawAssignmentId === "string" ? rawAssignmentId.trim() : rawAssignmentId;
  if (typeof classId !== "string" || !classId || classId.length > 160
    || typeof assignmentId !== "string" || !assignmentId || assignmentId.length > 160) return deny("Class and assignment are required.", 400);
  try {
    let user;
    if (request.headers.has("authorization") || !isWorkspaceClass(classId)) {
      // GENIUS IDs are not native workspace IDs, but still require a signed,
      // audience-bound launch scoped to this exact class and assignment.
      // An explicit invalid token must never fall back to a native cookie.
      await authorizeSlideAccess(request, { classId, assignmentId }, "read");
      const token = /^Bearer ([^\s]+)$/iu.exec(request.headers.get("authorization") || "")?.[1];
      if (!token) return deny("Open this activity from GENIUS to sign in.", 401);
      user = await verifySSOToken(token);
    } else {
      user = await sessionUser();
      if (!user) return deny("Sign-in required.", 401);
      await workspaceContext(user, classId, assignmentId);
    }
    if (write && !sameOriginRequest(request)) return deny("Invalid request origin.", 403);
    if (url.pathname === "/api/auto-answer-test-students") return deny("Test answers are not available in live workspace classes.", 403);
    if (user.role === "teacher") {
      if (write && ["/api/student-answers", "/api/content-rating", "/api/review-questions", "/api/survey-responses"].includes(url.pathname)) return deny("Student account required.", 403);
      if (fields.publishedBy && fields.publishedBy !== user.geniusId) return deny("Invalid GENIUS ID.", 403);
      return null;
    }
    // GENIUS signs guest membership only when the class explicitly permits it.
    // Native guests still require the native workspace membership policy above.
    const embeddedGuest = user.role === "guest" && request.headers.has("authorization") && !isWorkspaceClass(classId);
    if (user.role !== "student" && !embeddedGuest) return deny("Student or teacher account required.", 403);
    const ownRecords = ["/api/student-answers", "/api/content-rating", "/api/review-questions", "/api/activity-status", "/api/survey-responses"].includes(url.pathname);
    if (ownRecords && fields.studentId !== user.geniusId) return deny("You can only access your own responses.", 403);
    if (!ownRecords && (write || !["/api/quiz-status", "/api/content-publish", "/api/surveys"].includes(url.pathname))) return deny("Teacher access required.", 403);
    if (write && url.pathname === "/api/survey-responses" && fields.studentName !== undefined && fields.studentName !== user.name) return deny("Invalid student identity.", 403);
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
    if (error instanceof WorkspaceError || error instanceof SlideRequestError) return deny(error.message, error.status);
    return deny("Unable to verify class access.", 503);
  }
}
