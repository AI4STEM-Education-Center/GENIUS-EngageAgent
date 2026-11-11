// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), previewDeck: vi.fn(), copy: vi.fn(), unshare: vi.fn() }));
vi.mock("@/lib/material-gallery-client", () => ({ listMaterialGallery: mocks.list, previewGalleryMaterial: mocks.preview,
  previewGallerySlideDeck: mocks.previewDeck, copyGalleryMaterial: mocks.copy, unshareGalleryMaterial: mocks.unshare }));
vi.mock("@/app/components/SlidePreview", () => ({ default: ({ deck, index }: { deck: { draft: { slides: { title: string }[] } }; index: number }) => <div aria-label="Rendered shared slide">{deck.draft.slides[index].title}</div> }));
import MaterialGalleryPanel from "@/app/components/MaterialGalleryPanel";
import type { GalleryMaterial, GalleryPreviewSource } from "@/lib/material-gallery";
import { deckFixture } from "../fixtures/slides";

const scope = { classId: "ea-class-one", assignmentId: "ea-task-one" };
const material: GalleryMaterial = { id: "template-one", title: "A shared ball activity", revision: 1, description: "Investigate contact", gradeBand: "Grades 6–8",
  experienceContext: "Catching a ball", quizPattern: "", lessonNumber: 3, strategy: "cognitive conflict", format: "slides", isOwner: true, createdAt: "2026-11-03T10:00:00Z", slideCount: 5 };
const deck = deckFixture("cognitive conflict");
const detail: GalleryPreviewSource = { material, draft: deck.draft, strategy: deck.strategy, lessonNumber: 3, visualIds: ["evidence"] };
function props(overrides = {}) { return { scope, lessonNumber: 3, strategy: "cognitive conflict", format: "slides" as const, onUse: vi.fn(), ...overrides }; }
const card = async () => (await screen.findByRole("heading", { name: material.title })).closest("article")!;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ items: [material] }); mocks.preview.mockResolvedValue(detail); mocks.previewDeck.mockResolvedValue(deck); mocks.unshare.mockResolvedValue(undefined);
  const source = { templateId: material.id, revision: 1, title: material.title, mode: "adapt" };
  mocks.copy.mockResolvedValue({ format: "slides", deck: { ...deck, id: "independent-copy", gallerySource: source }, source });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

it("previews actual slides without copying or changing the user's current material", async () => {
  const onUse = vi.fn(); render(<MaterialGalleryPanel {...props({ onUse })} />);
  fireEvent.click(within(await card()).getByRole("button", { name: "Preview" }));
  expect(await screen.findByLabelText("Rendered shared slide")).toBeTruthy();
  expect(mocks.preview).toHaveBeenCalledWith(scope, material.id, expect.any(AbortSignal));
  expect(mocks.copy).not.toHaveBeenCalled(); expect(onUse).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Next" }));
  expect(screen.getByLabelText("Rendered shared slide").textContent).toBe(deck.draft.slides[1].title);
});

