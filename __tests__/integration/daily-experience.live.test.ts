import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { analyzeDailyExperiences, DEFAULT_ANALYSIS_MODEL, type ChatClient } from "@/lib/daily-experience-llm";
import { dailyExperienceResponses, dailyExperienceSurvey } from "../fixtures/daily-experience";

// Explicitly opt in: uses real provider credits on the made-up fixture
// responses only (no class or student records). Run with
// RUN_DAILY_EXPERIENCE_LIVE_TESTS=1 and OPENAI_API_KEY set.
const enabled = process.env.RUN_DAILY_EXPERIENCE_LIVE_TESTS === "1";

describe.skipIf(!enabled)("live daily-experience analysis (#114)", () => {
  it("finds soccer then basketball in the fixture class", async () => {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as ChatClient;
    const model = process.env.OPENAI_SURVEY_ANALYSIS_MODEL ?? DEFAULT_ANALYSIS_MODEL;
    const { summary, grouping } = await analyzeDailyExperiences({
      client,
      survey: dailyExperienceSurvey,
      responses: dailyExperienceResponses,
      model,
    });

    console.log(JSON.stringify({ model, grouping, summary }, null, 2));

    expect(summary.top.map((a) => a.activity)).toEqual(["Soccer", "Basketball"]);
    // Hand-labelled reference: Soccer 10 (6 do), Basketball 7 (4 do), 2 unclassified.
    // Allow one student of disagreement on judgement calls.
    expect(summary.top[0].studentCount).toBeGreaterThanOrEqual(9);
    expect(summary.top[0].doCount).toBeGreaterThanOrEqual(5);
    expect(summary.top[1].studentCount).toBeGreaterThanOrEqual(6);
    expect(summary.unclassifiedCount).toBeGreaterThanOrEqual(1);
    expect(summary.unclassifiedCount).toBeLessThanOrEqual(3);
  }, 120_000);
});
