import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { extractSSOToken, verifySSOToken } from "@/lib/auth";
import { getLesson } from "@/lib/quiz-data";
import { getQuizStatus, upsertStudentAnswer } from "@/lib/nosql";
import { TEST_STUDENTS } from "@/lib/test-students";
import type { QuizItem } from "@/lib/types";

type RequestBody = {
  classId?: string;
  assignmentId?: string;
};

const MOCK_TEACHER_HEADER = "x-engage-mock-user";

const pickDeterministicOption = (
  item: QuizItem,
  seed: string,
) => {
  const optionKeys = Object.keys(item.options).sort();
  if (optionKeys.length === 0) {
    throw new Error(`Quiz item ${item.item_id} has no options.`);
  }

  const digest = crypto.createHash("sha256").update(seed).digest();
  const index = digest.readUInt32BE(0) % optionKeys.length;
  return optionKeys[index];
};

const buildAnswers = (
  classId: string,
  assignmentId: string,
  lessonNumber: number,
  studentId: string,
  studentEmail: string,
  quizItems: QuizItem[],
) =>
  Object.fromEntries(
    quizItems.map((item) => [
      item.item_id,
      pickDeterministicOption(
        item,
        `${classId}:${assignmentId}:${lessonNumber}:${studentId}:${studentEmail}:${item.item_id}`,
      ),
    ]),
  );

async function resolveTeacherContext(request: Request, body: RequestBody): Promise<{ error: NextResponse } | { classId: string; assignmentId: string }> {
  const token = extractSSOToken(request);

  if (token) {
    const user = await verifySSOToken(token);

    if (user.role !== "teacher") {
      return {
        error: NextResponse.json(
          { error: "Only teachers can auto-answer test students." },
          { status: 403 },
        ),
      };
    }

    if (!user.classId || !user.assignmentId) {
      return {
        error: NextResponse.json(
          { error: "Teacher SSO context must include classId and assignmentId." },
          { status: 400 },
        ),
      };
    }

    if (
      (body.classId && body.classId !== user.classId) ||
      (body.assignmentId && body.assignmentId !== user.assignmentId)
    ) {
      return {
        error: NextResponse.json(
          { error: "Body context does not match the current teacher session." },
          { status: 403 },
        ),
      };
    }

    return {
      classId: user.classId,
      assignmentId: user.assignmentId,
    };
  }

  if (request.headers.get(MOCK_TEACHER_HEADER) === "teacher") {
    if (!body.classId || !body.assignmentId) {
      return {
        error: NextResponse.json(
          { error: "classId and assignmentId are required in mock teacher mode." },
          { status: 400 },
        ),
      };
    }

    return {
      classId: body.classId,
      assignmentId: body.assignmentId,
    };
  }

  return {
    error: NextResponse.json(
      { error: "Teacher authentication is required." },
      { status: 401 },
    ),
  };
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const context = await resolveTeacherContext(request, body);

    if ("error" in context) {
      return context.error;
    }

    const { classId, assignmentId } = context;
    const quizStatus = await getQuizStatus(classId, assignmentId);

    if (!quizStatus || quizStatus.status !== "published") {
      return NextResponse.json(
        { error: "A published quiz is required before generating test submissions." },
        { status: 409 },
      );
    }

    const lesson = getLesson(quizStatus.lesson_number);
    if (!lesson) {
      return NextResponse.json(
        { error: `Lesson ${quizStatus.lesson_number} could not be loaded.` },
        { status: 404 },
      );
    }

    const submittedAt = new Date().toISOString();
    const students = await Promise.all(
      TEST_STUDENTS.map(async (student) => {
        const answers = buildAnswers(
          classId,
          assignmentId,
          lesson.lesson_number,
          student.id,
          student.email,
          lesson.quiz_items,
        );

        const record = await upsertStudentAnswer({
          class_id: classId,
          assignment_id: assignmentId,
          student_id: student.id,
          student_name: student.name,
          lesson_number: lesson.lesson_number,
          answers,
          submitted_at: submittedAt,
        });

        return {
          studentId: student.id,
          studentName: student.name,
          studentEmail: student.email,
          answers: record.answers,
          submittedAt: record.submitted_at,
        };
      }),
    );

    return NextResponse.json(
      {
        classId,
        assignmentId,
        lessonNumber: lesson.lesson_number,
        generatedCount: students.length,
        students,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to auto-answer test students.",
      },
      { status: 500 },
    );
  }
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
