import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dailyExperienceResponses,
  dailyExperienceSurvey,
  expectedExtractions,
  expectedGrouping,
} from "../fixtures/daily-experience";

const create = vi.fn();
vi.mock("openai", () => ({ default: class { chat = { completions: { create } }; } }));
vi.mock("@/lib/workspace-access", () => ({ guardWorkspaceRequest: vi.fn(async () => null) }));
vi.mock("@/lib/nosql", () => ({
  getSurvey: vi.fn(),
  getSurveyAnalysis: vi.fn(),
  listSurveyResponses: vi.fn(),
  upsertSurveyAnalysis: vi.fn(async (record: unknown) => record),
}));

import { GET, POST } from "@/app/api/survey-analysis/route";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { getSurvey, getSurveyAnalysis, listSurveyResponses, upsertSurveyAnalysis } from "@/lib/nosql";

const ids = { classId: "class", assignmentId: "assignment", surveyId: dailyExperienceSurvey.survey_id };
const get = (params: Record<string, string>) =>
  GET(new Request(`http://localhost/api/survey-analysis?${new URLSearchParams(params)}`));
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/survey-analysis", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

/** Answers like the fixture's ideal model output. */
const wellBehavedModel = async (params: { response_format: { json_schema: { name: string } }; messages: { content: string }[] }) => {
  const input = JSON.parse(params.messages[1].content);
  const body = params.response_format.json_schema.name === "daily_experience_extraction"
    ? { students: expectedExtractions
        .filter((e) => input.students.some((s: { student: string }) => s.student === e.student))
        .map((e) => ({ ...e, activities: e.activities.map((a) => ({ ...a, incident: a.incident ?? "" })) })) }
    : { groups: (input.labels as string[]).map((label) => ({ label, ...expectedGrouping[label] })) };
  return { choices: [{ message: { content: JSON.stringify(body) } }] };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.mocked(guardWorkspaceRequest).mockResolvedValue(null);
  vi.mocked(getSurvey).mockResolvedValue(dailyExperienceSurvey);
  vi.mocked(listSurveyResponses).mockResolvedValue(dailyExperienceResponses);
  vi.mocked(getSurveyAnalysis).mockResolvedValue(null);
  create.mockImplementation(wellBehavedModel);
});

describe("GET /api/survey-analysis", () => {
  it("requires class, assignment and survey ids", async () => {
    expect((await get({ classId: "class", assignmentId: "assignment" })).status).toBe(400);
  });

  it("returns null before any analysis, with the current submitted count", async () => {
    const res = await get(ids);
    expect(await res.json()).toEqual({ analysis: null, submittedCount: 20 });
  });

  it("returns the saved summary without per-student data", async () => {
    vi.mocked(getSurveyAnalysis).mockResolvedValue({
      class_id: "class", assignment_id: "assignment", survey_id: ids.surveyId,
      daily_experience_topic: "topic", model: "gpt-4o-mini", analyzed_at: "2026-10-06T00:00:00.000Z",
      summary: { responseCount: 20, unclassifiedCount: 2, enoughResponses: true, activities: [], top: [] },
      extractions: expectedExtractions, grouping: expectedGrouping, id_map: { S1: "student-01" },
    });
    const body = await (await get(ids)).json();

    expect(body.analysis).toMatchObject({ surveyId: ids.surveyId, analyzedAt: "2026-10-06T00:00:00.000Z" });
    expect(JSON.stringify(body)).not.toMatch(/student-01|id_map|extractions/);
  });
});

describe("POST /api/survey-analysis", () => {
  it("runs the analysis, saves it, and returns the ranking without per-student data", async () => {
    const res = await post(ids);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysis.summary.top.map((a: { activity: string }) => a.activity)).toEqual(["Soccer", "Basketball"]);
    expect(JSON.stringify(body)).not.toMatch(/student-\d|id_map|extractions/);

    const saved = vi.mocked(upsertSurveyAnalysis).mock.calls[0][0];
    expect(saved).toMatchObject({ class_id: "class", survey_id: ids.surveyId, model: "gpt-4o-mini" });
    expect(saved.id_map.S1).toBe("student-01");
    expect(saved.extractions).toHaveLength(20);
  });

  it("keeps the previous analysis when the model call fails", async () => {
    create.mockRejectedValue(new Error("upstream timeout"));
    const res = await post(ids);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The analysis could not be completed. Please try again." });
    expect(upsertSurveyAnalysis).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown survey and 500 without an API key", async () => {
    vi.mocked(getSurvey).mockResolvedValueOnce(null);
    expect((await post(ids)).status).toBe(404);

    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await post(ids)).status).toBe(500);
    expect(create).not.toHaveBeenCalled();
  });

  it("stops at the workspace guard (e.g. a student in a live class)", async () => {
    vi.mocked(guardWorkspaceRequest).mockResolvedValue(
      NextResponse.json({ error: "Teacher access required." }, { status: 403 }),
    );
    const res = await post(ids);

    expect(res.status).toBe(403);
    expect(getSurvey).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
