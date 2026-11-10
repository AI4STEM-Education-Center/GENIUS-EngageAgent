import { NextResponse } from "next/server";
import type { UserContext } from "@/lib/auth";
import { parseClassProfileAnswers, savedClassProfile } from "@/lib/class-profile";
import { upsertClassProfile } from "@/lib/nosql";
import { sessionUser, sameOriginRequest } from "@/lib/session";
import { createActivityTask, ensureTaskActivity } from "@/lib/task-activity";
import { createWorkspaceClass, joinWorkspaceClass, listWorkspaceClasses, workspaceClassDetail, workspaceClassSize, workspaceContext, WorkspaceError } from "@/lib/workspace";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof WorkspaceError) return json({ error: error.message }, error.status);
  console.error("Workspace storage request failed", { type: error instanceof Error ? error.name : "Unknown" });
  return json({ error: "Workspace storage is unavailable. Please try again." }, 503);
}

// The class profile is part of adding a class (#173), and it is optional.
async function createClass(user: UserContext, body: { name?: unknown; profile?: unknown }) {
  // Checked first, so answers that aren't valid don't leave a class behind.
  const parsed = body.profile === undefined ? null : parseClassProfileAnswers(body.profile);
  if (parsed && "error" in parsed) return json({ error: parsed.error }, 400);
  const classroom = await createWorkspaceClass(user, body.name);
  if (!parsed) return json({ classroom }, 201);
  try {
    await upsertClassProfile(savedClassProfile(parsed.answers, classroom.id, user.geniusId));
    return json({ classroom }, 201);
  } catch (error) {
    // The class is already made, so this can't be an error: trying again would add a second class.
    console.error("Class profile save failed after adding a class", { type: error instanceof Error ? error.name : "Unknown" });
    return json({ classroom, profileSaved: false }, 201);
  }
}

export async function GET(request: Request) {
  const user = await sessionUser();
  if (!user) return json({ error: "Sign-in required." }, 401);
  const params = new URL(request.url).searchParams;
  const classId = params.get("classId"), assignmentId = params.get("assignmentId");
  try {
    if (classId && assignmentId) {
      const context = await workspaceContext(user, classId, assignmentId);
      if (user.role !== "teacher") return json({ user: context });
      // Opening a task gives it an activity record if it predates #176.
      const [classSize, activity] = await Promise.all([workspaceClassSize(classId), ensureTaskActivity(user, classId, assignmentId)]);
      return json({ user: context, classSize, activityId: activity.agentTaskId });
    }
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
    if (body.action === "createClass") return await createClass(user, body);
    if (body.action === "joinClass") return json({ classroom: await joinWorkspaceClass(user, body.code) });
    if (body.action === "createTask" && typeof body.classId === "string") return json({ assignment: (await createActivityTask(user, body.classId, body.title)).assignment }, 201);
    return json({ error: "Invalid workspace action." }, 400);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid request body." }, 400);
    return failure(error);
  }
}
