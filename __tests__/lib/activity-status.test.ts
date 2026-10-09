import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Survey, SurveyResponse } from "@/lib/types";

vi.mock("@/lib/nosql", () => ({
  getQuizStatus: vi.fn(),
  getStudentAnswer: vi.fn(),
  listPublishedContent: vi.fn(),
  listReviewQuestions: vi.fn(),
  listContentRatings: vi.fn(),
  listSurveys: vi.fn(),
  listSurveyResponses: vi.fn(),
}));

import { computeActivityStatuses } from "@/lib/activity-status";
import {
  getQuizStatus,
  getStudentAnswer,
  listPublishedContent,
  listSurveyResponses,
  listSurveys,
} from "@/lib/nosql";

const survey = (overrides: Partial<Survey> = {}): Survey => ({
  survey_id: "survey-1", class_id: "class", assignment_id: "assignment", title: "Survey",
  daily_experience_topic: "Sports", status: "published", questions: [],
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const response = (status: SurveyResponse["status"]): SurveyResponse => ({
  survey_id: "survey-1", class_id: "class", assignment_id: "assignment", student_id: "s1",
  answers: {}, status, updated_at: "2026-10-02T00:00:00.000Z",
});

const assessmentStatus = async () =>
  (await computeActivityStatuses("class", "assignment", "s1")).assessment;

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQuizStatus).mockResolvedValue({ class_id: "class", assignment_id: "assignment", lesson_number: 1, status: "published", updated_at: "" } as never);
  vi.mocked(getStudentAnswer).mockResolvedValue({ answers: {} } as never);
  vi.mocked(listPublishedContent).mockResolvedValue([]);
  vi.mocked(listSurveys).mockResolvedValue([]);
  vi.mocked(listSurveyResponses).mockResolvedValue([]);
});

describe("assessment status with the task survey (#113)", () => {
  it("is completed after the quiz when the task has no survey", async () => {
    expect(await assessmentStatus()).toBe("completed");
  });

  it("stays available after the quiz until the open survey is submitted", async () => {
    vi.mocked(listSurveys).mockResolvedValue([survey()]);
    expect(await assessmentStatus()).toBe("available");

    vi.mocked(listSurveyResponses).mockResolvedValue([response("draft")]);
    expect(await assessmentStatus()).toBe("available");

    vi.mocked(listSurveyResponses).mockResolvedValue([response("submitted")]);
    expect(await assessmentStatus()).toBe("completed");
  });

  it("checks only this student's response to the task survey", async () => {
    vi.mocked(listSurveys).mockResolvedValue([survey()]);
    await assessmentStatus();
    expect(listSurveyResponses).toHaveBeenCalledWith("class", "assignment", "survey-1", "s1");
  });

  it("is not completed by the survey alone", async () => {
    vi.mocked(getStudentAnswer).mockResolvedValue(null);
    vi.mocked(listSurveys).mockResolvedValue([survey()]);
    vi.mocked(listSurveyResponses).mockResolvedValue([response("submitted")]);
    expect(await assessmentStatus()).toBe("available");
  });

  it("doesn't hold the student up for a draft, not-yet-open or past-due survey", async () => {
    const now = Date.now();
    for (const s of [
      survey({ status: "draft" }),
      survey({ schedule: { publish_at: new Date(now + DAY).toISOString() } }),
      survey({ schedule: { due_at: new Date(now - DAY).toISOString() } }),
    ]) {
      vi.mocked(listSurveys).mockResolvedValue([s]);
      expect(await assessmentStatus()).toBe("completed");
    }
  });

  it("stays available, not locked, if the quiz closes while the survey is still due", async () => {
    vi.mocked(getQuizStatus).mockResolvedValue({ class_id: "class", assignment_id: "assignment", lesson_number: 1, status: "closed", updated_at: "" } as never);
    vi.mocked(listSurveys).mockResolvedValue([survey()]);
    expect(await assessmentStatus()).toBe("available");
  });

  it("is locked before the quiz is published", async () => {
    vi.mocked(getQuizStatus).mockResolvedValue(null);
    vi.mocked(getStudentAnswer).mockResolvedValue(null);
    expect(await assessmentStatus()).toBe("locked");
  });
});
