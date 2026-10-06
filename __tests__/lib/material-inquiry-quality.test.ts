import { describe, expect, it } from "vitest";
import { materialInquiryIssues } from "@/lib/material-inquiry-quality";
import { conflictActivity } from "../fixtures/material-activities";

const withOpening = (text: string) => ({ title: "A ball and a table", activity: { ...conflictActivity, stages: conflictActivity.stages.map((stage, index) => index === 0 ? { ...stage, text } : stage) } });

describe("narrow material generation gate", () => {
  it("catches the actual declarative contact-shape disclosure before a contact-shape prediction", () => {
    const item = withOpening("You see a soft rubber ball sitting on a table. A hand presses down on the top so the ball squashes against the table. Notice the visible shape change where the ball contacts the table.");
    expect(materialInquiryIssues(item, "cognitive conflict")[0]).toContain("states the contact-shape result before the written prediction");
    expect(materialInquiryIssues(item, "experience bridging")).toEqual([]);
  });
  it.each([
    "Does the ball flatten during contact?",
    "Will the ball flatten, stay round, or change in another way?",
    "Predict whether the ball flattens while it touches the table.",
    "If the ball flattens, what outline would you expect?",
    "Before contact the ball is round. After release it is round again.",
    "A hand presses the ball against the table. Imagine inspecting its outline during contact.",
  ])("permits open options, hypotheses and setup: %s", text => {
    expect(materialInquiryIssues(withOpening(text), "cognitive conflict")).toEqual([]);
  });
  it("does not ban an initial flattened state when the question is about recovery", () => {
    const item = withOpening("The ball is flattened under a hand.");
    item.activity.stages[1] = { ...item.activity.stages[1], text: "Predict the ball's shape after the hand is removed." };
    expect(materialInquiryIssues(item, "cognitive conflict")).toEqual([]);
  });
  it("rejects exact duplicate evidence states without pretending to solve semantic comparison", () => {
    const item = { activity: { ...conflictActivity, image: { ...conflictActivity.image, panels: [conflictActivity.image.panels![0], conflictActivity.image.panels![0]] } } };
    expect(materialInquiryIssues(item, "cognitive conflict")).toContainEqual(expect.stringContaining("repeats the same panel description"));
    expect(materialInquiryIssues({ activity: conflictActivity }, "cognitive conflict")).toEqual([]);
  });
});
