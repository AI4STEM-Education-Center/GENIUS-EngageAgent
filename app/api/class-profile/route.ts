import { NextResponse } from "next/server";
import { getClassProfile, upsertClassProfile } from "@/lib/nosql";
import { EMPTY_CLASS_PROFILE, parseClassProfileAnswers, type ClassProfile } from "@/lib/class-profile";
import { guardWorkspaceRequest, workspaceRequestUser } from "@/lib/workspace-access";

// Teacher-only: guardWorkspaceRequest denies students and guests on any
// route outside its student allow-list, which this route is not on.
// assignmentId is only used to authorize the request; the profile is per class.

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
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const classId = new URL(request.url).searchParams.get("classId")?.trim();
  if (!classId) {
    return NextResponse.json({ error: "classId is required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ classProfile: await getClassProfile(classId) });
  } catch (error) {
    return storageError("GET", error);
  }
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const classId = typeof body.classId === "string" ? body.classId.trim() : "";
    if (!classId) {
      return NextResponse.json({ error: "classId is required." }, { status: 400 });
    }

    const user = await workspaceRequestUser(request);
    const updatedAt = new Date().toISOString();

    // "Skip for now" only records that the teacher was asked; it never
    // replaces answers that were already saved.
    if (body.skip === true) {
      const existing = await getClassProfile(classId);
      if (existing) return NextResponse.json({ classProfile: existing });
      const record: ClassProfile = {
        ...EMPTY_CLASS_PROFILE,
        class_id: classId,
        status: "skipped",
        updated_by: user?.geniusId,
        updated_at: updatedAt,
      };
      return NextResponse.json({ classProfile: await upsertClassProfile(record) });
    }

    const parsed = parseClassProfileAnswers(body.profile);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const record: ClassProfile = {
      ...parsed.answers,
      class_id: classId,
      status: "saved",
      updated_by: user?.geniusId,
      updated_at: updatedAt,
    };
    return NextResponse.json({ classProfile: await upsertClassProfile(record) });
  } catch (error) {
    return storageError("POST", error);
  }
}
