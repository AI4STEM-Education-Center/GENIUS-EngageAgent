import { NextResponse } from "next/server";
import { getSurvey, listSurveyResponses, upsertSurveyResponse } from "@/lib/nosql";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import {
  findMissingAnswers,
  getSurveyAvailability,
  sanitizeAnswers,
} from "@/lib/survey-response";
import type { SurveyResponse } from "@/lib/types";

/**
 * Student survey responses (UC-SV-02, #79).
 * GET  ?classId&assignmentId[&surveyId][&studentId] → { responses }
 * POST { classId, assignmentId, surveyId, studentId, studentName?, answers,
 *        action: "save" | "submit" }
 */
export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("classId");
  const assignmentId = searchParams.get("assignmentId");
  if (!classId || !assignmentId) {
    return NextResponse.json(
      { error: "classId and assignmentId are required." },
      { status: 400 },
    );
  }
  const responses = await listSurveyResponses(
    classId,
    assignmentId,
    searchParams.get("surveyId") ?? undefined,
    searchParams.get("studentId") ?? undefined,
  );
  return NextResponse.json({ responses });
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const body = await request.json();
  const { classId, assignmentId, surveyId, studentId, studentName, answers } =
    body ?? {};
  const action = body?.action === "submit" ? "submit" : "save";

  if (!classId || !assignmentId || !surveyId || !studentId) {
    return NextResponse.json(
      { error: "classId, assignmentId, surveyId, and studentId are required." },
      { status: 400 },
    );
  }

  const survey = await getSurvey(classId, assignmentId, surveyId);
  if (!survey) {
    return NextResponse.json({ error: "Survey not found." }, { status: 404 });
  }

  const now = new Date();
  const availability = getSurveyAvailability(survey, now);
  if (!availability.open) {
    return NextResponse.json(
      { error: availability.message, reason: availability.reason },
      { status: 403 },
    );
  }

  const [existing] = await listSurveyResponses(
    classId,
    assignmentId,
    surveyId,
    studentId,
  );
  if (existing?.status === "submitted") {
    return NextResponse.json(
      { error: "You have already submitted this survey." },
      { status: 409 },
    );
  }

  const clean = sanitizeAnswers(survey, answers);

  if (action === "submit") {
    const missing = findMissingAnswers(survey, clean);
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "Please answer every question before submitting.",
          missing,
        },
        { status: 400 },
      );
    }
  }

  const response: SurveyResponse = {
    survey_id: surveyId,
    class_id: classId,
    assignment_id: assignmentId,
    student_id: studentId,
    student_name:
      typeof studentName === "string" ? studentName : existing?.student_name,
    answers: clean,
    status: action === "submit" ? "submitted" : "draft",
    submitted_at:
      action === "submit" ? now.toISOString() : existing?.submitted_at,
    updated_at: now.toISOString(),
  };

  const saved = await upsertSurveyResponse(response);
  return NextResponse.json({ response: saved });
}
