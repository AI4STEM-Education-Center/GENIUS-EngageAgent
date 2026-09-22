import { NextResponse } from "next/server";
import { ACTIVITIES, computeActivityStatuses } from "@/lib/activity-status";

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("classId");
  const assignmentId = searchParams.get("assignmentId");
  const studentId = searchParams.get("studentId");

  if (!classId || !assignmentId || !studentId) {
    return NextResponse.json(
      { error: "classId, assignmentId, and studentId are required." },
      { status: 400 },
    );
  }

  const statuses = await computeActivityStatuses(classId, assignmentId, studentId);
  const activities = ACTIVITIES.map(({ id, order }) => ({
    id,
    order,
    status: statuses[id],
  }));

  return NextResponse.json({ activities });
}

import { guardWorkspaceRequest } from "@/lib/workspace-access";
