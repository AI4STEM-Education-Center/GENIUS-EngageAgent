import { describe, expect, it } from "vitest";
import { activityProgress, type ProgressInputs } from "@/lib/activity-progress";

const none: ProgressInputs = { lessonChosen: false, assessmentPublished: false, strategyChosen: false, materialsSent: false, boardPublished: false, reportsReleased: false };

describe("activity progress (#176)", () => {
  it("starts with nothing done", () => {
    expect(activityProgress(none)).toEqual({ assessment: "not-started", strategy: "not-started", materials: "not-started", discussion: "not-started" });
  });
  it("moves through the four steps in order", () => {
    expect(activityProgress({ ...none, lessonChosen: true })).toMatchObject({ assessment: "in-progress", strategy: "not-started" });
    const published = { ...none, lessonChosen: true, assessmentPublished: true };
    expect(activityProgress(published)).toMatchObject({ assessment: "done", strategy: "in-progress" });
    expect(activityProgress({ ...published, strategyChosen: true, materialsDrafted: true })).toMatchObject({ strategy: "done", materials: "in-progress", discussion: "not-started" });
    const sent = { ...published, strategyChosen: true, materialsSent: true };
    expect(activityProgress(sent)).toMatchObject({ materials: "done", discussion: "in-progress" });
    expect(activityProgress({ ...sent, boardPublished: true }).discussion).toBe("in-progress");
    expect(activityProgress({ ...sent, reportsReleased: true }).discussion).toBe("done");
  });
  it("counts a survey-only assessment as published", () => {
    expect(activityProgress({ ...none, assessmentPublished: true }).assessment).toBe("done");
  });
  it("treats sent materials as a strategy choice when the choice isn't known", () => {
    expect(activityProgress({ ...none, materialsSent: true }).strategy).toBe("done");
  });
});
