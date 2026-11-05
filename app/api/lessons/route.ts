import { createLesson, listLessons, listPublishedLessons } from "@/lib/lessons-store";
import { lessonFailure, lessonJson } from "@/lib/lessons-api";
import { sessionUser } from "@/lib/session";
import { guardTeacherSessionRequest, guardWorkspaceRequest } from "@/lib/workspace-access";

// The Lessons list (teachers signed in to EngageAgent), or, with a class and
// task, the lessons that task can choose from, which also works inside GENIUS.
export async function GET(request: Request) {
  const forTask = new URL(request.url).searchParams.has("assignmentId");
  const denied = forTask ? await guardWorkspaceRequest(request) : await guardTeacherSessionRequest(request);
  if (denied) return denied;
  try {
    return lessonJson({ lessons: forTask ? await listPublishedLessons() : await listLessons() });
  } catch (error) { return lessonFailure(error); }
}

export async function POST(request: Request) {
  const denied = await guardTeacherSessionRequest(request);
  if (denied) return denied;
  try {
    const user = await sessionUser();
    if (!user) return lessonJson({ error: "Sign-in required." }, 401);
    return lessonJson(await createLesson(user), 201);
  } catch (error) { return lessonFailure(error); }
}
