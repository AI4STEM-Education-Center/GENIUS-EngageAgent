import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  getSurvey,
  getSurveyAnalysis,
  listSurveyResponses,
  upsertSurveyAnalysis,
} from "@/lib/nosql";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { analyzeDailyExperiences, DEFAULT_ANALYSIS_MODEL, type ChatClient } from "@/lib/daily-experience-llm";
import type { SurveyAnalysisRecord } from "@/lib/daily-experience-analysis";

/**
 * Daily-experience analysis of a survey's responses (#114).
 *
 * GET returns the saved analysis (or null) plus how many responses are
 * submitted now, so the teacher view can flag new responses since the last
 * run. POST runs a new analysis and replaces the saved one; on failure the
 * previous analysis is kept.
 *
 * Teacher-only in live GENIUS classes via guardWorkspaceRequest (this path
 * isn't on the student allowlist).
 */

export const runtime = "nodejs";
export const maxDuration = 60;

/** What the browser sees: never the per-student extractions or id map. */
const toView = (record: SurveyAnalysisRecord) => ({
  surveyId: record.survey_id,
  dailyExperienceTopic: record.daily_experience_topic,
  analyzedAt: record.analyzed_at,
  model: record.model,
  summary: record.summary,
});

const submittedCount = async (classId: string, assignmentId: string, surveyId: string) =>
  (await listSurveyResponses(classId, assignmentId, surveyId)).filter(
    (r) => r.survey_id === surveyId && r.status === "submitted",
  ).length;

const missingIds = () =>
  NextResponse.json({ error: "classId, assignmentId and surveyId are required." }, { status: 400 });

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("classId");
  const assignmentId = searchParams.get("assignmentId");
  const surveyId = searchParams.get("surveyId");
  if (!classId || !assignmentId || !surveyId) return missingIds();

  const [analysis, count] = await Promise.all([
    getSurveyAnalysis(classId, assignmentId, surveyId),
    submittedCount(classId, assignmentId, surveyId),
  ]);
  return NextResponse.json({ analysis: analysis ? toView(analysis) : null, submittedCount: count });
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { classId, assignmentId, surveyId } = ((await request.json()) ?? {}) as {
    classId?: string;
    assignmentId?: string;
    surveyId?: string;
  };
  if (!classId || !assignmentId || !surveyId) return missingIds();

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set." }, { status: 500 });
  }

  const survey = await getSurvey(classId, assignmentId, surveyId);
  if (!survey) return NextResponse.json({ error: "Survey not found." }, { status: 404 });

  const responses = await listSurveyResponses(classId, assignmentId, surveyId);
  const model = process.env.OPENAI_SURVEY_ANALYSIS_MODEL ?? DEFAULT_ANALYSIS_MODEL;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as ChatClient;
    const result = await analyzeDailyExperiences({ client, survey, responses, model });
    const record = await upsertSurveyAnalysis({
      class_id: classId,
      assignment_id: assignmentId,
      survey_id: surveyId,
      daily_experience_topic: survey.daily_experience_topic,
      model: result.model,
      analyzed_at: new Date().toISOString(),
      summary: result.summary,
      extractions: result.extractions,
      grouping: result.grouping,
      id_map: result.idMap,
    });
    return NextResponse.json({ analysis: toView(record), submittedCount: result.summary.responseCount });
  } catch (error) {
    console.error("survey-analysis failed", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "The analysis could not be completed. Please try again." },
      { status: 502 },
    );
  }
}
