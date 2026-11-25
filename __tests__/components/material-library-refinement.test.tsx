// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GalleryCopyDetails from "@/app/components/GalleryCopyDetails";
import SavedMaterialsPanel from "@/app/components/SavedMaterialsPanel";
import { deckFixture } from "../fixtures/slides";
import type { SavedGalleryCopySummary } from "@/lib/material-gallery";
afterEach(cleanup);
const source = { templateId: "source", revision: 1, title: "Original class example", mode: "adapt" as const };
it("separates current copy settings from source attribution and aggregate feedback", () => {
  const deck = { ...deckFixture("cognitive conflict"), gallerySource: source, teachingContext: { gradeBand: "Middle school", experienceContext: "Bicycle brakes" } };
  render(<GalleryCopyDetails copy={{ format: "slides", deck, source }} revision={3} dirty={false} owner="Current teacher" savedAt="2026-11-18T00:00:00Z"
    source={{ creatorName: "Original teacher", experienceContext: "Catching a ball", gradeBand: "High school", teacherCount: 12 }} />);
  const current = screen.getByText("Your current copy · Version 3").closest("details")!;
  const original = screen.getByText("Source material · Original teacher").closest("details")!;
  fireEvent.click(within(current).getByText(/Your current copy/));
  fireEvent.click(within(original).getByText(/Source material/));
  expect(within(current).getByText("Bicycle brakes")).toBeInTheDocument();
  expect(within(current).queryByText("Catching a ball")).toBeNull();
  expect(within(current).queryByLabelText("Student feedback")).toBeNull();
  expect(within(original).getByText("Catching a ball")).toBeInTheDocument();
  expect(within(original).getByText(/combine its linked classroom copies/)).toBeInTheDocument();
});
it("identifies the immediate source sharer separately from the original author and keeps unsaved copies unnumbered", () => {
  const deck = { ...deckFixture("analogy"), gallerySource: source };
  render(<GalleryCopyDetails copy={{ format: "slides", deck, source }} revision={0} dirty={false} owner="Current teacher"
    source={{ creatorName: "Adapter", originalCreatorName: "Original author", derivedFrom: { title: "First version", templateId: "first", revision: 1 } }} />);
  expect(screen.getByText("Your current copy · Not saved yet")).toBeTruthy();
  const details = screen.getByText("Source material · Shared by Adapter").closest("details")!;
  expect(within(details).getByText("Original author: Original author")).toBeTruthy();
  expect(within(details).getByText(source.title)).toBeTruthy();
});
it("filters and searches private materials without presenting source ratings as private ratings", () => {
  const first: SavedGalleryCopySummary = { copyId: "a", revision: 2, title: "Bicycle lesson", savedAt: "2026-11-18T00:00:00Z", format: "slides", lessonNumber: 3,
    strategy: "analogy", source, gradeBand: "Middle school", experienceContext: "Riding a bicycle", previewSlide: { stage: "phenomenon", title: "A turning wheel", body: "Observe the wheel", task: "What changed?" } };
  const open = vi.fn();
  render(<SavedMaterialsPanel items={[first, { ...first, copyId: "b", title: "Ball collision", lessonNumber: 4, strategy: "cognitive conflict", gradeBand: "High school", experienceContext: "Catching a ball" }]} format="slides" loading={false} busy={false} onOpen={open} />);
  expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(2);
  expect(screen.queryByLabelText("Student feedback")).toBeNull();
  fireEvent.change(screen.getByLabelText("Filter saved materials by grade"), { target: { value: "Middle school" } });
  fireEvent.change(screen.getByLabelText("Search saved materials"), { target: { value: "bicycle" } });
  expect(screen.getByRole("heading", { name: "Bicycle lesson" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Ball collision" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open" })); expect(open).toHaveBeenCalledWith("a");
  fireEvent.change(screen.getByLabelText("Filter saved materials by lesson"), { target: { value: "4" } });
  expect(screen.getByText("No saved materials match")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(2);
});
