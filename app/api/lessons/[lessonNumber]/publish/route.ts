import { previewLessonPublish, publishLessonDraft } from "@/lib/lessons-store";
import { expectedRevision, lessonBody, lessonFailure, lessonJson, positiveInteger } from "@/lib/lessons-api";
import { sessionUser } from "@/lib/session";
import { guardTeacherSessionRequest } from "@/lib/workspace-access";
import { NextResponse } from "next/server";

type Context = { params: Promise<{ lessonNumber: string }> };

/** What "Publish version" shows first: any problems, what changed, and a suggested note. */
export async function GET(request: Request, { params }: Context) {
  const denied = await guardTeacherSessionRequest(request);
  if (denied) return denied;
  const lessonNumber = positiveInteger((await params).lessonNumber);
  if (lessonNumber === null) return lessonJson({ error: "lessonNumber must be a positive whole number." }, 400);
  try {
    return lessonJson(await previewLessonPublish(lessonNumber));
  } catch (error) { return lessonFailure(error); }
}

export async function POST(request: Request, { params }: Context) {
  const denied = await guardTeacherSessionRequest(request);
  if (denied) return denied;
  const lessonNumber = positiveInteger((await params).lessonNumber);
  if (lessonNumber === null) return lessonJson({ error: "lessonNumber must be a positive whole number." }, 400);
  const body = await lessonBody(request);
  if (body instanceof NextResponse) return body;
  try {
    const user = await sessionUser();
    if (!user) return lessonJson({ error: "Sign-in required." }, 401);
    const { lesson, ...version } = await publishLessonDraft(user, lessonNumber, body.changeNote, expectedRevision(body));
    return lessonJson({ version: { ...version, title: lesson.lesson_title } }, 201);
  } catch (error) { return lessonFailure(error); }
}
