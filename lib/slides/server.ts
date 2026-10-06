import { NextResponse } from "next/server";
import { sessionUser, sameOriginRequest } from "../session";
import { isWorkspaceClass, workspaceContext, WorkspaceError } from "../workspace";
import { getLessonGenerationContext } from "../lesson-context";
import { listStudentAnswers } from "../nosql";
import { summarizeDiagnosticAnswers } from "../material-prompts";
import { isSlideStrategy, parseDraft, type SlideDraft } from "./model";
import { isAnalogyMethod, resolveAnalogyMethod, type AnalogyMethod } from "./analogy-methods";

export const slideJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export class SlideRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function authorizeSlides(request: Request, context: Record<string, unknown>) {
  const user = await sessionUser();
  if (!user) throw new SlideRequestError("Sign in to EngageAgent first.", 401);
  if (user.role !== "teacher") throw new SlideRequestError("Only teachers can create slides.", 403);
  if (request.method !== "GET" && !sameOriginRequest(request)) throw new SlideRequestError("Invalid request origin.", 403);
  const { classId, assignmentId } = context;
  if (typeof classId !== "string" || classId.length > 160 || !isWorkspaceClass(classId) || typeof assignmentId !== "string" || !assignmentId || assignmentId.length > 160) {
    throw new SlideRequestError("Open a task in your EngageAgent class first.");
  }
  await workspaceContext(user, classId, assignmentId);
  return { classId, assignmentId };
}

// Call only after workspace authorization; provider context contains counts, not identities.
export async function slideDiagnosticContext(context: { classId: string; assignmentId: string }, lessonNumber: number) {
  const answers = await listStudentAnswers(context.classId, context.assignmentId);
  return summarizeDiagnosticAnswers(lessonNumber, answers
    .filter(answer => answer.class_id === context.classId && answer.assignment_id === context.assignmentId && answer.lesson_number === lessonNumber)
    .map(answer => answer.answers));
}

export async function readSlideBody(request: Request, maxBytes = 64_000): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new SlideRequestError("Expected JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new SlideRequestError("Missing request body.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new SlideRequestError("Slide request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new SlideRequestError("Invalid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SlideRequestError("Expected a JSON object.");
  return body as Record<string, unknown>;
}

export function slideContext(body: Record<string, unknown>) {
  if (!Number.isInteger(body.lessonNumber) || !isSlideStrategy(body.strategy)) throw new SlideRequestError("Select a valid lesson and strategy.");
  const lesson = getLessonGenerationContext(Number(body.lessonNumber));
  if (!lesson) throw new SlideRequestError("Lesson not found.", 404);
  return { lesson, strategy: body.strategy };
}
export function requestClassroomContext(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 1200) throw new SlideRequestError("Classroom context must be plain text of at most 1200 characters.");
  // Keep teacher-provided context as data; prompt builders place it in user JSON.
  return value.trim();
}
export function requestAnalogyMethod(value: unknown, strategy: Parameters<typeof parseDraft>[1], draft?: SlideDraft): AnalogyMethod | undefined {
  if (strategy !== "analogy") {
    if (value !== undefined) throw new SlideRequestError("An analogy story method is only allowed for analogy.");
    return undefined;
  }
  if (value !== undefined && !isAnalogyMethod(value)) throw new SlideRequestError("Choose a supported analogy story method.");
  const method = value === undefined ? resolveAnalogyMethod(draft?.analogyMethod) : value;
  if (draft && method !== resolveAnalogyMethod(draft.analogyMethod)) throw new SlideRequestError("The requested analogy story method must match the existing draft. Generate a new story to change methods.", 422);
  return method;
}

export function requestDraft(value: unknown, strategy: Parameters<typeof parseDraft>[1], editable = false, method?: AnalogyMethod): SlideDraft {
  if (strategy === "analogy" && method !== undefined && value && typeof value === "object" && !Array.isArray(value)) {
    const draft = value as Record<string, unknown>;
    if (draft.analogyMethod !== undefined && draft.analogyMethod !== method) throw new SlideRequestError("The returned draft changed the selected analogy story method.", 502);
    // The application owns this metadata; the output schema does not let the model choose it.
    value = { ...draft, analogyMethod: method };
  }
  try { return parseDraft(value, strategy, editable); }
  catch (error) { throw new SlideRequestError(error instanceof Error ? error.message : "Invalid slide draft.", 422); }
}
export function slideFailure(error: unknown) {
  if (error instanceof SlideRequestError || error instanceof WorkspaceError) return slideJson({ error: error.message }, error.status);
  console.error("Slides request failed", { type: error instanceof Error ? error.name : "Unknown" });
  return slideJson({ error: "Slide generation is unavailable or timed out. Your current draft is unchanged. Try again shortly." }, 503);
}
