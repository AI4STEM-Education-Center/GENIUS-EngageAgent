import { describe, expect, it, vi } from "vitest";
import {
  analyzeDailyExperiences,
  parseExtraction,
  parseGrouping,
  type ChatClient,
} from "@/lib/daily-experience-llm";
import { normalizeLabel } from "@/lib/daily-experience-analysis";
import type { SurveyResponse } from "@/lib/types";
import {
  dailyExperienceResponses,
  dailyExperienceSurvey,
  expectedExtractions,
  expectedGrouping,
} from "../fixtures/daily-experience";

type CreateParams = Parameters<ChatClient["chat"]["completions"]["create"]>[0];

/** Answers like a well-behaved model, using the fixture's expected output. */
const fakeClient = (overrides: { extraction?: (students: string[]) => unknown; grouping?: unknown } = {}) => {
  const create = vi.fn(async (params: CreateParams) => {
    const input = JSON.parse(params.messages[1].content);
    if (params.response_format.json_schema.name === "daily_experience_extraction") {
      const students: string[] = input.students.map((s: { student: string }) => s.student);
      const body = overrides.extraction?.(students) ??
        { students: expectedExtractions.filter((e) => students.includes(e.student)).map((e) => ({
          student: e.student,
          activities: e.activities.map((a) => ({ ...a, incident: a.incident ?? "" })),
        })) };
      return { choices: [{ message: { content: JSON.stringify(body) } }] };
    }
    const body = overrides.grouping ??
      { groups: (input.labels as string[]).map((label) => ({ label, ...expectedGrouping[label] })) };
    return { choices: [{ message: { content: JSON.stringify(body) } }] };
  });
  return { client: { chat: { completions: { create } } } as ChatClient, create };
};

const callsFor = (create: ReturnType<typeof fakeClient>["create"], name: string) =>
  create.mock.calls.map(([p]) => p).filter((p) => p.response_format.json_schema.name === name);

describe("analyzeDailyExperiences", () => {
  it("runs extraction in batches, groups once, and ranks the class's activities", async () => {
    const { client, create } = fakeClient();
    const result = await analyzeDailyExperiences({ client, survey: dailyExperienceSurvey, responses: dailyExperienceResponses });

    expect(callsFor(create, "daily_experience_extraction")).toHaveLength(2); // 20 students / 10 per batch
    expect(callsFor(create, "daily_experience_grouping")).toHaveLength(1);
    expect(result.summary.top.map((a) => [a.activity, a.studentCount])).toEqual([["Soccer", 10], ["Basketball", 7]]);
    expect(result.summary.responseCount).toBe(20);
    expect(result.idMap.S1).toBe("student-01");
  });

  it("sends the topic and questions but never student names or ids", async () => {
    const { client, create } = fakeClient();
    await analyzeDailyExperiences({ client, survey: dailyExperienceSurvey, responses: dailyExperienceResponses });

    const [extraction] = callsFor(create, "daily_experience_extraction");
    expect(extraction.messages[0].content).toContain(dailyExperienceSurvey.daily_experience_topic);
    expect(extraction.messages[0].content).toContain("Q4 (familiarity): What is a second activity");
    expect(extraction.temperature).toBe(0);
    for (const call of create.mock.calls) {
      const sent = call[0].messages.map((m) => m.content).join("\n");
      expect(sent).not.toMatch(/student-\d|Student \d/);
    }
  });

  it("sends grouping only the unique normalized labels", async () => {
    const { client, create } = fakeClient();
    await analyzeDailyExperiences({ client, survey: dailyExperienceSurvey, responses: dailyExperienceResponses });

    const [grouping] = callsFor(create, "daily_experience_grouping");
    const labels = JSON.parse(grouping.messages[1].content).labels;
    expect(labels).toEqual([...new Set(labels)]);
    expect(labels).toEqual(expect.arrayContaining(["soccer", "socer", "futbol", "bball", "minecraft"]));
    expect(labels.every((l: string) => l === normalizeLabel(l))).toBe(true);
  });

  it("makes no calls when there are no submitted responses", async () => {
    const { client, create } = fakeClient();
    const drafts: SurveyResponse[] = dailyExperienceResponses.map((r) => ({ ...r, status: "draft" }));
    const result = await analyzeDailyExperiences({ client, survey: dailyExperienceSurvey, responses: drafts });

    expect(create).not.toHaveBeenCalled();
    expect(result.summary).toMatchObject({ responseCount: 0, enoughResponses: false, top: [] });
  });

  it("skips grouping when every answer is unclassified", async () => {
    const { client, create } = fakeClient({ extraction: (students) => ({ students: students.map((student) => ({ student, activities: [] })) }) });
    const result = await analyzeDailyExperiences({ client, survey: dailyExperienceSurvey, responses: dailyExperienceResponses });

    expect(callsFor(create, "daily_experience_grouping")).toHaveLength(0);
    expect(result.summary.unclassifiedCount).toBe(20);
  });

  it("throws a clear error when the model returns invalid JSON", async () => {
    const client = { chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content: "not json" } }] })) } } } as ChatClient;
    await expect(analyzeDailyExperiences({ client, survey: dailyExperienceSurvey, responses: dailyExperienceResponses }))
      .rejects.toThrow("The extraction step returned invalid JSON.");
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
