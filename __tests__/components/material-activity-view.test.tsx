// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import MaterialActivityView from "@/app/components/MaterialActivityView";
import { parseMaterialActivity } from "@/lib/material-activities";
import { analogyActivity, conflictActivity, bridgingActivity } from "../fixtures/material-activities";

afterEach(cleanup);
describe("student-facing inquiry text and image", () => {
  it("requires a written prediction before revealing the discrepant result and preserves it for comparison", () => {
    render(<MaterialActivityView activity={conflictActivity} media={{ image: "https://example.org/result.webp" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Look at the contact")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "It stays round." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("img")).toBeDefined();
    expect((screen.getByLabelText("Your prediction") as HTMLTextAreaElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(within(screen.getByRole("region", { name: "Compare your ideas" })).getByText("It stays round.")).toBeDefined();
  });
  it("withholds the result video until the prediction is recorded, then displays that prediction before the outcome", () => {
    render(<MaterialActivityView activity={conflictActivity} media={{ video: "https://example.org/result.mp4" }} />);
    expect(screen.queryByLabelText("Activity video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByLabelText("Activity video")).toBeNull();
    fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "The ball stays round." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Activity video").getAttribute("src")).toBe("https://example.org/result.mp4");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const compare = within(screen.getByRole("region", { name: "Compare your ideas" }));
    const recorded = compare.getByText("The ball stays round.");
    const outcome = compare.getByText(/What we observed in the activity:/);
    expect(recorded.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((screen.getByLabelText("Your prediction") as HTMLTextAreaElement).readOnly).toBe(true);
  });
  it("keeps experience recall and closer observation before concept naming with or without optional connection", () => {
    const activity = { ...bridgingActivity, stages: bridgingActivity.stages.filter(stage => stage.id !== "connect") };
    render(<MaterialActivityView activity={activity} media={{ image: "https://example.org/seat.webp" }} />);
    expect(screen.queryByText(/Science calls/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("img")).toBeDefined();
    expect(screen.queryByText(/Science calls/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/Science calls/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Your scientific question")).toBeDefined();
    expect(screen.queryByText("Notice it elsewhere")).toBeNull();
  });
  it("shows the target and analogue separately before their combined mapping", () => {
    render(<MaterialActivityView activity={analogyActivity} media={{ image: "https://example.org/a.webp" }} />);
    expect(screen.queryByText("A familiar arrangement")).toBeNull();
    expect(screen.getByRole("img").getAttribute("alt")).toBe(analogyActivity.image.panels![0].alt);
    expect(screen.queryByText("Paper accordion")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("A familiar arrangement")).toBeDefined();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getAllByRole("img")[1].getAttribute("alt")).toBe(analogyActivity.image.panels![1].alt);
    expect(screen.queryByText("Compare the arrangements")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.getAllByRole("img")[2].getAttribute("src")).toBe("https://example.org/a.webp");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Your scientific question"), { target: { value: "Why does the spring return?" } });
    expect((screen.getByLabelText("Your scientific question") as HTMLTextAreaElement).value).toContain("spring");
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });
  it("keeps legacy combined images hidden until the original reveal stage", () => {
    const activity = { ...analogyActivity, image: { scene: analogyActivity.image.scene, revealAt: 2 } };
    render(<MaterialActivityView activity={activity} media={{ image: "https://example.org/legacy.webp" }} />);
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("img")).toBeDefined();
  });
  it("lets the teacher review every stage without entering student responses", () => {
    render(<MaterialActivityView activity={analogyActivity} preview />);
    expect(screen.getByText("Where the comparison stops")).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("compares a learner's actual prediction with labeled hypothetical data without inventing image evidence", () => {
    const observedOutcome = "Hypothetical positions show equal distances each second, not measured speeds.";
    const activity = parseMaterialActivity({ ...conflictActivity, observedOutcome }, "cognitive conflict")!;
    render(<MaterialActivityView activity={activity} media={{ image: "https://example.org/cart.webp" }} />);
    expect(screen.queryByText(new RegExp(observedOutcome))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "I think it stops." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const comparison = within(screen.getByRole("region", { name: "Compare your ideas" }));
    expect(comparison.getByText(/Hypothetical positions/).textContent).not.toContain("observed in the illustration");
    expect(comparison.getByText("I think it stops.")).toBeDefined();
    expect((screen.getByLabelText("Your prediction") as HTMLTextAreaElement).readOnly).toBe(true);
  });
});
