import { NextResponse } from "next/server";
import { getQuizStatus, upsertQuizStatus } from "@/lib/nosql";
import { getLesson } from "@/lib/quiz-data";
import { CURRENT_QUIZ_VERSION } from "@/lib/quiz-assessment";

function formatStorageError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Failed to access quiz status.";

  if (message.includes("Requested resource not found")) {
    return "Database resource not found. Check DYNAMODB_TABLE and ENGAGE_AWS_REGION.";
  }

  return message;
}

function logStorageError(action: "GET" | "POST", error: unknown) {
  const message =
    error instanceof Error ? error.message : "Failed to access quiz status.";

  console.error(`quiz-status ${action} error:`, {
    message,
    table: process.env.DYNAMODB_TABLE ?? "(missing)",
    region: process.env.ENGAGE_AWS_REGION ?? "us-east-2",
  });
}

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

  try {
    const record = await getQuizStatus(classId, assignmentId);
    return NextResponse.json({ quizStatus: record });
  } catch (error) {
    logStorageError("GET", error);
    return NextResponse.json(
      { error: formatStorageError(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { classId, assignmentId, lessonNumber, status, publishedBy } = body;

    if (!classId || !assignmentId || !lessonNumber || !status) {
      return NextResponse.json(
        { error: "classId, assignmentId, lessonNumber, and status are required." },
        { status: 400 },
      );
    }

    if (!["draft", "published", "closed"].includes(status)) {
      return NextResponse.json(
        { error: "status must be draft, published, or closed." },
        { status: 400 },
      );
    }

    if (!Number.isInteger(lessonNumber) || !getLesson(lessonNumber)) {
      return NextResponse.json({ error: "lessonNumber must be an available lesson (1–8)." }, { status: 400 });
    }

    // Closing a legacy quiz must not change the questions students completed.
    const previous = status === "closed" ? await getQuizStatus(classId, assignmentId) : null;
    const quizVersion = status === "closed" && previous && previous.lesson_number === lessonNumber
      ? previous.quiz_version ?? 1
      : CURRENT_QUIZ_VERSION;

    const record = await upsertQuizStatus(
      classId,
      assignmentId,
      lessonNumber,
      status,
      publishedBy,
      quizVersion,
    );
    return NextResponse.json({ quizStatus: record });
  } catch (error) {
    logStorageError("POST", error);
    return NextResponse.json(
      { error: formatStorageError(error) },
      { status: 500 },
    );
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
