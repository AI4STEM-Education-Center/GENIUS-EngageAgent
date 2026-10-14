import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import type { SurveyAnalysisRecord } from "@/lib/daily-experience-analysis";
import { DEFAULT_ANALYSIS_MODEL, updateDailyExperienceAnalysis, type ChatClient } from "@/lib/daily-experience-llm";
import { dailyExperienceResponses, dailyExperienceSurvey } from "../fixtures/daily-experience";

// Explicitly opt in: uses real provider credits on the made-up fixture
// responses only (no class or student records). Run with
// RUN_DAILY_EXPERIENCE_LIVE_TESTS=1 and OPENAI_API_KEY set.
const enabled = process.env.RUN_DAILY_EXPERIENCE_LIVE_TESTS === "1";

const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as ChatClient;
const model = process.env.OPENAI_SURVEY_ANALYSIS_MODEL ?? DEFAULT_ANALYSIS_MODEL;
const submitted = dailyExperienceResponses.filter((r) => r.status === "submitted" && r.survey_id === dailyExperienceSurvey.survey_id);

// Hand-labelled reference: Soccer 10 (6 do), Basketball 7 (4 do), Cooking 3,
// 2 unclassified. Allow one student of disagreement on judgement calls.
const expectReferenceRanking = (record: SurveyAnalysisRecord) => {
  const { summary } = record;
  expect(Object.keys(record.students)).toHaveLength(20); // nobody skipped
  expect(summary.top.map((a) => a.activity)).toEqual(["Soccer", "Basketball"]);
  expect(summary.top[0].studentCount).toBeGreaterThanOrEqual(9);
  expect(summary.top[0].doCount).toBeGreaterThanOrEqual(5);
  expect(summary.top[1].studentCount).toBeGreaterThanOrEqual(6);
  expect(summary.activities.find((a) => a.activity === "Cooking")?.studentCount).toBeGreaterThanOrEqual(2);
  expect(summary.unclassifiedCount).toBeGreaterThanOrEqual(1);
  expect(summary.unclassifiedCount).toBeLessThanOrEqual(3);
};

describe.skipIf(!enabled)("live daily-experience analysis (#114)", () => {
  it("finds soccer then basketball in the fixture class", async () => {
    const record = await updateDailyExperienceAnalysis({
      client: client(),
      survey: dailyExperienceSurvey,
      responses: dailyExperienceResponses,
      previous: null,
      model,
    });

    console.log(JSON.stringify({ model, grouping: record.grouping, summary: record.summary }, null, 2));
    expectReferenceRanking(record);
  }, 120_000);

  it("gets the same ranking when responses arrive a few at a time, in a different order", async () => {
    // Last-to-first, three at a time, so labels arrive in a different order.
    const order = [...submitted].reverse();
    let record: SurveyAnalysisRecord | null = null;
    for (let n = 3; n < order.length + 3; n += 3) {
      record = await updateDailyExperienceAnalysis({
        client: client(),
        survey: dailyExperienceSurvey,
        responses: order.slice(0, n),
        previous: record,
        model,
      });
    }

    console.log(JSON.stringify({ model, grouping: record!.grouping, activities: record!.summary.activities.map((a) => [a.activity, a.studentCount]) }));
    expectReferenceRanking(record!);
  }, 300_000);
});
