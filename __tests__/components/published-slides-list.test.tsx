// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PublishedSlidesList from "@/app/components/PublishedSlidesList";

vi.mock("@/app/components/PublishedSlidesReader", () => ({
  default: ({ publicationId, audience }: { publicationId: string; audience: string }) => <p>{audience}: {publicationId}</p>,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const originalId = "06c5a640-bbe6-400d-9430-4baf30b71e23";
const revisedId = "06c5a640-bbe6-400d-9430-4baf30b71e24";
const response = (id: string) => ({ ok: true, json: async () => ({ items: [{ content_item_id: "slides-deck", content_json: JSON.stringify({
  type: "Slides", title: "Published inquiry", strategy: "analogy", body: "",
  slides: { publicationId: id, slideCount: 6, lessonNumber: 8 },
}) }] }) });

it("reads durable published slides without a local draft and refreshes the open deck after republishing", async () => {
  const fetcher = vi.fn().mockResolvedValue(response(originalId));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<PublishedSlidesList classId="ea-class-a" assignmentId="ea-task-b" refreshVersion={0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Read slides" }));
  expect(screen.getByText(`teacher: ${originalId}`)).toBeVisible();
  fetcher.mockResolvedValue(response(revisedId));
  view.rerender(<PublishedSlidesList classId="ea-class-a" assignmentId="ea-task-b" refreshVersion={1} />);
  expect(await screen.findByText(`teacher: ${revisedId}`)).toBeVisible();
  expect(screen.queryByText(`teacher: ${originalId}`)).toBeNull();
  expect(fetcher).toHaveBeenLastCalledWith("/api/content-publish?classId=ea-class-a&assignmentId=ea-task-b", expect.objectContaining({ cache: "no-store" }));
});

it("lets the teacher recover from a failed published list request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(response(originalId)));
  render(<PublishedSlidesList classId="ea-class-a" assignmentId="ea-task-b" refreshVersion={0} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Published slides could not be loaded");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Read slides" })).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
});
