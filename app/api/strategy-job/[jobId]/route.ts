import { NextResponse } from "next/server";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

import { getCohortJob } from "@/lib/nosql";

type Plan = {
  strategy?: string;
  [key: string]: unknown;
};

const normalizeStrategy = (strategy: string) => strategy.trim().toLowerCase();

const parsePlan = (value: string | undefined): Plan | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Plan;
    if (typeof parsed.strategy === "string") {
      parsed.strategy = normalizeStrategy(parsed.strategy);
    }
    return parsed;
  } catch {
    return null;
  }
};

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  const data = await getCohortJob(jobId);
  if (!data.job) {
    return NextResponse.json({ error: "Cohort analysis job not found." }, { status: 404 });
  }

  const denied = await guardWorkspaceRequest(_request, { classId: data.job.class_id, assignmentId: data.job.assignment_id });
  if (denied) return denied;

  const results = data.students
    .map((student) => {
      const plan = parsePlan(student.plan_json);
      if (student.status !== "completed" || !plan) {
        return null;
      }
      return {
        id: student.student_id,
        name: student.student_name,
        plan,
      };
    })
    .filter((result): result is NonNullable<typeof result> => Boolean(result));

  const errors = data.students
    .filter((student) => student.status === "failed")
    .map((student) => ({
      id: student.student_id,
      name: student.student_name,
      error: student.error ?? "Failed to analyze student.",
    }));

  const distribution: Record<string, number> = {};
  results.forEach((result) => {
    if (!result.plan.strategy || typeof result.plan.strategy !== "string") {
      return;
    }
    const key = normalizeStrategy(result.plan.strategy);
    distribution[key] = (distribution[key] ?? 0) + 1;
  });

  return NextResponse.json({
    job: {
      jobId: data.job.job_id,
      classId: data.job.class_id,
      assignmentId: data.job.assignment_id,
      totalStudents: data.job.total_students,
      processedStudents: data.job.processed_students,
      completedStudents: data.job.completed_students,
      failedStudents: data.job.failed_students,
      status: data.job.status,
      errorMessage: data.job.error_message ?? null,
      createdAt: data.job.created_at,
      updatedAt: data.job.updated_at,
    },
    results,
    errors,
    distribution,
  });
}
