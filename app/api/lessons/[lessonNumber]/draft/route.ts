import { parseLessonDraft } from "@/lib/lessons";
import { discardLessonDraft, getLessonDraft, saveLessonDraft, startLessonEdit } from "@/lib/lessons-store";
import { expectedRevision, lessonBody, lessonFailure, lessonJson, positiveInteger } from "@/lib/lessons-api";
import { sessionUser } from "@/lib/session";
import { guardTeacherSessionRequest } from "@/lib/workspace-access";
import { NextResponse } from "next/server";

type Context = { params: Promise<{ lessonNumber: string }> };

async function scope(request: Request, { params }: Context) {
  const denied = await guardTeacherSessionRequest(request);
  if (denied) return denied;
  const lessonNumber = positiveInteger((await params).lessonNumber);
  if (lessonNumber === null) return lessonJson({ error: "lessonNumber must be a positive whole number." }, 400);
  const user = await sessionUser();
  if (!user) return lessonJson({ error: "Sign-in required." }, 401);
  return { user, lessonNumber };
}

export async function GET(request: Request, context: Context) {
  const found = await scope(request, context);
  if (found instanceof NextResponse) return found;
  try {
    const draft = await getLessonDraft(found.lessonNumber);
    return draft ? lessonJson({ draft }) : lessonJson({ error: "This lesson has no draft." }, 404);
  } catch (error) { return lessonFailure(error); }
}

/** "Edit": opens the draft, starting one from the current version if there isn't one. */
export async function POST(request: Request, context: Context) {
  const found = await scope(request, context);
  if (found instanceof NextResponse) return found;
  try {
    return lessonJson({ draft: await startLessonEdit(found.user, found.lessonNumber) });
  } catch (error) { return lessonFailure(error); }
}

/** "Save draft". */
export async function PUT(request: Request, context: Context) {
  const found = await scope(request, context);
  if (found instanceof NextResponse) return found;
  const body = await lessonBody(request);
  if (body instanceof NextResponse) return body;
  const parsed = parseLessonDraft(body.content);
  if ("error" in parsed) return lessonJson({ error: parsed.error }, 400);
  try {
    return lessonJson({ draft: await saveLessonDraft(found.user, found.lessonNumber, parsed.draft, expectedRevision(body)) });
  } catch (error) { return lessonFailure(error); }
}

/** "Discard draft". */
export async function DELETE(request: Request, context: Context) {
  const found = await scope(request, context);
  if (found instanceof NextResponse) return found;
  try {
    return lessonJson(await discardLessonDraft(found.user, found.lessonNumber));
  } catch (error) { return lessonFailure(error); }
}
