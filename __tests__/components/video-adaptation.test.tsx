// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import VideoAdaptation from "@/app/components/VideoAdaptation";
import type { ContentItem } from "@/lib/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps a manual video adaptation result and Undo visible after the request completes", async () => {
  const original: ContentItem = { id: "gallery-copy-example", type: "activity", strategy: "analogy", title: "Original activity", body: "Original text" };
  const adapted = { ...original, title: "Adapted activity", body: "Adapted text" };
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: adapted }) });
  vi.stubGlobal("fetch", request);
  function Harness() {
    const [item, setItem] = useState(original);
    return <><h1>{item.title}</h1><VideoAdaptation scope={{ classId: "", assignmentId: "" }} item={item} onChange={setItem} onBusyChange={() => {}} /></>;
  }
  render(<Harness />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Adapt with AI"));
  fireEvent.click(screen.getByRole("button", { name: "Adapt activity text" }));
  await screen.findByRole("heading", { name: "Adapted activity" });
  expect(screen.getByText("Adapt with AI").closest("details")?.open).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Undo AI edit" }));
  await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Original activity"));
  expect(request).toHaveBeenCalledOnce();
});

it("repins an older video's class snapshot without changing its own curriculum or experience", async () => {
  const original: ContentItem = { id: "gallery-copy-legacy", type: "activity", strategy: "analogy", lessonNumber: 3, focus: { coreIdeas: [1] }, title: "Legacy material", body: "Original text",
    teachingContext: { experienceContext: "The copy's chosen analogue", gradeBand: "High school" } };
  const contextRef = "a".repeat(64);
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: original }) });
  vi.stubGlobal("fetch", request);
  render(<VideoAdaptation scope={{ classId: "other-class", assignmentId: "other-task" }} item={original} currentContextRef={contextRef}
    onChange={() => {}} onBusyChange={() => {}} />);
  fireEvent.click(screen.getByText("Adapt with AI"));
  fireEvent.click(screen.getByRole("button", { name: "Adapt using current class information" }));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  const sent = JSON.parse(request.mock.calls[0][1].body);
  expect(sent.item).toEqual(original);
  expect(sent.teachingContext).toEqual({ ...original.teachingContext, contextRef });
});
