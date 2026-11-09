import { getQuizStatus, getTaskDoc, listPublishedContent, listSurveys } from "./nosql";
import { activityProgress, type ActivityProgress } from "./activity-progress";

/** A task's activity progress from saved data (#176). Check access first. */
export async function computeActivityProgress(classId: string, assignmentId: string): Promise<ActivityProgress> {
  const [quiz, surveys, published, board, release] = await Promise.all([
    getQuizStatus(classId, assignmentId),
    listSurveys(classId, assignmentId),
    listPublishedContent(classId, assignmentId),
    getTaskDoc(classId, assignmentId, "question_board"),
    getTaskDoc(classId, assignmentId, "report_release"),
  ]);
  return activityProgress({
    lessonChosen: Boolean(quiz?.lesson_number),
    assessmentPublished: (!!quiz && quiz.status !== "draft") || surveys.some(survey => survey.status !== "draft"),
    strategyChosen: false,
    materialsSent: published.length > 0,
    boardPublished: Boolean(board),
    reportsReleased: Boolean(release),
  });
}
