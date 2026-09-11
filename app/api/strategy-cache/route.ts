import { NextRequest, NextResponse } from "next/server";

import { listCachedPlans } from "@/lib/nosql";
import { deserializeCachedPlan } from "@/lib/strategy-plan-cache";

export const runtime = "nodejs";

/**
 * GET /api/strategy-cache?classId=...&assignmentId=...&studentId=...
 *
 * Returns cached strategy plans from DynamoDB (or local fallback).
 * - classId + assignmentId are required
 * - studentId is optional — omit to get all students in the session
 *
 * Response shape:
 *   { results: [{ studentId, plan, updatedAt }], count: number }
 */
export async function GET(request: NextRequest) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { searchParams } = request.nextUrl;
  const classId = searchParams.get("classId")?.trim();
  const assignmentId = searchParams.get("assignmentId")?.trim();
  const studentId = searchParams.get("studentId")?.trim() || undefined;
  const lessonNumberParam = searchParams.get("lessonNumber");

  if (!classId || !assignmentId) {
    return NextResponse.json(
      { error: "classId and assignmentId are required query parameters." },
      { status: 400 },
    );
  }

  const lessonNumber =
    lessonNumberParam === null
      ? undefined
      : Number.parseInt(lessonNumberParam, 10);
  if (
    lessonNumberParam !== null &&
    (Number.isNaN(lessonNumber) || (lessonNumber ?? 0) < 1)
  ) {
    return NextResponse.json(
      { error: "lessonNumber must be a positive integer when provided." },
      { status: 400 },
    );
  }

  try {
    const records = await listCachedPlans(classId, assignmentId, studentId);
    console.info(
      `strategy-cache: classId=${classId} assignmentId=${assignmentId} → ${records.length} cached plan(s)`,
    );

    const results = records
      .map((record) => {
        try {
          const plan = deserializeCachedPlan(record.plan_json, {
            lessonNumber,
            requireVersionMatch: lessonNumber !== undefined,
          });
          if (!plan) {
            return null;
          }
          return {
            studentId: record.student_id,
            plan,
            updatedAt: record.updated_at,
          };
        } catch {
          if (lessonNumber !== undefined) {
            return null;
          }
          return {
            studentId: record.student_id,
            plan: record.plan_json,
            updatedAt: record.updated_at,
          };
        }
      })
      .filter((result): result is NonNullable<typeof result> => Boolean(result));

    return NextResponse.json({ results, count: results.length });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to retrieve cached plans.";
    console.error("strategy-cache GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
