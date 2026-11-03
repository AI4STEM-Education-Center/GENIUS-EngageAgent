// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VideoMaterialEditor from "@/app/components/VideoMaterialEditor";
import { parseMaterialActivity } from "@/lib/material-activities";
import type { ContentItem } from "@/lib/types";
import { analogyActivity, conflictActivity } from "../fixtures/material-activities";

const fixture = (): ContentItem => ({
  id: "gallery-copy-11111111-1111-4111-8111-111111111111", type: "Video", title: "A copied video", body: "Observe the ball.", strategy: "cognitive conflict",
  lessonNumber: 1, focus: { misconceptions: ["a"], coreIdeas: [] }, visualBrief: "A ball on the floor",
  gallerySource: { templateId: "source-template", revision: 2, title: "Shared source", mode: "adapt" },
  activity: structuredClone(conflictActivity),
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Edit material" }));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

it("saves the adapted class copy with its identity and metadata intact without changing the original or media", () => {
  const item = fixture();
  const original = structuredClone(item);
  const onChange = vi.fn();
  render(<VideoMaterialEditor item={item} onChange={onChange} videoUrl="https://media.test/video.mp4" imageUrl="https://media.test/image.png" />);
  open();
  const video = screen.getByLabelText("Video being adapted") as HTMLVideoElement;
  expect(video.src).toBe("https://media.test/video.mp4");
  expect(video.poster).toBe("https://media.test/image.png");
  expect(video.controls).toBe(true);
  expect(video.autoplay).toBe(false);
  expect(screen.getByText(/Text edits do not change the video or image/)).toBeTruthy();
  change("Material title", " Our lesson's video ");
  change("Activity text", "Look at the ball when it touches the floor.");
  change("Stage 1 title", "Our observation");
  change("Stage 2 text", "Predict how the ball's shape changes during contact.");
  change("Video scene description", "The same ball at three times.");
  expect(onChange).not.toHaveBeenCalled();
  expect(item).toEqual(original);
  save();
  expect(onChange).toHaveBeenCalledOnce();
  const updated = onChange.mock.calls[0][0] as ContentItem;
  expect(updated).toMatchObject({ id: original.id, type: "Video", title: "Our lesson's video", body: "Look at the ball when it touches the floor.", lessonNumber: 1, focus: original.focus, gallerySource: original.gallerySource, visualBrief: "The same ball at three times." });
  expect(updated.activity!.stages[0].title).toBe("Our observation");
  expect(updated.activity!.stages[1].text).toBe("Predict how the ball's shape changes during contact.");
  expect(updated.activity!.stages.map(stage => stage.id)).toEqual(original.activity!.stages.map(stage => stage.id));
  expect(updated.activity!.image.revealAt).toBe(2);
  expect(parseMaterialActivity(updated.activity, updated.strategy)).toEqual(updated.activity);
  expect(item).toEqual(original);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Send it to students when it is ready");
});

it("discards cancelled changes and reopens the latest parent copy", () => {
  const item = fixture();
  const onChange = vi.fn();
  const view = render(<VideoMaterialEditor item={item} onChange={onChange} />);
  open();
  change("Material title", "Discard this title");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onChange).not.toHaveBeenCalled();
  view.rerender(<VideoMaterialEditor item={{ ...item, title: "Updated elsewhere" }} onChange={onChange} />);
  open();
  expect(screen.getByLabelText("Material title")).toHaveProperty("value", "Updated elsewhere");
});

it("rejects incomplete activity edits and retains the draft for correction", () => {
  const onChange = vi.fn();
  render(<VideoMaterialEditor item={fixture()} onChange={onChange} />);
  open();
  change("Material title", " ");
  save();
  expect(screen.getByRole("alert").textContent).toContain("Enter a material title");
  change("Material title", "Ready title");
  change("Activity text", "");
  save();
  expect(screen.getByRole("alert").textContent).toContain("Enter activity text");
  change("Activity text", "An edited body.");
  change("Stage 1 text", "");
  save();
  expect(screen.getByRole("alert").textContent).toContain("Complete every stage");
  expect(screen.getByLabelText("Activity text")).toHaveProperty("value", "An edited body.");
  expect(onChange).not.toHaveBeenCalled();
  change("Stage 1 text", "Observe the contact carefully.");
  save();
  expect(onChange).toHaveBeenCalledOnce();
});

it("keeps the app-owned Compare stage synchronized with the observed outcome and rejects an empty outcome", () => {
  const onChange = vi.fn();
  render(<VideoMaterialEditor item={fixture()} onChange={onChange} />);
  open();
  const compare = screen.getByLabelText("Stage 4 text") as HTMLTextAreaElement;
  expect(compare.readOnly).toBe(true);
  change("Observed outcome", "");
  save();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Observed outcome")).toHaveProperty("value", "");
  change("Observed outcome", " The ball changes shape during contact. ");
  expect(compare.value).toContain("The ball changes shape during contact.");
  change("Stage 4 title", "Compare against our observation");
  save();
  const updated = onChange.mock.calls[0][0] as ContentItem;
  expect(updated.activity!.observedOutcome).toBe("The ball changes shape during contact.");
  expect(updated.activity!.stages[3]).toEqual({ id: "compare", title: "Compare against our observation", text: "What we observed in the activity: The ball changes shape during contact.\nHow did what we observed match or differ from your recorded prediction?" });
});

it("edits every analogy mapping and image field while retaining the mapping depth and stage structure", () => {
  const item = { ...fixture(), strategy: "analogy", activity: structuredClone(analogyActivity) };
  const original = structuredClone(item);
  const onChange = vi.fn();
  render(<VideoMaterialEditor item={item} onChange={onChange} />);
  open();
  change("Scene description", "A spring beside a paper accordion.");
  change("Image panel 1 description", "A gently stretched spring.");
  change("Image panel 1 caption", "Our spring");
  change("Image panel 1 screen reader description", "A spring with evenly spaced turns.");
  change("Target concept", "Metal spring arrangement");
  change("Familiar comparison", "Folded paper arrangement");
  change("Mapping 1 concept part", "Spring turns");
  change("Mapping 1 comparison part", "Paper folds");
  change("Mapping 1 relationship", "Both have repeated units separated by gaps.");
  save();
  const updated = onChange.mock.calls[0][0] as ContentItem;
  expect(updated.activity!.image).toMatchObject({ revealAt: 2, scene: "A spring beside a paper accordion.", panels: [{ description: "A gently stretched spring.", caption: "Our spring", alt: "A spring with evenly spaced turns." }, original.activity.image.panels![1]] });
  expect(updated.activity!.analogyMapping).toMatchObject({ target: "Metal spring arrangement", analogue: "Folded paper arrangement", correspondences: [{ targetPart: "Spring turns", analoguePart: "Paper folds", relationship: "Both have repeated units separated by gaps." }, original.activity.analogyMapping!.correspondences[1]] });
  expect(updated.activity!.mappingDepth).toBe("configurations");
  expect(updated.activity!.stages).toEqual(original.activity.stages);
  expect(item).toEqual(original);
});

it("supports legacy videos without inventing an activity or focus", () => {
  const item: ContentItem = { id: "legacy", title: "Old video", body: "Old accompanying text.", type: "Video", strategy: "analogy" };
  const onChange = vi.fn();
  render(<VideoMaterialEditor item={item} onChange={onChange} />);
  open();
  change("Activity text", "Updated accompanying text.");
  save();
  expect(onChange.mock.calls[0][0]).toEqual({ ...item, body: "Updated accompanying text." });
});

it("prevents saving when the parent disables the material and discards a stale editor when the item changes", () => {
  const onChange = vi.fn();
  const item = fixture();
  const view = render(<VideoMaterialEditor item={item} onChange={onChange} disabled />);
  expect(screen.getByRole("button", { name: "Edit material" })).toHaveProperty("disabled", true);
  view.rerender(<VideoMaterialEditor item={item} onChange={onChange} />);
  open();
  change("Material title", "Unsent edit");
  view.rerender(<VideoMaterialEditor item={item} onChange={onChange} disabled />);
  expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
  view.rerender(<VideoMaterialEditor item={{ ...item, id: "another-video", title: "Different video" }} onChange={onChange} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  open();
  expect(screen.getByLabelText("Material title")).toHaveProperty("value", "Different video");
  expect(onChange).not.toHaveBeenCalled();
});
