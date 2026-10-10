import { describe, expect, it, vi } from "vitest";
import {
  isAnalysisStale,
  parseExtraction,
  parseGrouping,
  updateDailyExperienceAnalysis,
  type ChatClient,
} from "@/lib/daily-experience-llm";
import { normalizeLabel, type SurveyAnalysisRecord } from "@/lib/daily-experience-analysis";
import type { SurveyResponse } from "@/lib/types";
import {
  dailyExperienceResponses,
  dailyExperienceSurvey,
  fakeAnalysisModel,
} from "../fixtures/daily-experience";

const update = (responses: SurveyResponse[], previous: SurveyAnalysisRecord | null = null) => {
  const model = fakeAnalysisModel();
  const run = updateDailyExperienceAnalysis({
    client: model.client as ChatClient,
    survey: dailyExperienceSurvey,
    responses,
    previous,
    now: new Date("2026-10-06T12:00:00.000Z"),
  });
  return { run, calls: model.calls };
};

const extractedStudents = (calls: ReturnType<typeof fakeAnalysisModel>["calls"]) =>
  calls.filter((c) => c.name === "daily_experience_extraction")
    .flatMap((c) => (c.user as { students: unknown[] }).students);

const submitted = dailyExperienceResponses.filter((r) => r.survey_id === dailyExperienceSurvey.survey_id && r.status === "submitted");

describe("updateDailyExperienceAnalysis", () => {
  it("analyzes every submitted response the first time, and ranks the activities", async () => {
    const { run, calls } = update(dailyExperienceResponses);
    const record = await run;

    expect(calls.filter((c) => c.name === "daily_experience_extraction")).toHaveLength(2); // 20 students / 10 per batch
    expect(calls.filter((c) => c.name === "daily_experience_grouping")).toHaveLength(1);
    expect(record.summary.top.map((a) => [a.activity, a.studentCount])).toEqual([["Soccer", 10], ["Basketball", 7]]);
    expect(record.summary.responseCount).toBe(20);
    expect(Object.keys(record.students)).toHaveLength(20);
    expect(record.students["student-01"].response_updated_at).toBe(submitted[0].updated_at);
    expect(record).toMatchObject({ class_id: "class", assignment_id: "assignment", survey_id: "survey-daily", analyzed_at: "2026-10-06T12:00:00.000Z" });
  });

  it("only sends new responses, and only new labels with the activities already in use", async () => {
    const first = await update(submitted.slice(0, 18)).run;
    const { run, calls } = update(dailyExperienceResponses, first);
    const record = await run;

    // Students 19 and 20 are new; both are blank/off-topic.
    expect(extractedStudents(calls)).toHaveLength(2);
    expect(calls.filter((c) => c.name === "daily_experience_grouping")).toHaveLength(0);
    expect(record.summary).toMatchObject({ responseCount: 20, unclassifiedCount: 2 });
    expect(record.summary.top.map((a) => [a.activity, a.studentCount])).toEqual([["Soccer", 10], ["Basketball", 7]]);

    // A brand-new label is grouped alongside the existing activities.
    const withoutMinecraft = await update(submitted.filter((r) => r.student_id !== "student-15")).run;
    const regroup = update(dailyExperienceResponses, withoutMinecraft);
    await regroup.run;
    const grouping = regroup.calls.find((c) => c.name === "daily_experience_grouping")!;
    expect((grouping.user as { labels: string[] }).labels).toEqual(["minecraft"]);
    expect(grouping.system).toContain("- Games / Video games");
  });

  it("re-analyzes a response that changed and drops students without a submitted response", async () => {
    const first = await update(dailyExperienceResponses).run;
    const edited = submitted.map((r) =>
      r.student_id === "student-02" ? { ...r, updated_at: "2026-10-03T00:00:00.000Z" } : r,
    ).filter((r) => r.student_id !== "student-20");
    const { run, calls } = update(edited, first);
    const record = await run;

    expect(extractedStudents(calls)).toHaveLength(1);
    expect(record.students["student-20"]).toBeUndefined();
    expect(record.students["student-02"].response_updated_at).toBe("2026-10-03T00:00:00.000Z");
    expect(record.summary.responseCount).toBe(19);
  });

  it("sends the topic and questions but never student names or ids", async () => {
    const { run, calls } = update(dailyExperienceResponses);
    await run;

    const extraction = calls.find((c) => c.name === "daily_experience_extraction")!;
    expect(extraction.system).toContain(dailyExperienceSurvey.daily_experience_topic);
    expect(extraction.system).toContain("Q4 (familiarity): What is a second activity");
    expect(extraction.temperature).toBe(0);
    for (const c of calls) expect(c.system + JSON.stringify(c.user)).not.toMatch(/student-\d|Student \d/);

    const labels = (calls.find((c) => c.name === "daily_experience_grouping")!.user as { labels: string[] }).labels;
    expect(labels).toEqual([...new Set(labels)]);
    expect(labels.every((l) => l === normalizeLabel(l))).toBe(true);
  });

  it("makes no calls when there are no submitted responses", async () => {
    const { run, calls } = update(dailyExperienceResponses.map((r) => ({ ...r, status: "draft" as const })));
    const record = await run;
    expect(calls).toHaveLength(0);
    expect(record.summary).toMatchObject({ responseCount: 0, enoughResponses: false, top: [] });
  });

  it("throws a clear error when the model returns invalid JSON", async () => {
    const client = { chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content: "not json" } }] })) } } } as ChatClient;
    await expect(updateDailyExperienceAnalysis({ client, survey: dailyExperienceSurvey, responses: dailyExperienceResponses, previous: null }))
      .rejects.toThrow("The extraction step returned invalid JSON.");
  });
});

