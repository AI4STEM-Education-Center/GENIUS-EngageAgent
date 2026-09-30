import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/surveys/publish/route";

const baseSurvey = () => ({
  survey_id: "s1",
  class_id: "c1",
  assignment_id: "a1",
  title: "Daily experience check",
  daily_experience_topic: "Collisions",
  status: "draft",
  questions: [
    {
      item_id: "q1",
      question_number: 1,
      category: "familiarity",
      stem: "What did you notice?",
      response_fields: [
        { field_id: "f1", label: "Your answer", response_type: "text" },
      ],
    },
  ],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

vi.mock("@/lib/nosql", () => {
  let surveys: Array<Record<string, unknown>> = [];
  return {
    getSurvey: vi.fn(
      async (classId: string, assignmentId: string, surveyId: string) =>
        surveys.find(
          (s) =>
            s.class_id === classId &&
            s.assignment_id === assignmentId &&
            s.survey_id === surveyId,
        ) ?? null,
    ),
    upsertSurvey: vi.fn(async (survey: Record<string, unknown>) => {
      const idx = surveys.findIndex((s) => s.survey_id === survey.survey_id);
      if (idx >= 0) surveys[idx] = survey;
      else surveys.push(survey);
      return survey;
    }),
    __seed: (rows: Array<Record<string, unknown>>) => {
      surveys = rows;
    },
  };
});

const { __seed } = (await import("@/lib/nosql")) as unknown as {
  __seed: (rows: Array<Record<string, unknown>>) => void;
};

const publish = (payload: Record<string, unknown>) =>
  POST(
    new Request("http://localhost:3000/api/surveys/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  classId: "c1",
  assignmentId: "a1",
  surveyId: "s1",
  publishAt: "2099-01-10T09:00:00.000Z",
  dueAt: "2099-01-17T09:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  __seed([baseSurvey()]);
});

describe("POST /api/surveys/publish", () => {
  it("schedules a survey whose publish date is in the future", async () => {
    const res = await publish(validPayload());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.survey.status).toBe("scheduled");
    expect(data.survey.schedule.publish_at).toBe("2099-01-10T09:00:00.000Z");
    expect(data.survey.published_at).toBeTruthy();
  });

  it("publishes right away with no dates", async () => {
    const res = await publish(validPayload({ publishAt: "", dueAt: "" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.survey.status).toBe("published");
    expect(data.survey.schedule).toEqual({ publish_at: undefined, due_at: undefined });
  });

  it("accepts only a due date", async () => {
    const res = await publish(validPayload({ publishAt: undefined }));
    expect(res.status).toBe(200);
    expect((await res.json()).survey.status).toBe("published");
  });

  it("closes a survey whose due date has passed", async () => {
    const res = await publish(
      validPayload({ publishAt: "2020-01-10T09:00:00.000Z", dueAt: "2020-01-17T09:00:00.000Z" }),
    );
    expect((await res.json()).survey.status).toBe("closed");
  });

  it("rejects a due date that is not after the publish date", async () => {
    const res = await publish(validPayload({ dueAt: "2099-01-10T09:00:00.000Z" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/after the publish date/i);
  });

  it("does not store the removed options (#106)", async () => {
    const res = await publish(validPayload({ allowLateSubmissions: true, allowResponseEditing: true }));
    const { schedule } = (await res.json()).survey;
    expect(Object.keys(schedule).sort()).toEqual(["due_at", "publish_at"]);
  });

  it("requires classId, assignmentId and surveyId", async () => {
    expect((await publish({ surveyId: "s1" })).status).toBe(400);
  });

  it("returns 404 for a survey that does not exist", async () => {
    expect((await publish(validPayload({ surveyId: "nope" }))).status).toBe(404);
  });

  it("refuses to publish a survey with no questions", async () => {
    __seed([{ ...baseSurvey(), questions: [] }]);
    const res = await publish(validPayload());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least one question/i);
  });

  it("keeps the original publish time when the dates are changed", async () => {
    const first = await (await publish(validPayload())).json();
    const res = await publish(validPayload({ dueAt: "2099-02-01T09:00:00.000Z" }));
    const data = await res.json();
    expect(data.survey.schedule.due_at).toBe("2099-02-01T09:00:00.000Z");
    expect(data.survey.published_at).toBe(first.survey.published_at);
  });
});
