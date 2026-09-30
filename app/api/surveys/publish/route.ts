import { NextResponse } from "next/server";
import { getSurvey, upsertSurvey } from "@/lib/nosql";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import {
  resolveSurveyStatus,
  validateSchedule,
  validateSurveyIsPublishable,
} from "@/lib/survey-schedule";
import type { Survey, SurveySchedule } from "@/lib/types";

const optionalDate = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : undefined;

/**
 * Publish a survey, or change its dates later (UC-SV-03, #80).
 * The publish and due dates are both optional (#106).
 */
export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;

  const body = await request.json();
  const { classId, assignmentId, surveyId, publishAt, dueAt, publishedBy } = body ?? {};

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
    publish_at: optionalDate(publishAt),
    due_at: optionalDate(dueAt),
  };

  const errors = [...validateSchedule(schedule), ...validateSurveyIsPublishable(existing)];
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  const now = new Date();
  const published: Survey = {
    ...existing,
    schedule,
    status: resolveSurveyStatus({ status: "published", schedule }, now),
    published_by: typeof publishedBy === "string" ? publishedBy : existing.published_by,
    published_at: existing.published_at ?? now.toISOString(),
    updated_at: now.toISOString(),
  };

  const saved = await upsertSurvey(published);
  return NextResponse.json({ survey: saved });
}