describe("isAnalysisStale", () => {
  it("is stale with no saved analysis only once someone has submitted", () => {
    expect(isAnalysisStale(dailyExperienceResponses, "survey-daily", null)).toBe(true);
    expect(isAnalysisStale([], "survey-daily", null)).toBe(false);
  });

  it("detects new, changed and removed responses", async () => {
    const record = await update(dailyExperienceResponses).run;
    expect(isAnalysisStale(dailyExperienceResponses, "survey-daily", record)).toBe(false);
    expect(isAnalysisStale(submitted.slice(1), "survey-daily", record)).toBe(true);
    expect(isAnalysisStale(submitted.map((r, i) => (i === 0 ? { ...r, updated_at: "2026-10-09T00:00:00.000Z" } : r)), "survey-daily", record)).toBe(true);
    expect(isAnalysisStale([...dailyExperienceResponses, { ...submitted[0], student_id: "student-99" }], "survey-daily", record)).toBe(true);
  });
});

describe("parseExtraction", () => {
  it("fills skipped students, ignores unknown or duplicate ids, and cleans fields", () => {
    const raw = { students: [
      { student: "S1", activities: [
        { label: "Soccer", involvement: "watched", objects: ["ball", 3], incident: "" },
        { label: "", involvement: "do", objects: [], incident: "" },
        { label: "chess", involvement: "something", objects: [], incident: "Lost a piece" },
        { label: "tennis", involvement: "do", objects: [], incident: "" },
      ] },
      { student: "S1", activities: [{ label: "duplicate", involvement: "do", objects: [], incident: "" }] },
      { student: "S99", activities: [{ label: "intruder", involvement: "do", objects: [], incident: "" }] },
    ] };

    expect(parseExtraction(raw, ["S1", "S2"])).toEqual([
      { student: "S1", activities: [
        { label: "Soccer", involvement: "watched", objects: ["ball"], incident: undefined },
        { label: "chess", involvement: "do", objects: [], incident: "Lost a piece" },
      ] },
      { student: "S2", activities: [] },
    ]);
  });
});

describe("parseGrouping", () => {
  it("normalizes labels and drops incomplete rows", () => {
    expect(parseGrouping({ groups: [
      { label: "Soccer!", category: "Sports", activity: "Soccer" },
      { label: "chess", category: "", activity: "Chess" },
    ] })).toEqual({ soccer: { category: "Sports", activity: "Soccer" } });
  });
});
