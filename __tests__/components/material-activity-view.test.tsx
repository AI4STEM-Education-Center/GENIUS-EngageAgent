// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import MaterialActivityView from "@/app/components/MaterialActivityView";
import { parseMaterialActivity } from "@/lib/material-activities";
import { analogyActivity, conflictActivity, bridgingActivity } from "../fixtures/material-activities";

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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

  it("restores a committed prediction after remount, locks it on revisit and replays it before the observed outcome", () => {
    const predictionKey = `engage:material-prediction:${JSON.stringify(["student-a", "class-a", "task-a", "video-a"])}`;
    const props = { activity: conflictActivity, predictionKey, media: { video: "https://example.org/result.mp4" } };
    const view = render(<MaterialActivityView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: " The ball stays round. " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(JSON.parse(sessionStorage.getItem(predictionKey)!)).toEqual({ draft: " The ball stays round. ", recorded: "The ball stays round." });
    view.unmount();
    render(<MaterialActivityView {...props} />);
    expect(screen.queryByLabelText("Activity video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const prediction = screen.getByLabelText("Your prediction") as HTMLTextAreaElement;
    expect(prediction.value).toBe("The ball stays round.");
    expect(prediction.readOnly).toBe(true);
    fireEvent.change(prediction, { target: { value: "Changed after seeing the evidence" } });
    expect(prediction.value).toBe("The ball stays round.");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const compare = within(screen.getByRole("region", { name: "Compare your ideas" }));
    const recorded = compare.getByText("The ball stays round.");
    const outcome = compare.getByText(/What we observed in the activity:/);
    expect(recorded.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("restores an unfinished prediction as editable and still requires an explicit continue before revealing evidence", () => {
    const props = { activity: conflictActivity, predictionKey: "unfinished-prediction", media: { image: "https://example.org/result.webp" } };
    const view = render(<MaterialActivityView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "Maybe it changes shape." } });
    view.unmount();
    render(<MaterialActivityView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const prediction = screen.getByLabelText("Your prediction") as HTMLTextAreaElement;
    expect(prediction.value).toBe("Maybe it changes shape.");
    expect(prediction.readOnly).toBe(false);
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.change(prediction, { target: { value: " " } });
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
  });

  it.each([0, 1, 2, 3])("isolates predictions when scope dimension %s changes without remounting the parent", dimension => {
    const scope = ["student-a", "class-a", "task-a", "video-a"];
    const key = (parts: string[]) => `engage:material-prediction:${JSON.stringify(parts)}`;
    const originalKey = key(scope);
    sessionStorage.setItem(originalKey, JSON.stringify({ draft: "My private prediction.", recorded: "My private prediction." }));
    const view = render(<MaterialActivityView activity={conflictActivity} predictionKey={originalKey} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Your prediction")).toHaveProperty("value", "My private prediction.");
    const otherScope = scope.map((value, index) => index === dimension ? "other" : value);
    view.rerender(<MaterialActivityView activity={conflictActivity} predictionKey={key(otherScope)} />);
    expect(screen.queryByLabelText("Your prediction")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Your prediction")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
    expect(JSON.parse(sessionStorage.getItem(originalKey)!).recorded).toBe("My private prediction.");
    view.rerender(<MaterialActivityView activity={conflictActivity} predictionKey={originalKey} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Your prediction")).toHaveProperty("value", "My private prediction.");
  });

  it("keeps the prediction gate and comparison usable in memory when session storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    render(<MaterialActivityView activity={conflictActivity} predictionKey="blocked-storage" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "It changes shape." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Your prediction")).toHaveProperty("readOnly", true);
    expect(within(screen.getByRole("region", { name: "Compare your ideas" })).getByText("It changes shape.")).toBeTruthy();
  });

  it("does not access prediction storage during teacher preview or when no scope is supplied", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const view = render(<MaterialActivityView activity={conflictActivity} predictionKey="student-scope" preview />);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    view.rerender(<MaterialActivityView activity={conflictActivity} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Your prediction"), { target: { value: "A temporary prediction." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["not-json", JSON.stringify({ draft: 123, recorded: " " }), JSON.stringify({ draft: "x".repeat(2001), recorded: "x".repeat(2001) })])("ignores malformed or oversized saved prediction %s", saved => {
    sessionStorage.setItem("invalid-prediction", saved);
    render(<MaterialActivityView activity={conflictActivity} predictionKey="invalid-prediction" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Your prediction")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Your prediction")).toHaveProperty("readOnly", false);
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
  });
});
