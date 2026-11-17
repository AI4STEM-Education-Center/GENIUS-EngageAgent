import { expect, it } from "vitest";
import { resolveExperienceSelection } from "@/lib/material-experiences";

const current = [{ activityId: "genius:soccer", activity: "Football / soccer", category: "Sports", studentCount: 6, doCount: 4, watchedCount: 2, objects: [], incidents: [] }];
it("restores a renamed experience using its stable ID after the new context is accepted", () => {
  expect(resolveExperienceSelection("Soccer", "reported", "genius:soccer", current)).toMatchObject({ value: "Football / soccer", missing: false, reported: { studentCount: 6 } });
});
it("retains an old label without silently assigning another activity and allows an explicit personal example", () => {
  expect(resolveExperienceSelection("Soccer", "reported", "genius:deleted", current)).toEqual({ value: "Soccer", reported: undefined, missing: true });
  expect(resolveExperienceSelection("Soccer", "teacher_entered", undefined, current)).toEqual({ value: "Soccer", reported: undefined, missing: false });
  expect(resolveExperienceSelection("Football / soccer", "ai_suggested", undefined, current).reported).toBeUndefined();
});
