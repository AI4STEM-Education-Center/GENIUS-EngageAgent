import { NextResponse } from "next/server";
import { sessionUser, sameOriginRequest } from "@/lib/session";
import { createWorkspaceAssignment, createWorkspaceClass, joinWorkspaceClass, listWorkspaceClasses, workspaceClassDetail, workspaceContext, WorkspaceError } from "@/lib/workspace";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof WorkspaceError) return json({ error: error.message }, error.status);
  console.error("Workspace storage request failed", { type: error instanceof Error ? error.name : "Unknown" });
  return json({ error: "Workspace storage is unavailable. Please try again." }, 503);
}

export async function GET(request: Request) {
  const user = await sessionUser();
  if (!user) return json({ error: "Sign-in required." }, 401);
  const params = new URL(request.url).searchParams;
  const classId = params.get("classId"), assignmentId = params.get("assignmentId");
  try {
    if (classId && assignmentId) return json({ user: await workspaceContext(user, classId, assignmentId) });
    if (classId) return json(await workspaceClassDetail(user, classId));
    return json({ classes: await listWorkspaceClasses(user) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: "Invalid request origin." }, 403);
  const user = await sessionUser();
  if (!user) return json({ error: "Sign-in required." }, 401);
  try {
    const body = await request.json();
    if (body.action === "createClass") return json({ classroom: await createWorkspaceClass(user, body.name) }, 201);
    if (body.action === "joinClass") return json({ classroom: await joinWorkspaceClass(user, body.code) });
    if (body.action === "createTask" && typeof body.classId === "string") return json({ assignment: await createWorkspaceAssignment(user, body.classId, body.title) }, 201);
    return json({ error: "Invalid workspace action." }, 400);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid request body." }, 400);
    return failure(error);
  }
}
