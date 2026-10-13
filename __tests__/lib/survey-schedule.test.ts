import { describe, it, expect } from "vitest";
import {
  resolveSurveyStatus,
  isLateSubmission,
  validateSchedule,
  validateSurveyIsPublishable,
} from "@/lib/survey-schedule";
import type { SurveyItem, SurveySchedule } from "@/lib/types";

const schedule = (
  overrides: Partial<SurveySchedule> = {},
): SurveySchedule => ({
  publish_at: "2026-01-10T09:00:00.000Z",
  due_at: "2026-01-17T09:00:00.000Z",
  allow_late_submissions: false,
  allow_response_editing: false,
  show_immediately: true,
  ...overrides,
});

const question = (overrides: Partial<SurveyItem> = {}): SurveyItem => ({
  item_id: "q1",
  question_number: 1,
  category: "familiarity",
  stem: "What did you notice?",
  response_fields: [
    { field_id: "f1", label: "Your answer", response_type: "text" },
  ],
  ...overrides,
});

describe("resolveSurveyStatus", () => {
  it("is draft when there is no schedule", () => {
    expect(resolveSurveyStatus({ status: "draft", schedule: undefined })).toBe(
      "draft",
    );
  });

  it("is scheduled before the publish time", () => {
    const status = resolveSurveyStatus(
      { status: "draft", schedule: schedule() },
      new Date("2026-01-09T12:00:00.000Z"),
    );
    expect(status).toBe("scheduled");
  });

  it("is published between publish and due", () => {
    const status = resolveSurveyStatus(
      { status: "scheduled", schedule: schedule() },
      new Date("2026-01-12T12:00:00.000Z"),
    );
    expect(status).toBe("published");
  });

  it("is closed after the due time when late submissions are not allowed", () => {
    const status = resolveSurveyStatus(
      { status: "published", schedule: schedule() },
      new Date("2026-01-18T12:00:00.000Z"),
    );
    expect(status).toBe("closed");
  });

  it("stays published after the due time when late submissions are allowed", () => {
    const status = resolveSurveyStatus(
      {
        status: "published",
        schedule: schedule({ allow_late_submissions: true }),
      },
      new Date("2026-01-18T12:00:00.000Z"),
    );
    expect(status).toBe("published");
  });
});

describe("isLateSubmission", () => {
  it("is false before the due time", () => {
    expect(
      isLateSubmission(schedule(), new Date("2026-01-12T00:00:00.000Z")),
    ).toBe(false);
  });

  it("is true after the due time", () => {
    expect(
      isLateSubmission(schedule(), new Date("2026-01-20T00:00:00.000Z")),
    ).toBe(true);
  });

  it("is false with no schedule", () => {
    expect(isLateSubmission(undefined)).toBe(false);
  });
});

describe("validateSchedule", () => {
  it("accepts a valid schedule", () => {
    expect(validateSchedule(schedule())).toEqual([]);
  });

  it("requires a publish date/time", () => {
    expect(validateSchedule(schedule({ publish_at: "" }))).toContain(
      "Publish date and time are required.",
    );
  });

  it("requires a due date/time", () => {
    expect(validateSchedule(schedule({ due_at: "" }))).toContain(
      "Due date and time are required.",
    );
  });

  it("rejects a due time that is not after the publish time", () => {
    const errors = validateSchedule(
      schedule({ due_at: "2026-01-10T09:00:00.000Z" }),
    );
    expect(errors).toContain(
      "Due date and time must be after the publish date and time.",
    );
  });
});

describe("validateSurveyIsPublishable", () => {
  it("accepts a survey with a complete question", () => {
    expect(validateSurveyIsPublishable({ questions: [question()] })).toEqual([]);
  });

  it("rejects a survey with no questions", () => {
    expect(validateSurveyIsPublishable({ questions: [] })).toContain(
      "A survey must contain at least one question before publishing.",
    );
  });

  it("rejects a question with no response fields", () => {
    const errors = validateSurveyIsPublishable({
      questions: [question({ response_fields: [] })],
    });
    expect(errors).toContain("Question 1 needs at least one response field.");
  });

  it("rejects a question with an empty prompt", () => {
    const errors = validateSurveyIsPublishable({
      questions: [question({ stem: "  " })],
    });
    expect(errors).toContain("Question 1 needs a prompt before publishing.");
  });
});
