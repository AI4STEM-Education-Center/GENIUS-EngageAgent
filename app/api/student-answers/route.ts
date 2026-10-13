import { NextResponse } from "next/server";
import { upsertStudentAnswer, listStudentAnswers, getStudentAnswer, getQuizStatus } from "@/lib/nosql";
import { getLesson } from "@/lib/quiz-data";
import { getQuizAnswerValidationError, getQuizItemsForVersion } from "@/lib/quiz-assessment";

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("classId");
  const assignmentId = searchParams.get("assignmentId");
  const studentId = searchParams.get("studentId");
  const lessonNumberParam = searchParams.get("lessonNumber");

  if (!classId || !assignmentId) {
    return NextResponse.json(
      { error: "classId and assignmentId are required." },
      { status: 400 },
    );
  }

  const lessonNumber =
    lessonNumberParam === null ? undefined : Number.parseInt(lessonNumberParam, 10);
  if (
    lessonNumberParam !== null &&
    (Number.isNaN(lessonNumber) || (lessonNumber ?? 0) < 1)
  ) {
    return NextResponse.json(
      { error: "lessonNumber must be a positive integer when provided." },
      { status: 400 },
    );
  }

  if (studentId) {
    const answer = await getStudentAnswer(classId, assignmentId, studentId);
    if (lessonNumber !== undefined && answer?.lesson_number !== lessonNumber) {
      return NextResponse.json({ answer: null });
    }
    return NextResponse.json({ answer });
  }

  const answers = await listStudentAnswers(classId, assignmentId);
  const filteredAnswers =
    lessonNumber === undefined
      ? answers
      : answers.filter((answer) => answer.lesson_number === lessonNumber);
  return NextResponse.json({ answers: filteredAnswers });
}

export async function POST(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const body = await request.json();
  const { classId, assignmentId, studentId, studentName, lessonNumber, answers } = body;

  if (!classId || !assignmentId || !studentId || !lessonNumber || !answers) {
    return NextResponse.json(
      { error: "classId, assignmentId, studentId, lessonNumber, and answers are required." },
      { status: 400 },
    );
  }

  if (typeof answers !== "object" || Array.isArray(answers) || Object.keys(answers).length === 0
    || Object.values(answers).some(value => typeof value !== "string")) {
    return NextResponse.json(
      { error: "answers must be a non-empty object of text values." },
      { status: 400 },
    );
  }

  const quiz = await getQuizStatus(classId, assignmentId);
  if ((quiz?.quiz_version ?? 1) >= 2) {
    const lesson = getLesson(lessonNumber);
    if (!lesson || quiz?.status !== "published" || quiz.lesson_number !== lessonNumber) {
      return NextResponse.json({ error: "This quiz is not open for responses." }, { status: 409 });
    }
    const error = getQuizAnswerValidationError(getQuizItemsForVersion(lesson.quiz_items, quiz.quiz_version), answers);
    if (error) return NextResponse.json({ error }, { status: 400 });
  }

  const record = await upsertStudentAnswer({
    class_id: classId,
    assignment_id: assignmentId,
    student_id: studentId,
    student_name: studentName ?? "Student",
    lesson_number: lessonNumber,
    answers,
    submitted_at: new Date().toISOString(),
  });

  return NextResponse.json({ answer: record }, { status: 201 });
}
import { guardWorkspaceRequest } from "@/lib/workspace-access";
