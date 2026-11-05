import { getLessonVersionDetail } from "@/lib/lessons-store";
import { lessonFailure, lessonJson, positiveInteger } from "@/lib/lessons-api";
import { guardTeacherSessionRequest } from "@/lib/workspace-access";

/** One version read-only, with "Compare with previous". */
export async function GET(request: Request, { params }: { params: Promise<{ lessonNumber: string; version: string }> }) {
  const denied = await guardTeacherSessionRequest(request);
  if (denied) return denied;
  const raw = await params;
  const lessonNumber = positiveInteger(raw.lessonNumber), version = positiveInteger(raw.version);
  if (lessonNumber === null || version === null) return lessonJson({ error: "Lesson and version must be positive whole numbers." }, 400);
  try {
    return lessonJson(await getLessonVersionDetail(lessonNumber, version));
  } catch (error) { return lessonFailure(error); }
}
