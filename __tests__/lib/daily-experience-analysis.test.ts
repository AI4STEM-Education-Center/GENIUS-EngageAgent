import { describe, expect, it } from "vitest";
import {
  aggregateDailyExperiences,
  anonymizeResponses,
  normalizeLabel,
  type StudentExtraction,
} from "@/lib/daily-experience-analysis";
import {
  dailyExperienceResponses,
  dailyExperienceSurvey,
  expectedExtractions,
  expectedGrouping,
} from "../fixtures/daily-experience";

describe("anonymizeResponses", () => {
  it("keeps only submitted responses to the survey and replaces identities", () => {
    const { anonymized, idMap } = anonymizeResponses(dailyExperienceResponses, dailyExperienceSurvey.survey_id);

    expect(anonymized).toHaveLength(20);
    expect(anonymized[0].student).toBe("S1");
    expect(idMap.S1).toBe("student-01");
    expect(idMap.S20).toBe("student-20");
    expect(Object.values(idMap)).not.toContain("student-21"); // draft
    expect(Object.values(idMap)).not.toContain("student-22"); // other survey
    expect(JSON.stringify(anonymized)).not.toMatch(/student-\d|Student \d/);
  });
});

describe("normalizeLabel", () => {
  it("ignores case, punctuation and extra spaces", () => {
    expect(normalizeLabel("  Soccer! ")).toBe("soccer");
    expect(normalizeLabel("Video   Games")).toBe("video games");
    expect(normalizeLabel("Fútbol")).toBe("fútbol");
  });
});

describe("aggregateDailyExperiences", () => {
  const summary = aggregateDailyExperiences(expectedExtractions, expectedGrouping);

  it("finds the most and second-most common activities", () => {
    expect(summary.top.map((a) => a.activity)).toEqual(["Soccer", "Basketball"]);
    expect(summary.top[0]).toMatchObject({ category: "Sports", studentCount: 10, doCount: 6, watchedCount: 4 });
    expect(summary.top[1]).toMatchObject({ category: "Sports", studentCount: 7, doCount: 4, watchedCount: 3 });
  });

  it("ranks by students, then by 'do' count, then alphabetically", () => {
    expect(summary.activities.map((a) => [a.activity, a.studentCount, a.doCount])).toEqual([
      ["Soccer", 10, 6],
      ["Basketball", 7, 4],
      ["Cooking", 3, 3],
      ["Video games", 3, 3],
      ["Skateboarding", 3, 2],
      ["Swimming", 2, 2],
    ]);
  });

  it("counts a student who both does and watched an activity once, as 'do'", () => {
    // S4 plays soccer ("socer") and also watches it.
    const only = aggregateDailyExperiences([expectedExtractions[3]], expectedGrouping);
    expect(only.activities[0]).toMatchObject({ activity: "Soccer", studentCount: 1, doCount: 1, watchedCount: 0 });
  });

  it("counts unclassified students and the total response count", () => {
    expect(summary.unclassifiedCount).toBe(2);
    expect(summary.responseCount).toBe(20);
    expect(summary.enoughResponses).toBe(true);
  });

  it("ranks objects by distinct students and keeps the top five", () => {
    expect(summary.top[0].objects).toEqual([
      { name: "ball", count: 6 },
      { name: "goal", count: 2 },
      { name: "cleats", count: 1 },
      { name: "cones", count: 1 },
      { name: "gloves", count: 1 },
    ]);
  });

  it("keeps up to three example incidents", () => {
    expect(summary.top[0].incidents).toHaveLength(3);
    expect(summary.top[0].incidents[0]).toMatch(/shin guard/i);
  });

  it("keeps labels the grouping step missed, as Uncategorized", () => {
    const extractions: StudentExtraction[] = [
      { student: "S1", activities: [{ label: "Chess", involvement: "do", objects: [] }] },
    ];
    const result = aggregateDailyExperiences(extractions, {});
    expect(result.activities[0]).toMatchObject({ category: "Uncategorized", activity: "Chess" });
  });

  it("returns no top activities when there are fewer than 3 responses", () => {
    const result = aggregateDailyExperiences(expectedExtractions.slice(0, 2), expectedGrouping);
    expect(result.enoughResponses).toBe(false);
    expect(result.top).toEqual([]);
    expect(result.activities.length).toBeGreaterThan(0);
  });
});
