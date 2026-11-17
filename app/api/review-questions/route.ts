import { NextResponse } from "next/server";
import { upsertReviewQuestions, listReviewQuestions, listPublishedContent } from "@/lib/nosql";

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

  let questionMaterials: ({ contentItemId: string; publishedAt: string } | null)[] | undefined;
  if (body.questionMaterials !== undefined) {
    if (!Array.isArray(body.questionMaterials) || body.questionMaterials.length !== questions.length || questions.length > 50) return NextResponse.json({ error: "Choose a material for each question." }, { status: 400 });
    const published = (await listPublishedContent(classId, assignmentId)).filter(item => item.published && [classId, `CLASS#${classId}`].includes(item.class_id) && item.assignment_id === assignmentId);
    questionMaterials = [];
    for (const [index, question] of questions.entries()) {
      if (typeof question !== "string" || !question.trim()) continue;
      const binding = body.questionMaterials[index];
      if (binding == null) { questionMaterials.push(null); continue; }
      const target = published.find(item => item.content_item_id === binding.contentItemId && item.published_at === binding.publishedAt);
      if (!target) return NextResponse.json({ error: "A selected material has changed. Refresh it before submitting; your questions are retained." }, { status: 409 });
      questionMaterials.push({ contentItemId: target.content_item_id, publishedAt: target.published_at });
    }
  }
  const record = await upsertReviewQuestions({
    class_id: classId,
    assignment_id: assignmentId,
    student_id: studentId,
    questions: cleanedQuestions,
    ...(questionMaterials ? { questionMaterials } : {}),
    submitted_at: new Date().toISOString(),
  });

  return NextResponse.json({ reviewQuestions: record }, { status: 201 });
}

import { guardWorkspaceRequest } from "@/lib/workspace-access";
