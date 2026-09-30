import { describe, it, expect } from "vitest";
import {
  pickTaskSurvey,
  resolveSurveyStatus,
  validateSchedule,
  validateSurveyIsPublishable,
} from "@/lib/survey-schedule";
import type { SurveyItem } from "@/lib/types";

const PUBLISH = "2026-01-10T09:00:00.000Z";
const DUE = "2026-01-17T09:00:00.000Z";
const at = (iso: string) => new Date(iso);

const question = (overrides: Partial<SurveyItem> = {}): SurveyItem => ({
  item_id: "q1",
  question_number: 1,
  category: "familiarity",
  stem: "What did you notice?",
  response_fields: [{ field_id: "f1", label: "Your answer", response_type: "text" }],
  ...overrides,
});

describe("resolveSurveyStatus", () => {
  it("is draft until published", () => {
    expect(resolveSurveyStatus({ status: "draft", schedule: { publish_at: PUBLISH } })).toBe("draft");
  });

  it("is published right away when there are no dates", () => {
    expect(resolveSurveyStatus({ status: "published", schedule: {} })).toBe("published");
    expect(resolveSurveyStatus({ status: "published", schedule: undefined })).toBe("published");
  });

  it("is scheduled before the publish date", () => {
    expect(
      resolveSurveyStatus({ status: "published", schedule: { publish_at: PUBLISH } }, at("2026-01-09T00:00:00Z")),
    ).toBe("scheduled");
  });

  it("is published between the publish and due dates", () => {
    expect(
      resolveSurveyStatus({ status: "published", schedule: { publish_at: PUBLISH, due_at: DUE } }, at("2026-01-12T00:00:00Z")),
    ).toBe("published");
  });

  it("is closed after the due date", () => {
    expect(
      resolveSurveyStatus({ status: "published", schedule: { due_at: DUE } }, at("2026-01-18T00:00:00Z")),
    ).toBe("closed");
  });

  it("stays open with no due date", () => {
    expect(
      resolveSurveyStatus({ status: "published", schedule: { publish_at: PUBLISH } }, at("2030-01-01T00:00:00Z")),
    ).toBe("published");
  });
});

describe("validateSchedule", () => {
  it("accepts no dates at all", () => {
    expect(validateSchedule({})).toEqual([]);
    expect(validateSchedule(undefined)).toEqual([]);
  });

  it("accepts just one date", () => {
    expect(validateSchedule({ publish_at: PUBLISH })).toEqual([]);
    expect(validateSchedule({ due_at: DUE })).toEqual([]);
  });

  it("rejects a due date that is not after the publish date", () => {
    expect(validateSchedule({ publish_at: DUE, due_at: PUBLISH })).toContain(
      "Due date and time must be after the publish date and time.",
    );
  });

  it("rejects an invalid date", () => {
    expect(validateSchedule({ due_at: "not a date" })).toContain("Due date and time are invalid.");
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

  it("rejects a question with no prompt or no response field", () => {
    const errors = validateSurveyIsPublishable({ questions: [question({ stem: " ", response_fields: [] })] });
    expect(errors).toContain("Question 1 needs a prompt before publishing.");
    expect(errors).toContain("Question 1 needs at least one response field.");
  });
});

describe("pickTaskSurvey", () => {
  it("returns null when there is no survey", () => {
    expect(pickTaskSurvey([])).toBeNull();
  });

  it("uses the most recently updated survey", () => {
    const picked = pickTaskSurvey([
      { id: "old", updated_at: "2026-01-01T00:00:00Z" },
      { id: "new", updated_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(picked?.id).toBe("new");
  });
});
