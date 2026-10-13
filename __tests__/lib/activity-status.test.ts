import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ getQuizStatus: vi.fn(), getStudentAnswer: vi.fn(), listPublishedContent: vi.fn(), listReviewQuestions: vi.fn(), listContentRatings: vi.fn(), listSurveys: vi.fn(), listSurveyResponses: vi.fn() }));
vi.mock("@/lib/nosql", () => store);
import { computeActivityStatuses } from "@/lib/activity-status";
beforeEach(() => {
  vi.clearAllMocks();
  store.getQuizStatus.mockResolvedValue(null);
  store.getStudentAnswer.mockResolvedValue(null);
  store.listPublishedContent.mockResolvedValue([{ content_item_id: "deck-a" }]);
  store.listReviewQuestions.mockResolvedValue([{ questions: ["Why does it slow down?"] }]);
  store.listContentRatings.mockResolvedValue([{ content_item_id: "deck-a" }]);
  store.listSurveys.mockResolvedValue([]);
  store.listSurveyResponses.mockResolvedValue([]);
});
it("keeps published materials-only assignments available without manufacturing a quiz requirement", async () => {
  expect(await computeActivityStatuses("class", "task", "student")).toEqual({ assessment: "locked", "content-review": "completed", "content-rating": "completed" });
});
it("requires a published pre-assessment before materials, even when old questions and ratings exist", async () => {
  store.getQuizStatus.mockResolvedValue({ status: "published", lesson_number: 8 });
  expect(await computeActivityStatuses("class", "task", "student")).toEqual({ assessment: "available", "content-review": "locked", "content-rating": "locked" });
  expect(store.listReviewQuestions).not.toHaveBeenCalled();
  expect(store.listContentRatings).not.toHaveBeenCalled();
});
it("unlocks materials after the quiz is submitted and scopes every lookup to the current assignment", async () => {
  store.getQuizStatus.mockResolvedValue({ status: "published", lesson_number: 8 });
  store.getStudentAnswer.mockResolvedValue({ answers: { q1: "A" }, lesson_number: 8 });
  expect((await computeActivityStatuses("class", "task", "student"))["content-review"]).toBe("completed");
  expect(store.getStudentAnswer).toHaveBeenCalledWith("class", "task", "student");
  expect(store.listReviewQuestions).toHaveBeenCalledWith("class", "task", "student");
  expect(store.listContentRatings).toHaveBeenCalledWith("class", "task", "student");
});
it("reopens material rating when a new publication has not yet been rated", async () => {
  store.listPublishedContent.mockResolvedValue([{ content_item_id: "deck-a" }, { content_item_id: "deck-b" }]);
  expect((await computeActivityStatuses("class", "task", "student"))["content-rating"]).toBe("available");
});

it("does not treat an answer from an older lesson as completing the currently published quiz", async () => {
  store.getQuizStatus.mockResolvedValue({ status: "published", lesson_number: 9 });
  store.getStudentAnswer.mockResolvedValue({ lesson_number: 8, answers: { q1: "A" } });
  expect(await computeActivityStatuses("class", "task", "student")).toEqual({ assessment: "available", "content-review": "locked", "content-rating": "locked" });
});

it("keeps assessment open after quiz success when an available survey has not submitted, then unlocks after retry", async () => {
  store.getQuizStatus.mockResolvedValue({ status: "published", lesson_number: 8 });
  store.getStudentAnswer.mockResolvedValue({ lesson_number: 8, answers: { q1: "A" } });
  store.listSurveys.mockResolvedValue([{ survey_id: "survey-a", status: "published", updated_at: "2026-10-13" }]);
  store.listSurveyResponses.mockResolvedValue([{ status: "draft" }]);
  expect(await computeActivityStatuses("class", "task", "student")).toEqual({ assessment: "available", "content-review": "locked", "content-rating": "locked" });
  expect(store.listSurveyResponses).toHaveBeenCalledWith("class", "task", "survey-a", "student");
  store.listSurveyResponses.mockResolvedValue([{ status: "submitted" }]);
  expect((await computeActivityStatuses("class", "task", "student")).assessment).toBe("completed");
});
it.each(["draft", "scheduled", "closed"])("does not block a submitted quiz for a %s survey", async status => {
  store.getQuizStatus.mockResolvedValue({ status: "published", lesson_number: 8 });
  store.getStudentAnswer.mockResolvedValue({ lesson_number: 8, answers: { q1: "A" } });
  const schedule = status === "scheduled" ? { publish_at: new Date(Date.now() + 60000).toISOString() }
    : status === "closed" ? { due_at: new Date(Date.now() - 60000).toISOString() } : undefined;
  store.listSurveys.mockResolvedValue([{ survey_id: "survey-a", status, schedule, updated_at: "2026-10-13" }]);
  expect((await computeActivityStatuses("class", "task", "student")).assessment).toBe("completed");
  expect(store.listSurveyResponses).not.toHaveBeenCalled();
});
