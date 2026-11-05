import { listLessonVersions } from "@/lib/lessons-store";
import { lessonFailure, lessonJson, positiveInteger } from "@/lib/lessons-api";
import { guardTeacherSessionRequest } from "@/lib/workspace-access";

/** "History": the published versions, newest first. */
export async function GET(request: Request, { params }: { params: Promise<{ lessonNumber: string }> }) {
  const denied = await guardTeacherSessionRequest(request);
  if (denied) return denied;
  const lessonNumber = positiveInteger((await params).lessonNumber);
  if (lessonNumber === null) return lessonJson({ error: "lessonNumber must be a positive whole number." }, 400);
  try {
    return lessonJson({ versions: await listLessonVersions(lessonNumber) });
  } catch (error) { return lessonFailure(error); }
}
