import { getLessonVersion } from "@/lib/lessons-store";
import { lessonFailure, lessonJson, positiveInteger } from "@/lib/lessons-api";

type Context = { params: Promise<{ lessonNumber: string }> };

// A published lesson in the shape the app has always read, plus its version.
// Add ?version=2 for a task that is pinned to an older one. Drafts are never served here.
export async function GET(request: Request, { params }: Context) {
  const { lessonNumber: raw } = await params;
  const lessonNumber = positiveInteger(raw);
  if (lessonNumber === null) return lessonJson({ error: "lessonNumber must be a positive whole number." }, 400);
  const rawVersion = new URL(request.url).searchParams.get("version");
  const version = rawVersion === null ? undefined : positiveInteger(rawVersion);
  if (version === null) return lessonJson({ error: "version must be a positive whole number." }, 400);
  try {
    const found = await getLessonVersion(lessonNumber, version);
    if (!found) return lessonJson({ error: `Lesson ${lessonNumber} not found.` }, 404);
    return lessonJson({ ...found.lesson, lesson_version: found.version });
  } catch (error) { return lessonFailure(error); }
}
