import { getQuizStatus, getTaskDoc, listPublishedContent, listSurveys } from "./nosql";
import { activityProgress, type ActivityProgress } from "./activity-progress";
import type { ReportRelease } from "./quiz-report";

/** A task's activity progress from saved data (#176). Check access first. */
export async function computeActivityProgress(classId: string, assignmentId: string): Promise<ActivityProgress> {
  const [quiz, surveys, published, board, release] = await Promise.all([
    // Progress is refreshed immediately after saving a quiz or choosing a lesson.
    getQuizStatus(classId, assignmentId, { consistentRead: true }),
    listSurveys(classId, assignmentId),
    listPublishedContent(classId, assignmentId),
    getTaskDoc(classId, assignmentId, "question_board"),
    getTaskDoc<ReportRelease>(classId, assignmentId, "report_release"),
  ]);
  return activityProgress({
    lessonChosen: Boolean(quiz?.lesson_number),
    assessmentPublished: (!!quiz && quiz.status !== "draft") || surveys.some(survey => survey.status !== "draft"),
    strategyChosen: false,
    materialsSent: published.length > 0,
    boardPublished: Boolean(board),
    // A previous lesson's release must not complete the current quiz activity.
    reportsReleased: Boolean(quiz?.lesson_number && quiz.status !== "draft" && release?.lessonNumber === quiz.lesson_number),
  });
}
