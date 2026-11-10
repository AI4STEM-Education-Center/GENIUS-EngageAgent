import { NextResponse } from "next/server";
import type { UserContext } from "./auth";
import { ReplaceConfirmationError, TaskQuizRuleError } from "./task-quiz";
import type { QuizActivity } from "./task-quiz-store";
import { WorkspaceError } from "./workspace";
import { guardWorkspaceRequest, workspaceRequestUser } from "./workspace-access";

const MAX_BODY_BYTES = 64_000;

export const quizJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function quizFailure(error: unknown) {
  if (error instanceof ReplaceConfirmationError) return quizJson({ error: error.message, code: "confirm_replace", reviewedCount: error.reviewedCount }, 409);
  if (error instanceof TaskQuizRuleError) return quizJson({ error: error.message, ...(error.problems ? { problems: error.problems } : {}) }, error.status);
  if (error instanceof WorkspaceError) return quizJson({ error: error.message }, error.status);
  console.error("Task quiz request failed", { type: error instanceof Error ? error.name : "Unknown" });
  return quizJson({ error: "The quiz is unavailable right now. Please try again." }, 503);
}

/**
 * The teacher behind a request that has already passed `guardWorkspaceRequest`.
 * The guard keeps students and guests off these paths; this is a second lock in
 * case its list ever changes.
 */
export async function quizTeacher(request: Request): Promise<UserContext> {
  const user = await workspaceRequestUser(request);
  if (!user) throw new TaskQuizRuleError("Sign-in required.", 401);
  if (user.role !== "teacher") throw new TaskQuizRuleError("Teacher access required.", 403);
  return user;
}

/** The task this request is about. Trimmed the same way the guard trims it, so it's the one that was checked. */
export const quizActivity = (fields: { classId?: unknown; assignmentId?: unknown }): QuizActivity => ({
  classId: String(fields.classId ?? "").trim(), assignmentId: String(fields.assignmentId ?? "").trim(),
});
export const quizActivityFromUrl = (request: Request) => {
  const params = new URL(request.url).searchParams;
  return quizActivity({ classId: params.get("classId"), assignmentId: params.get("assignmentId") });
};

/** Reads a JSON body, turning a huge or broken one into a clear refusal. */
export async function quizBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new TaskQuizRuleError("That request is too large.", 413);
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* Refused below. */ }
  throw new TaskQuizRuleError("Invalid request body.", 400);
}

/** The revision the client last saw, if it sent one. */
export const quizRevision = (body: Record<string, unknown>) => (typeof body.revision === "number" ? body.revision : undefined);

/**
 * `guardWorkspaceRequest` reads the class and task from a JSON body, but an
 * upload's body is the file, which must not be read before access is checked.
 * So the guard gets a stand-in with the same address and headers, with the
 * class and task from the address as its body.
 */
export function guardQuizUpload(request: Request) {
  const params = new URL(request.url).searchParams;
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of ["origin", "authorization"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return guardWorkspaceRequest(new Request(request.url, {
    method: "POST", headers, body: JSON.stringify({ classId: params.get("classId"), assignmentId: params.get("assignmentId") }),
  }));
}
