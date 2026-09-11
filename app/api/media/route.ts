import { NextRequest, NextResponse } from "next/server";
import { getMedia, listMedia, setActiveMediaVersion } from "@/lib/nosql";

/**
 * GET /api/media
 *
 * Retrieve stored media (images & videos) from the database.
 *
 * Query parameters:
 *   - classId (required)
 *   - assignmentId (required)
 *   - studentId (required)
 *   - contentItemId (optional) — filter to a specific content item
 *   - mediaType (optional) — "image" or "video"
 *
 * If contentItemId + mediaType are both provided, returns a single record.
 * Otherwise returns a list of matching media records.
 */
export async function GET(request: NextRequest) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const classId = params.get("classId");
  const assignmentId = params.get("assignmentId");
  const studentId = params.get("studentId");
  const contentItemId = params.get("contentItemId");
  const mediaType = params.get("mediaType") as
    | "image"
    | "video"
    | null;

  if (!classId || !assignmentId || !studentId) {
    return NextResponse.json(
      { error: "classId, assignmentId, and studentId are required." },
      { status: 400 },
    );
  }

  try {
    // Single record lookup
    if (contentItemId && mediaType) {
      const record = await getMedia(
        classId,
        assignmentId,
        studentId,
        contentItemId,
        mediaType,
      );
      if (!record) {
        return NextResponse.json({ found: false }, { status: 404 });
      }
      return NextResponse.json({ found: true, media: record });
    }

    // List media
    const records = await listMedia(
      classId,
      assignmentId,
      studentId,
      contentItemId ?? undefined,
      mediaType ?? undefined,
    );
    return NextResponse.json({ results: records });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to retrieve media.";
    console.error("media route error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/media
 *
 * Switch the active version for a media record.
 * Used when the teacher navigates image history.
 */
export async function PUT(request: NextRequest) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const { classId, assignmentId, studentId, contentItemId, mediaType, versionIndex } =
      (await request.json()) as {
        classId?: string;
        assignmentId?: string;
        studentId?: string;
        contentItemId?: string;
        mediaType?: "image" | "video";
        versionIndex?: number;
      };

    if (!classId || !assignmentId || !studentId || !contentItemId || !mediaType || versionIndex === undefined) {
      return NextResponse.json(
        { error: "classId, assignmentId, studentId, contentItemId, mediaType, and versionIndex are required." },
        { status: 400 },
      );
    }

    const updated = await setActiveMediaVersion(classId, assignmentId, studentId, contentItemId, mediaType, versionIndex);
    if (!updated) {
      return NextResponse.json({ error: "Media record not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update active version.";
    console.error("media PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