it("combines standalone filters with task recommendations and displays author, count and teaching tags in preview", async () => {
  const tagged = { ...material, creatorName: "A verified teacher", teacherCount: 14, promptTags: { TOPIC: "Contact forces", LEARNER_CONTEXT: "Visual scaffolding" } };
  mocks.list.mockResolvedValue({ items: [tagged], facets: { lessons: [2, 3], strategies: ["cognitive conflict"] } });
  mocks.preview.mockResolvedValue({ ...detail, material: tagged });
  const focus = { misconceptions: ["a"], coreIdeas: [] };
  render(<MaterialGalleryPanel {...props({ standalone: true, focus })} />);
  await card();
  expect(mocks.list.mock.lastCall?.[1]).toMatchObject({ recommendLesson: 3, recommendStrategy: "cognitive conflict", recommendFocus: JSON.stringify(focus) });
  fireEvent.change(screen.getByLabelText("Filter Gallery by lesson"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Filter Gallery by strategy"), { target: { value: "cognitive conflict" } });
  fireEvent.change(screen.getByLabelText("Search shared materials"), { target: { value: "Visual scaffolding" } });
  fireEvent.click(screen.getByRole("button", { name: "Search Gallery" }));
  await waitFor(() => expect(mocks.list.mock.lastCall?.[1]).toMatchObject({ lessonNumber: 3, strategy: "cognitive conflict", search: "Visual scaffolding" }));
  fireEvent.change(screen.getByLabelText("Gallery sort order"), { target: { value: "newest" } });
  await waitFor(() => expect(mocks.list.mock.lastCall?.[1].recommendLesson).toBeUndefined());
  fireEvent.click(within(await card()).getByRole("button", { name: "Preview" }));
  await screen.findByLabelText("Rendered shared slide");
  const preview = within(screen.getByRole("dialog"));
  expect(preview.getByText("By A verified teacher")).toBeTruthy();
  expect(preview.getByText(/14 teachers have saved a copy/)).toBeTruthy();
  fireEvent.click(preview.getByText("Teaching tags"));
  expect(preview.getByText("Contact forces")).toBeTruthy();
  expect(preview.getByText("Visual scaffolding")).toBeTruthy();
  expect(mocks.copy).not.toHaveBeenCalled();
});

it("passes the selected copy mode and metadata to the editor, with an independent material ID", async () => {
  const onUse = vi.fn(); render(<MaterialGalleryPanel {...props({ onUse })} />);
  fireEvent.click(within(await card()).getByRole("button", { name: "Adapt" }));
  await waitFor(() => expect(onUse).toHaveBeenCalledOnce());
  expect(mocks.copy).toHaveBeenCalledWith(scope, material.id, "adapt", expect.any(AbortSignal));
  expect(onUse.mock.calls[0][0].deck.id).toBe("independent-copy"); expect(onUse.mock.calls[0][1]).toEqual(material);
  expect(await screen.findByText(/Your own copy is ready below/)).toBeTruthy();
});

it("cancels a pending copy and preview when the class changes, ignoring late results", async () => {
  let resolveCopy!: (value: unknown) => void;
  let resolvePreview!: (value: GalleryPreviewSource) => void;
  mocks.copy.mockImplementation(() => new Promise(resolve => { resolveCopy = resolve; }));
  mocks.preview.mockImplementation(() => new Promise(resolve => { resolvePreview = resolve; }));
  const onUse = vi.fn(); const view = render(<MaterialGalleryPanel {...props({ onUse })} />);
  const article = await card();
  fireEvent.click(within(article).getByRole("button", { name: "Use as is" }));
  fireEvent.click(within(article).getByRole("button", { name: "Preview" }));
  const copySignal = mocks.copy.mock.calls[0][3] as AbortSignal;
  const previewSignal = mocks.preview.mock.calls[0][2] as AbortSignal;
  mocks.list.mockResolvedValue({ items: [] });
  view.rerender(<MaterialGalleryPanel {...props({ onUse, scope: { classId: "ea-class-two", assignmentId: "ea-task-two" } })} />);
  expect(copySignal.aborted).toBe(true); expect(previewSignal.aborted).toBe(true);
  await act(async () => {
    resolveCopy({ format: "slides", deck, source: { templateId: material.id } }); resolvePreview(detail);
  });
  expect(onUse).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull(); expect(mocks.previewDeck).not.toHaveBeenCalled();
});

it("keeps existing material safe on a copy failure and exposes a useful error", async () => {
  mocks.copy.mockRejectedValue(new Error("The original was removed from the Gallery."));
  const onUse = vi.fn(); render(<MaterialGalleryPanel {...props({ onUse })} />);
  fireEvent.click(within(await card()).getByRole("button", { name: "Use as is" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("original was removed"));
  expect(onUse).not.toHaveBeenCalled();
});

it("requires an explicit removal action and hides withdrawal controls for another teacher's material", async () => {
  render(<MaterialGalleryPanel {...props()} />);
  fireEvent.click(within(await card()).getByRole("button", { name: "Remove from Gallery" }));
  expect(mocks.unshare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove shared material" }));
  await waitFor(() => expect(mocks.unshare).toHaveBeenCalledWith(scope, material.id, expect.any(AbortSignal)));
  expect(await screen.findByText(/Removed from the Gallery/)).toBeTruthy();
  cleanup(); mocks.list.mockResolvedValue({ items: [{ ...material, isOwner: false }] });
  render(<MaterialGalleryPanel {...props()} />); await card();
  expect(screen.queryByRole("button", { name: "Remove from Gallery" })).toBeNull();
});

it("opens the library from the header before a lesson is selected, with copying disabled", async () => {
  render(<MaterialGalleryPanel {...props({ lessonNumber: 0, browseRequest: 1 })} />);
  const article = await card();
  expect(screen.getByRole("heading", { name: "Materials Gallery" })).toBeTruthy();
  expect(within(article).getByRole("button", { name: "Use as is" })).toHaveProperty("disabled", true);
  expect(screen.getByText("Choose Lesson 3 in Assessment to use this material.")).toBeTruthy();
  expect(mocks.list.mock.calls.every(([, filters]) => filters.lessonNumber !== 0)).toBe(true);
});

it.each([{ lessonNumber: 0, preview: false }, { lessonNumber: 8, preview: true }])("opens a standalone Gallery copy without changing or requiring the workflow lesson: %j", async ({ lessonNumber, preview }) => {
  const onUse = vi.fn();
  render(<MaterialGalleryPanel {...props({ lessonNumber, strategy: "analogy", standalone: true, onUse })} />);
  const article = await card();
  expect(screen.getByRole("heading", { name: "Shared materials" })).toBeTruthy();
  expect(screen.queryByText("Choose Lesson 3 in Assessment to use this material.")).toBeNull();
  expect(mocks.list.mock.calls.every(([, filters]) => filters.lessonNumber === undefined && filters.strategy === undefined)).toBe(true);
  if (preview) {
    fireEvent.click(within(article).getByRole("button", { name: "Preview" }));
    await screen.findByLabelText("Rendered shared slide");
    expect(mocks.copy).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Open and edit" }));
  } else fireEvent.click(within(article).getByRole("button", { name: "Open" }));
  await waitFor(() => expect(onUse).toHaveBeenCalledOnce());
  expect(mocks.copy).toHaveBeenCalledWith(scope, material.id, "adapt", expect.any(AbortSignal));
  expect(onUse.mock.calls[0][0].deck.lessonNumber).toBe(3);
  expect(onUse.mock.calls[0][0].deck.id).toBe("independent-copy");
  expect(onUse.mock.calls[0][1]).toEqual(material);
  expect(await screen.findByText("Your copy is ready to edit.")).toBeTruthy();
});

it("previews a saved video without creating a copy", async () => {
  const video = { ...material, format: "video" as const };
  mocks.list.mockResolvedValue({ items: [video] });
  mocks.preview.mockResolvedValue({ material: video, lessonNumber: 3, strategy: video.strategy,
    item: { id: "video-template", title: video.title, body: "Watch the ball during contact.", type: "Video", strategy: video.strategy }, media: { video: "/private-video?ticket=temporary" } });
  render(<MaterialGalleryPanel {...props({ format: "video" })} />);
  fireEvent.click(within(await card()).getByRole("button", { name: "Preview" }));
  const player = await screen.findByLabelText("Shared video preview");
  expect(player.getAttribute("src")).toBe("/private-video?ticket=temporary"); expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.previewDeck).not.toHaveBeenCalled();
});

it("does not call unrelated lessons a focus match just because their local codes overlap", async () => {
  mocks.list.mockResolvedValue({ items: [{ ...material, lessonNumber: 2, focus: { misconceptions: ["a"], coreIdeas: [] } }] });
  render(<MaterialGalleryPanel {...props({ focus: { misconceptions: ["a"], coreIdeas: [] }, browseRequest: 1 })} />);
  await card(); expect(screen.queryByText("Same focus")).toBeNull();
});

it("directs adapted video copies to the actual video editor", async () => {
  const video = { ...material, format: "video" as const };
  mocks.list.mockResolvedValue({ items: [video] });
  mocks.copy.mockResolvedValue({ format: "video", item: { id: "copied-video" }, media: { video: "/video" } });
  render(<MaterialGalleryPanel {...props({ format: "video" })} />);
  fireEvent.click(within(await card()).getByRole("button", { name: "Adapt" }));
  expect(await screen.findByText(/Open Edit material to adapt/)).toBeTruthy();
  expect(screen.queryByText(/Revise with AI/)).toBeNull();
});
