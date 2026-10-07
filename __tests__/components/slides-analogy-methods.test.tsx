// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
import { analogyMethodDeck, analogyMethodDraft } from "../fixtures/analogy-methods";
import { sixStepDraft } from "../fixtures/analogy-six-step";
import { tinyImage } from "../fixtures/slides";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), decode: vi.fn(), load: vi.fn(), save: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/slides/export", () => ({ downloadPresentation: mocks.download, decodeSlideAsset: mocks.decode }));
vi.mock("@/lib/slides/draft-storage", async importOriginal => ({ ...await importOriginal<object>(), loadSlideDraft: mocks.load, saveSlideDraft: mocks.save }));
import SlidesWorkspace from "@/app/components/SlidesWorkspace";

const user: UserContext = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher", classId: "ea-class-a", assignmentId: "ea-task-a" };
const reply = (data: unknown) => ({ ok: true, json: async () => data });
const generationRequests = () => mocks.fetch.mock.calls.filter(([path]) => path === "/api/slides").map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(null); mocks.save.mockResolvedValue(undefined);
  mocks.download.mockResolvedValue({ url: "blob:deck", fileName: "slides.pptx" });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { revokeObjectURL: vi.fn() }));
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
    return reply({ draft: request.analogyMethod === "six-step" ? sixStepDraft() : analogyMethodDraft(request.analogyMethod) });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function restore(method: "reference-story" | "predict-transfer", legacy = false) {
  const saved = analogyMethodDeck(method);
  if (legacy) delete saved.draft.analogyMethod;
  mocks.load.mockResolvedValue(saved);
  render(<SlidesWorkspace user={user} />);
  await screen.findByText(/Saved draft restored/);
  expect(generationRequests()).toHaveLength(0);
  return saved;
}

it("restores a compare-and-predict story with its original mapping and prediction pages", async () => {
  await restore("predict-transfer");
  expect(screen.queryByLabelText("Analogy story")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByLabelText("Visible comparison hint")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.queryByLabelText("Visible comparison hint")).toBeNull();
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Move the same load");
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready for review.");
  expect(generationRequests()).toHaveLength(1);
  expect(generationRequests()[0]).toMatchObject({ operation: "review", analogyMethod: "predict-transfer", draft: { analogyMethod: "predict-transfer" } });
});

it("keeps a restored reference story and student scaffold through revision, then uses six-step for a new generation", async () => {
  const saved = await restore("reference-story");
  expect(screen.queryByLabelText("Visible comparison hint")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Holding a loaded board");
  expect(screen.queryByLabelText("Visible comparison hint")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  const hint = screen.getByLabelText("Visible comparison hint") as HTMLTextAreaElement;
  expect(hint.value).toBe(saved.draft.analogyPlan!.mappingHint);
  fireEvent.change(hint, { target: { value: "The hands support the board as supports hold the bridge." } });
  fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Keep the familiar board before the mapping." } });
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("5 slides ready for review.");
  const revision = generationRequests()[0];
  expect(revision).toMatchObject({ operation: "review", analogyMethod: "reference-story", draft: { analogyMethod: "reference-story" } });
  expect(revision.draft.analogyPlan.mappingHint).toBe("The hands support the board as supports hold the bridge.");
  expect(revision.draft.analogyPlan.targetConcept).toBe(saved.draft.analogyPlan!.targetConcept);
  expect(screen.queryByText("Teaching design for this comparison")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.queryByLabelText("Student response starter")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByLabelText("Student response starter")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Download PPTX" }));
  await screen.findByRole("link", { name: "Save PPTX file" });
  expect(mocks.download.mock.calls[0][0].draft.analogyPlan).toEqual(analogyMethodDraft("reference-story").analogyPlan);
  expect(mocks.download.mock.calls[0][0].draft.slides[0].teacherNotes).toEqual(saved.draft.slides[0].teacherNotes);
  fireEvent.click(screen.getByRole("button", { name: "Generate new slides" }));
  await screen.findByText("6 slides ready for review.");
  expect(generationRequests()).toHaveLength(2);
  expect(generationRequests()[1]).toMatchObject({ operation: "generate", analogyMethod: "six-step", promptVersion: "optimized", textModel: "current" });
  expect(generationRequests()[1]).not.toHaveProperty("draft");
});

it("revises legacy untagged drafts as compare-and-predict while new generation remains six-step", async () => {
  await restore("predict-transfer", true);
  expect(screen.queryByLabelText("Analogy story")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByLabelText("Visible comparison hint")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await waitFor(() => expect(generationRequests()).toHaveLength(1));
  expect(generationRequests()[0]).toMatchObject({ operation: "review", analogyMethod: "predict-transfer" });
  expect(generationRequests()[0].draft).not.toHaveProperty("analogyMethod");
  await screen.findByText("5 slides ready for review.");
});
