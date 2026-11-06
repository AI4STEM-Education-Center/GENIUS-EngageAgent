import { getLessonVersion, getTaskLesson } from "@/lib/lessons-store";
import { lessonFailure, lessonJson, positiveInteger } from "@/lib/lessons-api";
import { getPublishedTaskQuiz } from "@/lib/task-quiz-published";
import { guardWorkspaceRequest, workspaceRequestUser } from "@/lib/workspace-access";

type Context = { params: Promise<{ lessonNumber: string }> };

// A published lesson in the shape the app has always read, plus its version.
// Add ?classId=..&assignmentId=.. for the version that task reads, or ?version=2
// for one particular version. Drafts are never served here.
// A task's published quiz (#177) has its own answer keys, so that read is only
// for the task's teachers. Students get the quiz from /api/task-quiz/student.
export async function GET(request: Request, { params }: Context) {
  const { lessonNumber: raw } = await params;
  const lessonNumber = positiveInteger(raw);
  if (lessonNumber === null) return lessonJson({ error: "lessonNumber must be a positive whole number." }, 400);
  const query = new URL(request.url).searchParams;
  const classId = query.get("classId"), assignmentId = query.get("assignmentId");
  if (!classId !== !assignmentId || (classId?.length ?? 0) > 160 || (assignmentId?.length ?? 0) > 160) {
    return lessonJson({ error: "classId and assignmentId go together." }, 400);
  }
  const rawVersion = query.get("version");
  const version = rawVersion === null ? undefined : positiveInteger(rawVersion);
  if (version === null) return lessonJson({ error: "version must be a positive whole number." }, 400);
  try {
    if (version === undefined && classId && assignmentId && (await getPublishedTaskQuiz(classId, assignmentId))?.lesson?.number === lessonNumber) {
      const denied = await guardWorkspaceRequest(request);
      if (denied) return denied;
      if ((await workspaceRequestUser(request))?.role !== "teacher") return lessonJson({ error: "Teacher access required." }, 403);
    }
    const found = version === undefined && classId && assignmentId
      ? await getTaskLesson(classId, assignmentId, lessonNumber)
      : await getLessonVersion(lessonNumber, version);
    if (!found) return lessonJson({ error: `Lesson ${lessonNumber} not found.` }, 404);
    return lessonJson({ ...found.lesson, lesson_version: found.version });
  } catch (error) { return lessonFailure(error); }
}
