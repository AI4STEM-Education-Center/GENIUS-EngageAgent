import { NextResponse } from "next/server";
import { guardWorkspaceRequest, workspaceRequestUser } from "@/lib/workspace-access";
import { getQuizStatus, getStudentAnswer, getTaskDoc, listStudentAnswers } from "@/lib/nosql";
import { getLesson } from "@/lib/quiz-data";
import { buildQuizReport, type ReportRelease } from "@/lib/quiz-report";

/**
 * Quiz feedback reports (#182).
 * GET ?classId&assignmentId&studentId → { release, report }: a student's own
 *   report, once the teacher has released reports (teachers can preview any time).
 * GET ?classId&assignmentId (teachers) → { release, lessonNumber, students }:
 *   who has a report, for the release card and previews.
 */
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const denied = await guardWorkspaceRequest(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const classId = params.get("classId")!, assignmentId = params.get("assignmentId")!, studentId = params.get("studentId");
  const user = await workspaceRequestUser(request);
  const teacher = user?.role === "teacher";
  const [storedRelease, quiz] = await Promise.all([
    getTaskDoc<ReportRelease>(classId, assignmentId, "report_release"),
    getQuizStatus(classId, assignmentId),
  ]);
  const lesson = quiz?.lesson_number ? getLesson(quiz.lesson_number) : undefined;
  // A task can move to another lesson. Its earlier release must not unlock
  // that lesson's answer key or appear as released on the teacher's card.
  const release = lesson && quiz?.status !== "draft" && storedRelease?.lessonNumber === lesson.lesson_number
    ? storedRelease : null;

  if (!studentId) {
    if (!teacher) return json({ error: "Teacher access required." }, 403);
    const answers = lesson ? (await listStudentAnswers(classId, assignmentId)).filter(a => a.lesson_number === lesson.lesson_number) : [];
    return json({ release, lessonNumber: lesson?.lesson_number ?? null, students: answers.map(a => ({ id: a.student_id, name: a.student_name })) });
  }
  // Students see nothing before release, not even whether they have a report.
  if (!teacher && !release) return json({ release: null, report: null });
  const answer = lesson ? await getStudentAnswer(classId, assignmentId, studentId) : null;
  const report = lesson && answer && answer.lesson_number === lesson.lesson_number ? buildQuizReport(lesson, answer.answers) : null;
  return json({ release, report });
}
