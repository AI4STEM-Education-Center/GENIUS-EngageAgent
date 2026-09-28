import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/survey-responses/route";

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";
const PAST_DUE = "2020-02-01T00:00:00.000Z";

const makeSurvey = (schedule: Record<string, unknown> | undefined) => ({
  survey_id: "s1",
  class_id: "c1",
  assignment_id: "a1",
  title: "Daily experience",
  daily_experience_topic: "Collisions",
  status: "published",
  questions: [
    {
      item_id: "q1", question_number: 1, category: "familiarity", stem: "Q one",
      response_fields: [{ field_id: "f1", label: "Answer", response_type: "text" }],
    },
    {
      item_id: "q2", question_number: 2, category: "unspecified", stem: "Q two",
      response_fields: [{ field_id: "f2", label: "Answer", response_type: "text", text_length: "long" }],
    },
  ],
  schedule,
  created_at: PAST,
  updated_at: PAST,
});

const openSchedule = (over: Record<string, unknown> = {}) => ({
  publish_at: PAST, due_at: FUTURE,
  allow_late_submissions: false, allow_response_editing: false, show_immediately: true,
  ...over,
});

vi.mock("@/lib/nosql", () => {
  let survey: Record<string, unknown> | null = null;
  let responses: Array<Record<string, unknown>> = [];
  return {
    getSurvey: vi.fn(async () => survey),
    listSurveyResponses: vi.fn(async (c: string, a: string, s?: string, st?: string) =>
      responses.filter((r) => r.class_id === c && r.assignment_id === a && (!s || r.survey_id === s) && (!st || r.student_id === st))),
    upsertSurveyResponse: vi.fn(async (r: Record<string, unknown>) => {
      const i = responses.findIndex((x) => x.survey_id === r.survey_id && x.student_id === r.student_id);
      if (i >= 0) responses[i] = r; else responses.push(r);
      return r;
    }),
    __set: (s: Record<string, unknown> | null) => { survey = s; responses = []; },
  };
});
const { __set } = (await import("@/lib/nosql")) as unknown as { __set: (s: unknown) => void };

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://x/api/survey-responses", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
const base = { classId: "c1", assignmentId: "a1", surveyId: "s1", studentId: "st1", studentName: "Ana" };
const full = { f1: "a bike", f2: "I fell off" };

beforeEach(() => __set(makeSurvey(openSchedule())));

describe("POST /api/survey-responses", () => {
  it("saves a partial draft", async () => {
    const res = await post({ ...base, answers: { f1: "a bike" }, action: "save" });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.response.status).toBe("draft");
    expect(d.response.answers).toEqual({ f1: "a bike" });
  });

  it("drops answers for fields that are not on the survey", async () => {
    const d = await (await post({ ...base, answers: { f1: "x", hacked: "y" } })).json();
    expect(d.response.answers).toEqual({ f1: "x" });
  });

  it("blocks submitting with a missing answer and lists it", async () => {
    const res = await post({ ...base, answers: { f1: "only one" }, action: "submit" });
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.missing.map((m: { fieldId: string }) => m.fieldId)).toEqual(["f2"]);
  });

  it("submits when every question is answered", async () => {
    const d = await (await post({ ...base, answers: full, action: "submit" })).json();
    expect(d.response.status).toBe("submitted");
    expect(d.response.is_late).toBe(false);
    expect(d.response.submitted_at).toBeTruthy();
  });

  it("refuses changes after submitting when editing is not allowed", async () => {
    await post({ ...base, answers: full, action: "submit" });
    const res = await post({ ...base, answers: full, action: "submit" });
    expect(res.status).toBe(409);
  });

  it("allows resubmitting when editing after submit is allowed", async () => {
    __set(makeSurvey(openSchedule({ allow_response_editing: true })));
    await post({ ...base, answers: full, action: "submit" });
    const res = await post({ ...base, answers: { ...full, f1: "changed" }, action: "submit" });
    expect(res.status).toBe(200);
    expect((await res.json()).response.answers.f1).toBe("changed");
  });

  it("refuses a survey that is not open yet", async () => {
    __set(makeSurvey(openSchedule({ publish_at: FUTURE, due_at: "2099-02-01T00:00:00.000Z" })));
    const res = await post({ ...base, answers: full, action: "submit" });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("scheduled");
  });

  it("refuses a closed survey when late submissions are not allowed", async () => {
    __set(makeSurvey(openSchedule({ due_at: PAST_DUE })));
    const res = await post({ ...base, answers: full, action: "submit" });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("closed");
  });

  it("accepts a late submission and marks it late", async () => {
    __set(makeSurvey(openSchedule({ due_at: PAST_DUE, allow_late_submissions: true })));
    const d = await (await post({ ...base, answers: full, action: "submit" })).json();
    expect(d.response.status).toBe("submitted");
    expect(d.response.is_late).toBe(true);
  });

  it("refuses an unpublished draft survey", async () => {
    __set(makeSurvey(undefined));
    const res = await post({ ...base, answers: full, action: "submit" });
    expect(res.status).toBe(403);
  });

  it("returns 404 for a missing survey", async () => {
    __set(null);
    expect((await post({ ...base, answers: full })).status).toBe(404);
  });

  it("requires ids", async () => {
    expect((await post({ answers: full })).status).toBe(400);
  });
});

describe("GET /api/survey-responses", () => {
  it("lists a student's responses", async () => {
    await post({ ...base, answers: { f1: "x" } });
    const res = await GET(new Request("http://x/api/survey-responses?classId=c1&assignmentId=a1&studentId=st1"));
    const d = await res.json();
    expect(d.responses).toHaveLength(1);
  });

  it("requires classId and assignmentId", async () => {
    expect((await GET(new Request("http://x/api/survey-responses?classId=c1"))).status).toBe(400);
  });
});
