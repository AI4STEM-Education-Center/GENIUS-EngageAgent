import { NextResponse } from "next/server";
import { getClassProfile, upsertClassProfile } from "@/lib/nosql";
import { parseClassProfileAnswers, savedClassProfile } from "@/lib/class-profile";
import { guardWorkspaceClassRequest, guardWorkspaceRequest, workspaceRequestUser } from "@/lib/workspace-access";
import { linkedGeniusClass, liveGeniusContextEnabled } from "@/lib/genius-context-client";
import { readClassroomContext } from "@/lib/classroom-context-server";

// Teacher-only. The profile is first answered when the class is added (see
// /api/workspace), then seen or edited on the class page (no task) or inside a task:
// - with an assignmentId, guardWorkspaceRequest checks the task (EngageAgent or
//   GENIUS) and denies students and guests, as this route is not on its allow-list;
// - without one, guardWorkspaceClassRequest only lets the class's own teacher in.
async function guard(request: Request) {
  let scope: unknown = Object.fromEntries(new URL(request.url).searchParams);
  if (!["GET", "HEAD"].includes(request.method)) scope = await request.clone().json().catch(() => null);
  const hasTask = Boolean(scope && typeof scope === "object" && "assignmentId" in scope);
  return hasTask ? guardWorkspaceRequest(request) : guardWorkspaceClassRequest(request);
}

function storageError(action: "GET" | "POST", error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to access class profile.";
  console.error(`class-profile ${action} error:`, { message });
  return NextResponse.json(
    {
      error: message.includes("Requested resource not found")
        ? "Database resource not found. Check DYNAMODB_TABLE and ENGAGE_AWS_REGION."
        : message,
    },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  const classId = new URL(request.url).searchParams.get("classId")?.trim();
  if (!classId) {
    return NextResponse.json({ error: "classId is required." }, { status: 400 });
  }

  try {
    if (liveGeniusContextEnabled()) {
      const user = await workspaceRequestUser(request);
      const scope = { userId: user?.geniusId || "", classId, assignmentId: new URL(request.url).searchParams.get("assignmentId") || "" };
      if (user && await linkedGeniusClass(scope)) {
        const context = await readClassroomContext(scope);
        return NextResponse.json({ classProfile: context.profile.value || null, source: context.profile, manageUrl: context.geniusManageUrl }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    return NextResponse.json({ classProfile: await getClassProfile(classId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return storageError("GET", error);
  }
}

export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const classId = typeof body.classId === "string" ? body.classId.trim() : "";
    if (!classId) {
      return NextResponse.json({ error: "classId is required." }, { status: 400 });
    }

    const user = await workspaceRequestUser(request);
    if (user && liveGeniusContextEnabled() && await linkedGeniusClass({ userId: user.geniusId, classId, assignmentId: typeof body.assignmentId === "string" ? body.assignmentId : "" })) {
      return NextResponse.json({ error: "This class uses its GENIUS profile. Edit class information in GENIUS, then accept the updated information in your task." }, { status: 409 });
    }
    const parsed = parseClassProfileAnswers(body.profile);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    return NextResponse.json({ classProfile: await upsertClassProfile(savedClassProfile(parsed.answers, classId, user?.geniusId)) });
  } catch (error) {
    return storageError("POST", error);
  }
}
