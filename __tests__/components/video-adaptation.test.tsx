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
