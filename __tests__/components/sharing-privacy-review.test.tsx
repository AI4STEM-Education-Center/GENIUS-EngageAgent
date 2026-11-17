// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SharingPrivacyReview from "@/app/components/SharingPrivacyReview";
vi.mock("@/lib/client-auth", () => ({ scopedClientAuthHeaders: () => ({}) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("requires explicit review and never applies a suggestion over newer teacher text", async () => {
  const onApply = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ edits: [{ field: "title", after: "Ask a student", reason: "Remove a name" }] }) })));
  const props = { scope: { classId: "c", assignmentId: "a" }, onApply };
  const view = render(<SharingPrivacyReview {...props} value={{ title: "Ask Alex" }} />);
  fireEvent.click(screen.getByText("Remove class details · text assistance"));
  fireEvent.click(screen.getByRole("button", { name: "Suggest text cleanup" }));
  await screen.findByRole("button", { name: "Apply selected changes" });
  expect(onApply).not.toHaveBeenCalled();
  view.rerender(<SharingPrivacyReview {...props} value={{ title: "My later edit" }} />);
  expect(screen.getByText(/The text changed/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Apply selected changes" })).toBeNull();
});
