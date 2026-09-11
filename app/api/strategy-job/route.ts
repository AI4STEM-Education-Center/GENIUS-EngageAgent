import crypto from "node:crypto";

import { NextResponse } from "next/server";

import {
  enqueueCohortJobStudents,
  getCohortAnalysisQueueConfigIssues,
  isCohortAnalysisQueueConfigured,
} from "@/lib/cohort-analysis-queue";
import { createCohortJob, setCohortJobStatus } from "@/lib/nosql";

type Student = {
  id: string;
  name: string;
  assignment?: string;
  answers: Record<string, string | undefined>;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    if (!isCohortAnalysisQueueConfigured()) {
      const missingEnv = getCohortAnalysisQueueConfigIssues();
      return NextResponse.json(
        {
          error:
            "Cohort analysis queue is not configured on this environment.",
          missingEnv,
        },
        { status: 501 },
      );
    }

    const {
      classId,
      assignmentId,
      lessonNumber,
      forceRefresh,
      students = [],
    } = (await request.json()) as {
      classId?: string;
      assignmentId?: string;
      lessonNumber?: number;
      forceRefresh?: boolean;
      students?: Student[];
    };

    const classKey = classId?.trim();
    const assignmentKey = assignmentId?.trim();
    const normalizedLessonNumber =
      typeof lessonNumber === "number" &&
      Number.isInteger(lessonNumber) &&
      lessonNumber > 0
        ? lessonNumber
        : null;

    if (!classKey || !assignmentKey || normalizedLessonNumber === null) {
      return NextResponse.json(
        { error: "classId, assignmentId, and lessonNumber are required." },
        { status: 400 },
      );
    }

    const normalizedStudents = (students ?? []).filter(
      (student) => student?.id && student?.name,
    );
    const shouldForceRefresh = forceRefresh === true;
    if (normalizedStudents.length === 0) {
      return NextResponse.json(
        { error: "At least one student is required." },
        { status: 400 },
      );
    }

    const jobId = crypto.randomUUID();
    await createCohortJob(
      jobId,
      classKey,
      assignmentKey,
      normalizedStudents.length,
    );

    try {
      await enqueueCohortJobStudents({
        jobId,
        classId: classKey,
        assignmentId: assignmentKey,
        lessonNumber: normalizedLessonNumber,
        totalStudents: normalizedStudents.length,
        forceRefresh: shouldForceRefresh,
        students: normalizedStudents,
      });
    } catch (error) {
      await setCohortJobStatus(
        jobId,
        "failed_to_queue",
        error instanceof Error ? error.message : "Failed to queue cohort analysis.",
      );
      throw error;
    }

    return NextResponse.json(
      {
        jobId,
        queuedStudents: normalizedStudents.length,
        totalStudents: normalizedStudents.length,
        status: "queued",
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start cohort analysis.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
