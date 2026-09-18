import { NextResponse } from "next/server";
import { upsertReviewQuestions, listReviewQuestions } from "@/lib/nosql";

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

  const reviewQuestions = await listReviewQuestions(
    classId,
    assignmentId,
    studentId ?? undefined,
  );
  return NextResponse.json({ reviewQuestions });
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const body = await request.json();
  const { classId, assignmentId, studentId, questions } = body;

  if (!classId || !assignmentId || !studentId || !Array.isArray(questions)) {
    return NextResponse.json(
      { error: "classId, assignmentId, studentId, and questions array are required." },
      { status: 400 },
    );
  }

  const cleanedQuestions = questions
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter((q) => q.length > 0);

  if (cleanedQuestions.length === 0) {
    return NextResponse.json(
      { error: "At least one non-empty question is required." },
      { status: 400 },
    );
  }

  const record = await upsertReviewQuestions({
    class_id: classId,
    assignment_id: assignmentId,
    student_id: studentId,
    questions: cleanedQuestions,
    submitted_at: new Date().toISOString(),
  });

  return NextResponse.json({ reviewQuestions: record }, { status: 201 });
}

import { guardWorkspaceRequest } from "@/lib/workspace-access";
