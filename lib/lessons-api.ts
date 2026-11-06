import { NextResponse } from "next/server";
import { LessonProblemsError } from "./lessons-store";
import { WorkspaceError } from "./workspace";

export const lessonJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** A whole number from the address, or null. */
export function positiveInteger(value: string) {
  return /^[1-9]\d{0,5}$/.test(value) ? Number(value) : null;
}

export function lessonFailure(error: unknown) {
  if (error instanceof LessonProblemsError) return lessonJson({ error: error.message, problems: error.problems }, error.status);
  if (error instanceof WorkspaceError) return lessonJson({ error: error.message }, error.status);
  console.error("Lesson storage request failed", { type: error instanceof Error ? error.name : "Unknown" });
  return lessonJson({ error: "Lessons are unavailable right now. Please try again." }, 503);
}

/** Reads a JSON body, turning a huge or broken one into a clear refusal. */
export async function lessonBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
  if (Number(request.headers.get("content-length") ?? 0) > 2_000_000) return lessonJson({ error: "That lesson is too large to save." }, 413);
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return lessonJson({ error: "Invalid request body." }, 400);
    return body as Record<string, unknown>;
  } catch {
    return lessonJson({ error: "Invalid request body." }, 400);
  }
}

/** The revision the client last saw, if it sent one. */
export function expectedRevision(body: Record<string, unknown>) {
  return typeof body.revision === "number" ? body.revision : undefined;
}
