import {
  getQuizStatus,
  getStudentAnswer,
  listPublishedContent,
  listReviewQuestions,
  listContentRatings,
  listSurveys,
  listSurveyResponses,
} from "@/lib/nosql";

import { getSurveyAvailability } from "./survey-response";
import { pickTaskSurvey } from "./survey-schedule";

export type ActivityId = "assessment" | "content-review" | "content-rating";
export type ActivityStatus = "locked" | "available" | "completed";

export const ACTIVITIES: { id: ActivityId; order: number }[] = [
  { id: "assessment", order: 0 },
  { id: "content-review", order: 1 },
  { id: "content-rating", order: 2 },
];

export const computeActivityStatuses = async (
  classId: string,
  assignmentId: string,
  studentId: string,
): Promise<Record<ActivityId, ActivityStatus>> => {
  const [quiz, answer, published] = await Promise.all([
    getQuizStatus(classId, assignmentId),
    getStudentAnswer(classId, assignmentId, studentId),
    listPublishedContent(classId, assignmentId),
  ]);

  const currentAnswer = answer && (!quiz || answer.lesson_number === quiz.lesson_number);
  let assessment: ActivityStatus = currentAnswer
    ? "completed"
    : quiz?.status === "published"
      ? "available"
      : "locked";

  // Quiz and the currently open task survey share one assessment submission.
  // A saved quiz must not hide a failed/unsubmitted survey behind auto-advance.
  if (currentAnswer && quiz?.status === "published") {
    const survey = pickTaskSurvey((await listSurveys(classId, assignmentId)).filter(item => item.status !== "draft"));
    if (survey && getSurveyAvailability(survey).open) {
      const responses = await listSurveyResponses(classId, assignmentId, survey.survey_id, studentId);
      if (!responses.some(response => response.status === "submitted")) assessment = "available";
    }
  }

  // Published pre-assessments precede exploration. A material-only task stays
  // available when the teacher has not published a quiz.
  const contentAvailable = published.length > 0 && assessment !== "available";
  const reviewQuestions = contentAvailable
    ? await listReviewQuestions(classId, assignmentId, studentId)
    : [];
  const hasReview = reviewQuestions.some((r) => r.questions.length > 0);

  const contentReview: ActivityStatus = hasReview
    ? "completed"
    : contentAvailable
      ? "available"
      : "locked";

  const ratings = contentReview === "completed"
    ? await listContentRatings(classId, assignmentId, studentId)
    : [];
  const ratedItemIds = new Set(ratings.map((r) => r.content_item_id));
  const allRated =
    published.length > 0 && published.every((item) => ratedItemIds.has(item.content_item_id));

  const contentRating: ActivityStatus =
    contentReview === "completed"
      ? allRated
        ? "completed"
        : "available"
      : "locked";

  return {
    assessment,
    "content-review": contentReview,
    "content-rating": contentRating,
  };
};
