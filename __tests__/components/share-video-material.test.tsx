// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShareVideoMaterial from "@/app/components/ShareVideoMaterial";
import type { ContentItem } from "@/lib/types";
import { analogyActivity, conflictActivity } from "../fixtures/material-activities";

const mocks = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock("@/lib/material-gallery-client", () => ({ shareVideoMaterial: mocks.share }));
const scope = { classId: "class-a", assignmentId: "task-a" };
const focus = { misconceptions: ["a"], coreIdeas: [0] };
const videoUrl = "https://media.example.test/current-video.mp4";
const imageUrl = "https://media.example.test/current-image.png";
const itemFixture = (): ContentItem => ({ id: "video-item", type: "Video", title: "A class video", body: "Our class discussed this video.", strategy: "cognitive conflict", visualBrief: "A private class-specific scene", activity: structuredClone(conflictActivity) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.share.mockResolvedValue({ id: "gallery-video", revision: 1 });
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute("open"); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function openShare() {
  fireEvent.click(screen.getByRole("button", { name: "Share to Gallery" }));
  return screen.getByRole("dialog", { name: "Share video to Gallery" });
}

it("previews real media and shares only the edited copy while the class material stays unchanged", async () => {
  const item = itemFixture();
  item.activity!.stages[0].title = "Jayden's class video";
  const original = structuredClone(item);
  const onShared = vi.fn();
  render(<ShareVideoMaterial scope={scope} item={item} lessonNumber={1} focus={focus} videoUrl={videoUrl} imageUrl={imageUrl} onShared={onShared} />);
  const modal = openShare();
  const video = within(modal).getByLabelText("Video to share") as HTMLVideoElement;
  expect(video.getAttribute("src")).toBe(videoUrl);
  expect(video.getAttribute("poster")).toBe(imageUrl);
  expect(video.controls).toBe(true);
  expect(video.autoplay).toBe(false);
  const share = within(modal).getByRole("button", { name: "Share video material" }) as HTMLButtonElement;
  expect(share.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Shared title"), { target: { value: " A reusable video " } });
  fireEvent.change(screen.getByLabelText("Activity text"), { target: { value: "Observe what happens at contact." } });
  fireEvent.change(screen.getByLabelText("Stage 1 title"), { target: { value: "A familiar collision" } });
  fireEvent.change(screen.getByLabelText("Stage 1 text"), { target: { value: "What do you notice?" } });
  fireEvent.change(screen.getByLabelText("Video scene description"), { target: { value: "A ball contacts the floor." } });
  fireEvent.change(screen.getByLabelText("Image panel 1 caption"), { target: { value: "Before contact" } });
  fireEvent.change(screen.getByLabelText("Teaching context (optional)"), { target: { value: "Reusable video setting" } });
  fireEvent.change(screen.getByLabelText("Quiz pattern (optional)"), { target: { value: "Contact forces" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(share);
  await waitFor(() => expect(onShared).toHaveBeenCalledOnce());
  expect(mocks.share).toHaveBeenCalledOnce();
  const [actualScope, copy, lesson, metadata, signal] = mocks.share.mock.calls[0];
  expect(actualScope).toEqual(scope);
  expect(copy.id).toBe(item.id);
  expect(copy.title).toBe("A reusable video");
  expect(copy.body).toBe("Observe what happens at contact.");
  expect(copy.activity.stages[0]).toMatchObject({ id: "phenomenon", title: "A familiar collision", text: "What do you notice?" });
  expect(copy.visualBrief).toBe("A ball contacts the floor.");
  expect(lesson).toBe(1);
  expect(metadata).toMatchObject({ title: "A reusable video", focus: { misconceptions: ["a"], coreIdeas: [] }, teachingContext: "Reusable video setting", quizPattern: "Contact forces", sharingConfirmed: true });
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(item).toEqual(original);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Sending to students is a separate action");
});

it("requires reconfirmation after edits and keeps emptied optional fields available for correction", () => {
  render(<ShareVideoMaterial scope={scope} item={itemFixture()} lessonNumber={1} focus={focus} onShared={vi.fn()} />);
  const modal = openShare();
  const share = within(modal).getByRole("button", { name: "Share video material" }) as HTMLButtonElement;
  fireEvent.click(screen.getByRole("checkbox"));
  expect(share.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Video scene description"), { target: { value: "" } });
  expect(share.disabled).toBe(true);
  expect(screen.getByLabelText("Video scene description")).toHaveProperty("value", "");
  fireEvent.change(screen.getByLabelText("Video scene description"), { target: { value: "A neutral scene" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Observed outcome"), { target: { value: "" } });
  expect(share.disabled).toBe(true);
  expect(screen.getByLabelText("Observed outcome")).toHaveProperty("value", "");
  expect(mocks.share).not.toHaveBeenCalled();
});

it("exposes every analogy source text for review and saves edited mapping and image descriptions", async () => {
  const item: ContentItem = { ...itemFixture(), strategy: "analogy", activity: structuredClone(analogyActivity) };
  const onShared = vi.fn();
  render(<ShareVideoMaterial scope={scope} item={item} lessonNumber={1} focus={focus} onShared={onShared} />);
  openShare();
  for (const [index, stage] of item.activity!.stages.entries()) {
    expect(screen.getByLabelText(`Stage ${index + 1} title`)).toHaveProperty("value", stage.title);
    expect(screen.getByLabelText(`Stage ${index + 1} text`)).toHaveProperty("value", stage.text);
  }
  expect(screen.getByLabelText("Scene")).toHaveProperty("value", item.activity!.image.scene);
  for (const [index, panel] of item.activity!.image.panels!.entries()) {
    for (const field of ["description", "caption", "alt"] as const) expect(screen.getByLabelText(`Image panel ${index + 1} ${field}`)).toHaveProperty("value", panel[field]);
  }
  const mapping = item.activity!.analogyMapping!;
  expect(screen.getByLabelText("Target concept")).toHaveProperty("value", mapping.target);
  expect(screen.getByLabelText("Familiar comparison")).toHaveProperty("value", mapping.analogue);
  for (const [index, pair] of mapping.correspondences.entries()) {
    for (const field of ["targetPart", "analoguePart", "relationship"] as const) expect(screen.getByLabelText(`Mapping ${index + 1} ${field}`)).toHaveProperty("value", pair[field]);
  }
  fireEvent.change(screen.getByLabelText("Mapping 1 relationship"), { target: { value: "The two arrangements have repeated units." } });
  fireEvent.change(screen.getByLabelText("Image panel 1 alt"), { target: { value: "A neutral drawing of the spring." } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Share video material" }));
  await waitFor(() => expect(onShared).toHaveBeenCalledOnce());
  const copy = mocks.share.mock.calls[0][1];
  expect(copy.activity.analogyMapping.correspondences[0].relationship).toBe("The two arrangements have repeated units.");
  expect(copy.activity.image.panels[0].alt).toBe("A neutral drawing of the spring.");
  expect(mocks.share.mock.calls[0][3].focus).toEqual({ misconceptions: [], coreIdeas: [0] });
});

it("retains the edited copy when sharing fails and retries only after a deliberate click", async () => {
  mocks.share.mockRejectedValueOnce(new Error("Video storage is unavailable."));
  const onShared = vi.fn();
  render(<ShareVideoMaterial scope={scope} item={itemFixture()} lessonNumber={1} focus={focus} onShared={onShared} />);
  openShare();
  fireEvent.change(screen.getByLabelText("Shared title"), { target: { value: "My reviewed copy" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Share video material" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Video storage is unavailable.");
  expect(onShared).not.toHaveBeenCalled();
  expect(mocks.share).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Shared title")).toHaveProperty("value", "My reviewed copy");
  fireEvent.click(screen.getByRole("button", { name: "Share video material" }));
  await waitFor(() => expect(onShared).toHaveBeenCalledOnce());
  expect(mocks.share).toHaveBeenCalledTimes(2);
});

it("aborts an in-flight share on unmount and ignores a late success", async () => {
  let finish!: (value: unknown) => void;
  mocks.share.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const onShared = vi.fn();
  const view = render(<ShareVideoMaterial scope={scope} item={itemFixture()} lessonNumber={1} focus={focus} onShared={onShared} />);
  const modal = openShare();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Share video material" }));
  expect(screen.getByRole("button", { name: "Sharing…" })).toHaveProperty("disabled", true);
  const cancel = new Event("cancel", { cancelable: true });
  fireEvent(modal, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  const signal = mocks.share.mock.calls[0][4] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ id: "late-template" }));
  expect(onShared).not.toHaveBeenCalled();
});

it("does not invent focus metadata for a legacy video with no saved focus", async () => {
  const onShared = vi.fn();
  render(<ShareVideoMaterial scope={scope} item={itemFixture()} lessonNumber={1} onShared={onShared} />);
  openShare();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Share video material" }));
  await waitFor(() => expect(onShared).toHaveBeenCalledOnce());
  expect(mocks.share.mock.calls[0][3]).not.toHaveProperty("focus");
});

it("updates the app-owned comparison text when the reviewed observed outcome changes", async () => {
  const onShared = vi.fn();
  render(<ShareVideoMaterial scope={scope} item={itemFixture()} lessonNumber={1} focus={focus} onShared={onShared} />);
  openShare();
  const compare = screen.getByLabelText("Stage 4 text") as HTMLTextAreaElement;
  expect(compare.readOnly).toBe(true);
  fireEvent.change(screen.getByLabelText("Observed outcome"), { target: { value: "The ball changes shape during contact." } });
  expect(compare.value).toContain("The ball changes shape during contact.");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Share video material" }));
  await waitFor(() => expect(onShared).toHaveBeenCalledOnce());
  expect(mocks.share.mock.calls[0][1].activity.stages[3].text).toBe("What we observed in the activity: The ball changes shape during contact.\nHow did what we observed match or differ from your recorded prediction?");
});
