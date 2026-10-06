// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
import { analogyMethodDraft } from "../fixtures/analogy-methods";
import { tinyImage } from "../fixtures/slides";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), decode: vi.fn() }));
vi.mock("@/lib/slides/export", () => ({ downloadPresentation: vi.fn(), decodeSlideAsset: mocks.decode }));
import SlidesWorkspace from "@/app/components/SlidesWorkspace";

const user: UserContext = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher", classId: "ea-class-a", assignmentId: "ea-task-a" };
const reply = (data: unknown) => ({ ok: true, json: async () => data });
const generationRequests = () => mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides").map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const context = { font: "", measureText: (text: string) => ({ width: text.length * Number(context.font.match(/(\d+)px/u)?.[1] ?? 16) * .53 }) };
    return context as never;
  });
  mocks.decode.mockImplementation(async value => value);
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/slides?")) return reply({ lessons: [{ lessonNumber: 5, lessonTitle: "Contact forces", learningObjective: "Compare support loads" }], models: INITIAL_MODEL_CATALOG });
    if (path.endsWith("/check")) return reply({ issues: [] });
    if (path.endsWith("/image")) return reply({ asset: { data: tinyImage, width: 1536, height: 1024 } });
    const request = JSON.parse(init!.body as string);
    return reply({ draft: analogyMethodDraft(request.analogyMethod) });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openWorkspace() {
  render(<SlidesWorkspace user={user} />);
  await screen.findByRole("option", { name: "5. Contact forces" });
}

async function generate() {
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready for review.");
}

it("defaults to six-step while selecting an earlier story does not issue a generation request", async () => {
  await openWorkspace();
  const select = screen.getByLabelText("Analogy story") as HTMLSelectElement;
  expect(select.value).toBe("six-step");
  expect(screen.getByRole("option", { name: "Six-step analogy (recommended)" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Reference five-step story" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Compare and predict" })).toBeTruthy();
  const count = mocks.fetch.mock.calls.length;
  fireEvent.change(select, { target: { value: "predict-transfer" } });
  expect(mocks.fetch).toHaveBeenCalledTimes(count);
  await generate();
  expect(generationRequests().map(request => request.analogyMethod)).toEqual(["predict-transfer"]);
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByLabelText("Visible comparison hint")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.queryByLabelText("Visible comparison hint")).toBeNull();
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Move the same load");
});

it("keeps a generated reference story and its page-three scaffold through picker changes and AI revision", async () => {
  await openWorkspace();
  fireEvent.change(screen.getByLabelText("Analogy story"), { target: { value: "reference-story" } });
  await generate();
  expect(generationRequests().map(request => request.analogyMethod)).toEqual(["reference-story"]);
  expect(screen.queryByLabelText("Visible comparison hint")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Holding a loaded board");
  expect(screen.queryByLabelText("Visible comparison hint")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  const hint = screen.getByLabelText("Visible comparison hint") as HTMLTextAreaElement;
  expect(hint.value).toBe(analogyMethodDraft().analogyPlan!.mappingHint);
  fireEvent.change(hint, { target: { value: "The hands support the board as supports hold the bridge." } });
  const count = mocks.fetch.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Analogy story"), { target: { value: "predict-transfer" } });
  expect(mocks.fetch).toHaveBeenCalledTimes(count);
  expect((screen.getByLabelText("Visible comparison hint") as HTMLTextAreaElement).value).toBe("The hands support the board as supports hold the bridge.");
  expect(screen.getByText(/The current slides and AI revisions keep Reference five-step story/u)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Keep the familiar board before the mapping." } });
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await waitFor(() => expect(generationRequests()).toHaveLength(2));
  const revision = generationRequests()[1];
  expect(revision).toMatchObject({ operation: "review", analogyMethod: "reference-story", draft: { analogyMethod: "reference-story" } });
  expect(revision.draft.analogyPlan.mappingHint).toBe("The hands support the board as supports hold the bridge.");
  await screen.findByText("5 slides ready for review.");
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.queryByLabelText("Student response starter")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByLabelText("Student response starter")).toBeTruthy();
  expect((screen.getByLabelText("Analogy story") as HTMLSelectElement).value).toBe("predict-transfer");
  fireEvent.click(screen.getByRole("button", { name: "Generate new slides" }));
  await waitFor(() => expect(generationRequests()).toHaveLength(3));
  expect(generationRequests()[2]).toMatchObject({ operation: "generate", analogyMethod: "predict-transfer" });
  expect(generationRequests()[2]).not.toHaveProperty("draft");
  await screen.findByText("5 slides ready for review.");
});

it("revises legacy untagged drafts as compare-and-predict even while the picker defaults to six-step", async () => {
  const defaultFetch = mocks.fetch.getMockImplementation()!;
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path !== "/api/slides") return defaultFetch(path, init);
    const draft = analogyMethodDraft("predict-transfer");
    delete draft.analogyMethod;
    return reply({ draft });
  });
  await openWorkspace();
  await generate();
  expect((screen.getByLabelText("Analogy story") as HTMLSelectElement).value).toBe("six-step");
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByLabelText("Visible comparison hint")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await waitFor(() => expect(generationRequests()).toHaveLength(2));
  expect(generationRequests()[1]).toMatchObject({ operation: "review", analogyMethod: "predict-transfer" });
  expect(generationRequests()[1].draft).not.toHaveProperty("analogyMethod");
  await screen.findByText("5 slides ready for review.");
});
