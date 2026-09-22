import {
  getQuizStatus,
  getStudentAnswer,
  listPublishedContent,
  listReviewQuestions,
  listContentRatings,
} from "@/lib/nosql";

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

  const assessment: ActivityStatus = answer
    ? "completed"
    : quiz?.status === "published"
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
