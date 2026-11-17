import { authorizeMaterialLibrary, slideJson, slideFailure } from "@/lib/slides/server";
import { readClassroomContext } from "@/lib/classroom-context-server";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const scope = await authorizeMaterialLibrary(request, Object.fromEntries(new URL(request.url).searchParams));
    if (!scope.classId || !scope.assignmentId) return slideJson({ error: "Choose a class and task to use class information." }, 400);
    return slideJson({ context: await readClassroomContext(scope) });
  } catch (error) { return slideFailure(error); }
}
