// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GalleryCopyDetails from "@/app/components/GalleryCopyDetails";
import { deckFixture } from "../fixtures/slides";
import MaterialGenerationHistory from "@/app/components/MaterialGenerationHistory";
import { galleryGenerationHistory, type MaterialGenerationHistory as History } from "@/lib/material-gallery-client";

vi.mock("@/lib/material-gallery-client", () => ({ galleryGenerationHistory: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const scope = { classId: "", assignmentId: "" };
const response = (label: string): History => ({ parts: [{ label, records: [], incomplete: false }] });

it("reloads an expanded history on save and ignores the superseded source request", async () => {
  let completeSource!: (value: History) => void;
  const get = vi.mocked(galleryGenerationHistory);
  get.mockImplementationOnce(() => new Promise(resolve => { completeSource = resolve; }))
    .mockResolvedValueOnce(response("Saved material text"));
  const view = render(<MaterialGenerationHistory scope={scope} copyId="copy" revision={0} />);
  expect(screen.getByText(/Source records for this unsaved copy/)).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
  const details = screen.getByText("Generation history").closest("details")!;
  fireEvent.click(details.querySelector("summary")!);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  view.rerender(<MaterialGenerationHistory scope={scope} copyId="copy" revision={1} />);
  expect(await screen.findByRole("heading", { name: "Saved material text" })).toBeTruthy();
  expect(screen.getByText(/Records for saved version 1/)).toBeTruthy();
  expect(get.mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => completeSource(response("Superseded material text")));
  expect(screen.queryByText("Superseded material text")).toBeNull();
});

it("opens the immediate source history through the teacher's copy even when the source has left the Gallery", async () => {
  const get = vi.mocked(galleryGenerationHistory).mockResolvedValue(response("Original source text"));
  const source = { templateId: "withdrawn", title: "Source slides", mode: "use" as const, revision: 1 };
  const deck = { ...deckFixture("analogy"), gallerySource: source };
  render(<GalleryCopyDetails scope={scope} copy={{ source, format: "slides", deck }} revision={2} dirty={false} owner="Me" source={{ creatorName: "Source teacher", id: source.templateId }} />);
  const sourcePanel = screen.getByText("Source material · Source teacher").closest("details")!;
  const history = Array.from(sourcePanel.querySelectorAll("summary")).find(summary => summary.textContent === "Generation history")!;
  fireEvent.click(history);
  await waitFor(() => expect(get).toHaveBeenCalledWith(scope, { id: undefined, copyId: undefined, sourceCopyId: deck.id }, expect.any(AbortSignal)));
  expect(await screen.findByText("Original source text")).toBeTruthy();
});
