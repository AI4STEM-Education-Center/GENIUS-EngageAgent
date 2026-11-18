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
it("automatically detects a GENIUS update on return without replacing the accepted context", async () => {
  fetcher.mockResolvedValueOnce(response(snapshot("old"))).mockResolvedValueOnce(response(snapshot("new")));
  render(<Harness />); await screen.findByText(/Summary old/);
  fireEvent.focus(window);
  await screen.findByRole("button", { name: "Use updated information" });
  expect(screen.getByLabelText("Accepted context").textContent).toBe("old");
  expect(screen.getByText(/Summary old/).textContent).toContain("My manual supplement");
});
it("does not retain an accepted snapshot when the connected GENIUS source class changes", async () => {
  fetcher.mockResolvedValueOnce(response({ ...snapshot("old"), geniusClassId: "class-one" }))
    .mockResolvedValueOnce(response({ ...snapshot("new"), geniusClassId: "class-two" }));
  render(<Harness />); await screen.findByText(/Summary old/);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByLabelText("Accepted context").textContent).toBe("new"));
  expect(screen.queryByText(/Summary old/)).toBeNull();
});

it("clears a stale label automatically after the same inputs are recovered", async () => {
  const original = { ...snapshot("original"), geniusClassId: "class-one", profile: { provider: "genius", status: "ready", value: { locale: "rural", englishLearners: true } } };
  fetcher.mockResolvedValueOnce(response({ ...original, id: "cached", profile: { ...original.profile, status: "stale" }, experiences: { ...original.experiences, status: "stale" } }))
    .mockResolvedValueOnce(response({ ...original, id: "recovered", profile: { ...original.profile, syncedAt: "later", value: { englishLearners: true, locale: "rural" } } }));
  render(<Harness />); await screen.findByRole("alert");
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByLabelText("Accepted context").textContent).toBe("recovered"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/using the last available/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Use updated information" })).toBeNull();
  expect(screen.getByText(/Summary original/).textContent).toContain("My manual supplement");
});

it("retains the accepted inputs during a failure and clears the warning on recovery", async () => {
  const original = snapshot("original");
  fetcher.mockResolvedValueOnce(response(original))
    .mockResolvedValueOnce(response({ ...original, id: "stale", profile: { ...original.profile, status: "stale" } }))
    .mockResolvedValueOnce(response({ ...original, id: "recovered" }));
  render(<Harness />); await screen.findByText(/Summary original/);
  fireEvent.focus(window); await screen.findByRole("alert");
  expect(screen.getByLabelText("Accepted context").textContent).toBe("original");
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.queryByRole("button", { name: "Use updated information" })).toBeNull();
});

it("still requires acceptance when recovered data contains changed experience counts", async () => {
  const original = { ...snapshot("original", "stale"), experiences: { provider: "genius", status: "stale", value: { responseCount: 1, activities: [] } } };
  fetcher.mockResolvedValueOnce(response(original)).mockResolvedValueOnce(response({ ...original, id: "changed", profile: { ...original.profile, status: "ready" }, experiences: { ...original.experiences, status: "ready", value: { responseCount: 2, activities: [] } } }));
  render(<Harness />); await screen.findByRole("alert");
  fireEvent.focus(window);
  await screen.findByRole("button", { name: "Use updated information" });
  expect(screen.getByLabelText("Accepted context").textContent).toBe("original");
});
