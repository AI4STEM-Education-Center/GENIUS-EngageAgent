import { NextResponse } from "next/server";
import { sessionUser } from "./session";
import { listWorkspaceClasses } from "./workspace";
import { guardWorkspaceRequest, workspaceRequestUser } from "./workspace-access";

export type CollectionScope = { classIds: string[]; assignmentId?: string };
const denied = (error: string, status: number) => ({ response: NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } }) });

/** Authorize before any collection scan. A GENIUS launch grants one signed
 * assignment; a native teacher can browse only classes they own. */
export async function authorizeWorkspaceCollection(request: Request): Promise<CollectionScope | { response: NextResponse }> {
  try {
    const params = new URL(request.url).searchParams;
    if (request.headers.has("authorization") || params.has("classId") || params.has("assignmentId")) {
      const response = await guardWorkspaceRequest(request);
      if (response) return { response };
      const user = await workspaceRequestUser(request);
      if (user?.role !== "teacher") return denied("Teacher access required.", 403);
      return { classIds: [params.get("classId")!.trim()], assignmentId: params.get("assignmentId")!.trim() };
    }
    const user = await sessionUser();
    if (!user) return denied("Sign in as a teacher to access these materials.", 401);
    if (user.role !== "teacher") return denied("Teacher access required.", 403);
    return { classIds: (await listWorkspaceClasses(user)).map(item => item.id) };
  } catch {
    return denied("Unable to verify class access.", 503);
  }
}

export function collectionContains(scope: CollectionScope, classId: string | undefined, assignmentId?: string): boolean {
  return typeof classId === "string" && scope.classIds.includes(classId.replace(/^CLASS#/u, ""))
    && (scope.assignmentId === undefined || scope.assignmentId === assignmentId);
}
