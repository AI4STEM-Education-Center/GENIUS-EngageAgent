import { NextResponse } from "next/server";

import { enterLessonScope, loadTaskLessons } from "@/lib/lesson-scope";
import { recordTeacherAnnotation } from "@/lib/nosql";
import { FocusError, resolveStrategyFocus } from "@/lib/strategy-focus";

export const runtime = "nodejs";

type AnnotationRequest = {
  classId?: string;
  assignmentId?: string;
  studentName?: string | null;
  assignment?: string | null;
  overallRecommendation?: string;
  recommendationReason?: string | null;
  decision?: "agree" | "disagree";
  reason?: string | null;
  aiPlan?: Record<string, unknown>;
  selectedStrategies?: string[];
  /** With focus: the lesson the focus belongs to. */
  lessonNumber?: number;
  focus?: unknown;
  answers?: Record<string, string | undefined>;
};

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const payload = (await request.json()) as AnnotationRequest;
    const overallRecommendation = payload.overallRecommendation?.trim();
    const decision = payload.decision;
    const reason = payload.reason?.trim() || null;

    if (!overallRecommendation || !decision) {
      return NextResponse.json(
        {
          error: "overallRecommendation and decision are required.",
        },
        { status: 400 },
      );
    }

    // Choosing a different strategy is recorded as a disagreement; the reason is optional (#178).
    let strategyFocus = null;
    if (payload.focus !== undefined) {
      const strategy = payload.selectedStrategies?.[0];
      if (typeof payload.lessonNumber !== "number" || typeof strategy !== "string") {
        return NextResponse.json({ error: "lessonNumber and selectedStrategies are required with focus." }, { status: 400 });
      }
      enterLessonScope(await loadTaskLessons({ classId: payload.classId!, assignmentId: payload.assignmentId! }, payload.lessonNumber));
      try {
        strategyFocus = resolveStrategyFocus(payload.lessonNumber, strategy, payload.focus);
      } catch (error) {
        if (error instanceof FocusError) return NextResponse.json({ error: error.message }, { status: 400 });
        throw error;
      }
    }

    const record = await recordTeacherAnnotation({
      ...(payload.classId?.startsWith("ea-class-") ? { workspace_class_id: payload.classId } : {}),
      student_name: payload.studentName ?? null,
      assignment: payload.assignment ?? null,
      overall_recommendation: overallRecommendation,
      recommendation_reason: payload.recommendationReason ?? null,
      decision,
      reason,
      ai_plan: payload.aiPlan ?? {},
      selected_strategies: payload.selectedStrategies ?? [],
      ...(strategyFocus ? { strategy_focus: strategyFocus } : {}),
      answers: payload.answers ?? {},
    });

    return NextResponse.json({ annotation: record });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save annotation.";
    console.error("teacher-annotation error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
