// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
import { cognitiveConflictOpeningDraft, deckFixture } from "../fixtures/slides";
import { tinyJpeg } from "../fixtures/analogy-six-step";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), decode: vi.fn(), download: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/slides/draft-storage", async original => ({ ...await original<object>(), loadSlideDraft: mocks.load, saveSlideDraft: mocks.save }));
vi.mock("@/lib/slides/export", () => ({ downloadPresentation: mocks.download, decodeSlideAsset: mocks.decode }));
vi.mock("@/lib/slides/publication-status", async original => ({ ...await original<object>(), isSlideDeckPublished: vi.fn().mockResolvedValue(false) }));
import SlidesWorkspace from "@/app/components/SlidesWorkspace";

const user: UserContext = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher", classId: "ea-class-opening", assignmentId: "ea-task-opening" };
const reply = (data: unknown) => ({ ok: true, json: async () => data });
const bodies = (endpoint: string) => mocks.fetch.mock.calls.filter(([path]) => path === endpoint).map(([, init]) => JSON.parse(init.body));
const openingImage = tinyJpeg;
const evidenceImage = "data:image/jpeg;base64,/9j/4AE=";

beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockResolvedValue(null); mocks.save.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const context = { font: "", measureText: (text: string) => ({ width: text.length * Number(context.font.match(/(\d+)px/u)?.[1] ?? 16) * .5 }) };
    return context as never;
  });
  mocks.decode.mockImplementation(async value => value);
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/slides?")) return reply({ lessons: [{ lessonNumber: 3, lessonTitle: "Contact", learningObjective: "Observe changes in shape" }], models: INITIAL_MODEL_CATALOG });
    if (path.endsWith("/check")) return reply({ issues: [], model: "test-reviewer" });
    if (path.endsWith("/image")) return reply({ asset: { data: JSON.parse(init!.body as string).visualId === "phenomenon" ? openingImage : evidenceImage, width: 1536, height: 1024 } });
    return reply({ draft: cognitiveConflictOpeningDraft() });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("generates the setup before the evidence, sends its actual pixels for generation/review, and previews the proper reveal order", async () => {
  render(<SlidesWorkspace user={user} />);
  await screen.findByRole("option", { name: "3. Contact" });
  fireEvent.change(screen.getByLabelText("Strategy"), { target: { value: "cognitive conflict" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("5 slides ready to send.");
  const imageRequests = bodies("/api/slides/image");
  expect(imageRequests.map(body => body.visualId)).toEqual(["phenomenon", "evidence"]);
  expect(imageRequests[0]).not.toHaveProperty("referenceAsset");
  expect(imageRequests[1].referenceAsset.data).toBe(openingImage);
  expect(bodies("/api/slides/check").find(body => body.visualId === "evidence")).toMatchObject({ referenceAsset: { data: openingImage }, asset: { data: evidenceImage } });
  const preview = screen.getByRole("region", { name: "Slide preview" });
  for (let page = 1; page <= 5; page++) {
    expect(within(preview).getByText(`${page} / 5`)).toBeTruthy();
    expect(preview.querySelectorAll("image")).toHaveLength(page === 5 ? 0 : 1);
    if (page < 5) expect(preview.querySelector("image")?.getAttribute("href")).toBe(page <= 2 ? openingImage : evidenceImage);
    if (page < 5) fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  }
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
});

it("restores a historical deck without generating or requiring a missing phenomenon image", async () => {
  mocks.load.mockResolvedValue(deckFixture("cognitive conflict"));
  render(<SlidesWorkspace user={user} embeddedContext={{ lessonNumber: 3, strategy: "cognitive conflict" }} />);
  await screen.findByText(/Saved draft restored/);
  expect(screen.getByRole("region", { name: "Slide preview" }).querySelector("image")).toBeNull();
  expect(bodies("/api/slides/image")).toHaveLength(0);
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
});
