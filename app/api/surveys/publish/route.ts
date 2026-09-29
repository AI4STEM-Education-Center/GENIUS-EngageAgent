import { NextResponse } from "next/server";
import { getSurvey, upsertSurvey } from "@/lib/nosql";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import {
  resolveSurveyStatus,
  validateSchedule,
  validateSurveyIsPublishable,
} from "@/lib/survey-schedule";
import type { Survey, SurveySchedule } from "@/lib/types";

/**
 * Publish or schedule a survey, and edit the publish settings of one that is
 * already published or scheduled (UC-SV-03, #80).
 */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;

  const body = await request.json();
  const {
    classId,
    assignmentId,
    surveyId,
    publishAt,
    dueAt,
    allowLateSubmissions,
    allowResponseEditing,
    showImmediately,
    publishedBy,
  } = body ?? {};

  if (!classId || !assignmentId || !surveyId) {
    return NextResponse.json(
      { error: "classId, assignmentId, and surveyId are required." },
      { status: 400 },
    );
  }

  const existing = await getSurvey(classId, assignmentId, surveyId);
  if (!existing) {
    return NextResponse.json({ error: "Survey not found." }, { status: 404 });
  }

  const schedule: SurveySchedule = {
    publish_at: typeof publishAt === "string" ? publishAt : "",
    due_at: typeof dueAt === "string" ? dueAt : "",
    allow_late_submissions: Boolean(allowLateSubmissions),
    allow_response_editing: Boolean(allowResponseEditing),
    show_immediately: showImmediately === undefined ? true : Boolean(showImmediately),
  };

  const errors = [
    ...validateSchedule(schedule),
    ...validateSurveyIsPublishable(existing),
  ];
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  const now = new Date();
  const published: Survey = {
    ...existing,
    schedule,
    status: resolveSurveyStatus({ status: existing.status, schedule }, now),
    published_by:
      typeof publishedBy === "string" ? publishedBy : existing.published_by,
    published_at: existing.published_at ?? now.toISOString(),
    updated_at: now.toISOString(),
  };

  const saved = await upsertSurvey(published);
  return NextResponse.json({ survey: saved });
}
