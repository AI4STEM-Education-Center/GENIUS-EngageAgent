import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyAnalysisRecord } from "@/lib/daily-experience-analysis";
import type { ChatClient } from "@/lib/daily-experience-llm";

vi.mock("@/lib/nosql", () => ({
  listSurveys: vi.fn(),
  listSurveyResponses: vi.fn(),
  getSurveyAnalysis: vi.fn(),
  upsertSurveyAnalysis: vi.fn(async (record: unknown) => record),
}));

import { getTaskInterests } from "@/lib/task-interests";
import { getSurveyAnalysis, listSurveyResponses, listSurveys, upsertSurveyAnalysis } from "@/lib/nosql";
import { dailyExperienceResponses, dailyExperienceSurvey, fakeAnalysisModel } from "../fixtures/daily-experience";

let model: ReturnType<typeof fakeAnalysisModel>;
const client = () => model.client as ChatClient;
const interests = (options: { client?: ChatClient | null } = { client: client() }) =>
  getTaskInterests("class", "assignment", options);

/** Runs a full analysis once and returns what would have been saved. */
const savedRecord = async (): Promise<SurveyAnalysisRecord> => {
  await interests();
  return vi.mocked(upsertSurveyAnalysis).mock.calls.at(-1)![0];
};

beforeEach(() => {
  vi.clearAllMocks();
  model = fakeAnalysisModel();
  vi.mocked(listSurveys).mockResolvedValue([dailyExperienceSurvey]);
  vi.mocked(listSurveyResponses).mockResolvedValue(dailyExperienceResponses);
  vi.mocked(getSurveyAnalysis).mockResolvedValue(null);
});

describe("getTaskInterests", () => {
  it("returns null when the task has no survey, or nobody has submitted", async () => {
    vi.mocked(listSurveys).mockResolvedValue([]);
    expect(await interests()).toBeNull();

    vi.mocked(listSurveys).mockResolvedValue([dailyExperienceSurvey]);
    vi.mocked(listSurveyResponses).mockResolvedValue([]);
    expect(await interests()).toBeNull();
    expect(model.calls).toHaveLength(0);
  });

  it("analyzes automatically on first read, saves it, and returns the documented shape", async () => {
    const result = await interests();

    expect(upsertSurveyAnalysis).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      classId: "class", assignmentId: "assignment", surveyId: "survey-daily",
      dailyExperienceTopic: dailyExperienceSurvey.daily_experience_topic,
      responseCount: 20, unclassifiedCount: 2, enoughResponses: true, stale: false,
    });
    expect(result!.top[0]).toEqual({
      activity: "Soccer", category: "Sports", studentCount: 10, doCount: 6, watchedCount: 4,
      objects: ["ball", "goal", "cleats", "cones", "gloves"],
      incidents: expect.arrayContaining([expect.stringMatching(/shin guard/i)]),
    });
    expect(result!.activities.map((a) => a.activity)).toEqual(["Soccer", "Basketball", "Cooking", "Video games", "Skateboarding", "Swimming"]);
    expect(JSON.stringify(result)).not.toMatch(/student-\d|"students"/);
  });

  it("returns the saved analysis without calling the model when nothing changed", async () => {
    const record = await savedRecord();
    vi.clearAllMocks();
    model = fakeAnalysisModel();
    vi.mocked(getSurveyAnalysis).mockResolvedValue(record);

    const result = await interests();
    expect(model.calls).toHaveLength(0);
    expect(upsertSurveyAnalysis).not.toHaveBeenCalled();
    expect(result!.top[0].activity).toBe("Soccer");
  });

  it("re-analyzes from scratch when the survey's topic changed", async () => {
    const record = await savedRecord();
    model = fakeAnalysisModel();
    vi.mocked(getSurveyAnalysis).mockResolvedValue(record);
    vi.mocked(listSurveys).mockResolvedValue([{ ...dailyExperienceSurvey, daily_experience_topic: "Chores at home" }]);

    const result = await interests();
    expect(model.calls.filter((c) => c.name === "daily_experience_extraction")).toHaveLength(2);
    expect(result!.dailyExperienceTopic).toBe("Chores at home");
  });

  it("returns the last saved result marked stale when the update fails", async () => {
    const record = await savedRecord();
    vi.mocked(getSurveyAnalysis).mockResolvedValue(record);
    vi.mocked(listSurveyResponses).mockResolvedValue([
      ...dailyExperienceResponses,
      { ...dailyExperienceResponses[0], student_id: "student-99" },
    ]);
    const failing = { chat: { completions: { create: vi.fn(async () => { throw new Error("upstream timeout"); }) } } } as ChatClient;

    const result = await interests({ client: failing });
    expect(result).toMatchObject({ stale: true, responseCount: 20 });
    expect(result!.top[0].activity).toBe("Soccer");
  });

  it("throws when the first analysis fails, including without an API key", async () => {
    await expect(interests({ client: null })).rejects.toThrow("OPENAI_API_KEY is not set.");
    expect(upsertSurveyAnalysis).not.toHaveBeenCalled();
  });

  it("shares one update between simultaneous reads of the same task", async () => {
    const [a, b] = await Promise.all([interests(), interests()]);
    expect(a).toEqual(b);
    expect(model.calls.filter((c) => c.name === "daily_experience_grouping")).toHaveLength(1);
    expect(upsertSurveyAnalysis).toHaveBeenCalledTimes(1);
  });
});
