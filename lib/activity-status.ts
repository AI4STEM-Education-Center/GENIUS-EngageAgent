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
import { getLesson } from "./quiz-data";
import { getQuizItemsForVersion, isQuizComplete } from "./quiz-assessment";

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

  const integratedQuiz = (quiz?.quiz_version ?? 1) >= 2;
  const currentAnswer = answer && (!quiz || answer.lesson_number === quiz.lesson_number)
    && (!integratedQuiz || isQuizComplete(
      getQuizItemsForVersion(getLesson(quiz!.lesson_number)?.quiz_items ?? [], quiz!.quiz_version), answer.answers,
    ));
  // Version 2 collects experience questions in the same quiz submission.
  const survey = integratedQuiz ? undefined : pickTaskSurvey((await listSurveys(classId, assignmentId)).filter(item => item.status !== "draft"));
  const surveyOpen = !!survey && getSurveyAvailability(survey).open;
  const responses = surveyOpen
    ? await listSurveyResponses(classId, assignmentId, survey.survey_id, studentId)
    : [];
  const surveyDone = responses.some(response => response.status === "submitted");
  const quizOpen = quiz?.status === "published";
  const assessmentDone = (quizOpen ? !!currentAnswer : !!currentAnswer || surveyOpen)
    && (!surveyOpen || surveyDone);
  const assessment: ActivityStatus = assessmentDone
    ? "completed"
    : quizOpen || surveyOpen
      ? "available"
      : "locked";

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
