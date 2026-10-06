import {
  getQuizStatus,
  getStudentAnswer,
  listPublishedContent,
  listReviewQuestions,
  listContentRatings,
  listSurveys,
  listSurveyResponses,
} from "@/lib/nosql";
import { getSurveyAvailability } from "@/lib/survey-response";
import { pickTaskSurvey } from "@/lib/survey-schedule";

export type ActivityId = "assessment" | "content-review" | "content-rating";
export type ActivityStatus = "locked" | "available" | "completed";

export const ACTIVITIES: { id: ActivityId; order: number }[] = [
  { id: "assessment", order: 0 },
  { id: "content-review", order: 1 },
  { id: "content-rating", order: 2 },
];

/**
 * Whether the task's survey still holds up the assessment for this student
 * (#113). The quiz and survey are one task with a shared submit, so the
 * assessment is only complete once both are in. This mirrors
 * StudentQuizView: only an *open* survey counts; a draft, not-yet-open or
 * past-due survey doesn't hold the student up.
 */
const surveyStillDue = async (classId: string, assignmentId: string, studentId: string) => {
  const survey = pickTaskSurvey(await listSurveys(classId, assignmentId));
  if (!survey || !getSurveyAvailability(survey).open) return false;
  const [own] = await listSurveyResponses(classId, assignmentId, survey.survey_id, studentId);
  return own?.status !== "submitted";
};

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

  const assessmentDone = !!answer && !(await surveyStillDue(classId, assignmentId, studentId));
  const assessment: ActivityStatus = assessmentDone
    ? "completed"
    : answer || quiz?.status === "published"
      ? "available"
      : "locked";

  const contentAvailable = published.length > 0;
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
