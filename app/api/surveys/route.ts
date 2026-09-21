import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { upsertSurvey, getSurvey, listSurveys } from "@/lib/nosql";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import type { Survey, SurveyQuestion, SurveyStatus } from "@/lib/types";

const VALID_STATUSES: SurveyStatus[] = ["draft", "active"];

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("classId");
  const assignmentId = searchParams.get("assignmentId");
  const surveyId = searchParams.get("surveyId");

  if (!classId || !assignmentId) {
    return NextResponse.json(
      { error: "classId and assignmentId are required." },
      { status: 400 },
    );
  }

  if (surveyId) {
    const survey = await getSurvey(classId, assignmentId, surveyId);
    if (!survey) {
      return NextResponse.json({ error: "Survey not found." }, { status: 404 });
    }
    return NextResponse.json({ survey });
  }

  const surveys = await listSurveys(classId, assignmentId);
  return NextResponse.json({ surveys });
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const body = await request.json();
  const {
    classId,
    assignmentId,
    surveyId,
    title,
    description,
    studentInstructions,
    lessonNumber,
    status,
    questions,
  } = body ?? {};

  if (!classId || !assignmentId || typeof title !== "string" || !title.trim()) {
    return NextResponse.json(
      { error: "classId, assignmentId, and a non-empty title are required." },
      { status: 400 },
    );
  }

  const resolvedStatus: SurveyStatus =
    status == null ? "draft" : status;
  if (!VALID_STATUSES.includes(resolvedStatus)) {
    return NextResponse.json(
      { error: 'status must be "draft" or "active".' },
      { status: 400 },
    );
  }

  if (questions != null && !Array.isArray(questions)) {
    return NextResponse.json(
      { error: "questions must be an array when provided." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  // Update existing survey (preserve its created_at) or create a new one.
  const existing = surveyId
    ? await getSurvey(classId, assignmentId, surveyId)
    : null;

  const survey: Survey = {
    survey_id: existing?.survey_id ?? surveyId ?? crypto.randomUUID(),
    class_id: classId,
    assignment_id: assignmentId,
    title: title.trim(),
    description: typeof description === "string" ? description : undefined,
    student_instructions:
      typeof studentInstructions === "string" ? studentInstructions : undefined,
    lesson_number: typeof lessonNumber === "number" ? lessonNumber : undefined,
    status: resolvedStatus,
    questions: (questions as SurveyQuestion[] | undefined) ?? existing?.questions ?? [],
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  const saved = await upsertSurvey(survey);
  return NextResponse.json({ survey: saved }, { status: existing ? 200 : 201 });
}
