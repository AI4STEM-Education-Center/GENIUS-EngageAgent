import { NextRequest, NextResponse } from "next/server";
import { listAllMedia } from "@/lib/nosql";
import { sessionUser } from "@/lib/session";
import { isWorkspaceClass, listWorkspaceClasses } from "@/lib/workspace";

export const maxDuration = 60;

function formatStorageError(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to load gallery.";

  if (message.includes("Requested resource not found")) {
    return "Database resource not found. Check DYNAMODB_TABLE and ENGAGE_AWS_REGION.";
  }

  return message;
}

/**
 * GET /api/gallery
 *
 * List all generated images (or videos) for the community gallery.
 *
 * Query parameters:
 *   - type     — "image" (default) or "video"
 *   - search   — free-text filter against content/student/class IDs
 *   - limit    — page size (default 12, max 60)
 *   - cursor   — opaque pagination cursor from a previous response
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mediaType =
    params.get("type") === "video" ? "video" : "image";
  const search = params.get("search")?.trim() || undefined;
  const limit = Math.min(60, Math.max(1, Number(params.get("limit")) || 12));
  const cursor = params.get("cursor") || undefined;

  try {
    const page = await listAllMedia({ mediaType, search, limit, cursor });
    const user = await sessionUser();
    const accessible = new Set(user?.role === "teacher" ? (await listWorkspaceClasses(user)).map(c => c.id) : []);
    return NextResponse.json({ ...page, items: page.items.filter(item => {
      const classId = item.class_id.replace(/^CLASS#/, "");
      return !isWorkspaceClass(classId) || accessible.has(classId);
    }) });
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "Failed to load gallery.";
    const message = formatStorageError(error);
    console.error("gallery route error:", {
      message: rawMessage,
      table: process.env.DYNAMODB_TABLE ?? "(missing)",
      region: process.env.ENGAGE_AWS_REGION ?? "us-east-2",
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
