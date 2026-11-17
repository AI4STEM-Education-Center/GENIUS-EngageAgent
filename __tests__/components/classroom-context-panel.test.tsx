// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ClassroomContextPanel, { useClassroomContext } from "@/app/components/ClassroomContextPanel";
vi.mock("@/lib/client-auth", () => ({ scopedClientAuthHeaders: () => ({}) }));
const fetcher = vi.fn();
function Harness({ classId = "class-a" }: { classId?: string }) {
  const context = useClassroomContext(classId, "task", true);
  return <><output aria-label="Accepted context">{context.accepted?.id}</output><ClassroomContextPanel context={context} supplement="My manual supplement" /></>;
}
const snapshot = (id: string, status = "ready") => ({ id, geniusConnected: true, summary: `Summary ${id}`, profile: { provider: "genius", status }, experiences: { provider: "genius", status } });
const response = (context: unknown) => ({ ok: true, json: async () => ({ context }) });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("requires acceptance of new data and preserves the teacher supplement", async () => {
  fetcher.mockResolvedValueOnce(response(snapshot("old"))).mockResolvedValueOnce(response(snapshot("new")));
  render(<Harness />); await waitFor(() => expect(screen.getByLabelText("Accepted context").textContent).toBe("old"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use updated information" }));
  expect(screen.getByLabelText("Accepted context").textContent).toBe("new");
  expect(screen.getByText(/Summary new/).textContent).toContain("My manual supplement");
});
it("clears revoked context immediately instead of retaining sensitive cached data", async () => {
  fetcher.mockResolvedValueOnce(response(snapshot("old"))).mockResolvedValueOnce(response({ ...snapshot("denied", "forbidden"), summary: "" }));
  render(<Harness />); await waitFor(() => expect(screen.getByLabelText("Accepted context").textContent).toBe("old"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByLabelText("Accepted context").textContent).toBe("denied"));
  expect(screen.queryByText(/Summary old/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Use updated information" })).toBeNull();
});
it("isolates class changes from an earlier request that resolves late", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  fetcher.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(response(snapshot("class-b")));
  const view = render(<Harness />); view.rerender(<Harness classId="class-b" />);
  await waitFor(() => expect(screen.getByLabelText("Accepted context").textContent).toBe("class-b"));
  resolveOld(response(snapshot("class-a")));
  await waitFor(() => expect(screen.getByLabelText("Accepted context").textContent).toBe("class-b"));
});
