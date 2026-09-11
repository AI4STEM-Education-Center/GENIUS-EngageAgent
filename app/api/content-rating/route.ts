import { NextResponse } from "next/server";
import { upsertContentRating, listContentRatings } from "@/lib/nosql";

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("classId");
  const assignmentId = searchParams.get("assignmentId");
  const studentId = searchParams.get("studentId");

  if (!classId || !assignmentId) {
    return NextResponse.json(
      { error: "classId and assignmentId are required." },
      { status: 400 },
    );
  }

  const ratings = await listContentRatings(
    classId,
    assignmentId,
    studentId ?? undefined,
  );
  return NextResponse.json({ ratings });
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const body = await request.json();
  const { classId, assignmentId, studentId, contentItemId, rating } = body;

  if (!classId || !assignmentId || !studentId || !contentItemId || rating == null) {
    return NextResponse.json(
      { error: "classId, assignmentId, studentId, contentItemId, and rating are required." },
      { status: 400 },
    );
  }

  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: "rating must be a number between 1 and 5." },
      { status: 400 },
    );
  }

  const record = await upsertContentRating({
    class_id: classId,
    assignment_id: assignmentId,
    student_id: studentId,
    content_item_id: contentItemId,
    rating,
    rated_at: new Date().toISOString(),
  });

  return NextResponse.json({ rating: record }, { status: 201 });
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
