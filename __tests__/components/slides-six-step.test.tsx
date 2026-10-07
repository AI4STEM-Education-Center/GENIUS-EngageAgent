// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/auth";
import { INITIAL_MODEL_CATALOG } from "@/lib/slides/models";
import { sixStepDeck, sixStepDraft, tinyJpeg } from "../fixtures/analogy-six-step";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), decode: vi.fn(), download: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/slides/draft-storage", async importOriginal => ({ ...await importOriginal<object>(), loadSlideDraft: mocks.load, saveSlideDraft: mocks.save }));
vi.mock("@/lib/slides/export", () => ({ downloadPresentation: mocks.download, decodeSlideAsset: mocks.decode }));
import SlidesWorkspace from "@/app/components/SlidesWorkspace";

const user: UserContext = { geniusId: "teacher", userId: "teacher", name: "Teacher", email: null, role: "teacher", classId: "ea-class-a", assignmentId: "ea-task-a" };
const reply = (data: unknown) => ({ ok: true, json: async () => data });
const bodies = (endpoint: string) => mocks.fetch.mock.calls.filter(([path]) => path === endpoint).map(([, init]) => JSON.parse(init.body));
let includeLimits = false;
let phenomenonData = tinyJpeg;

beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockResolvedValue(null); mocks.save.mockResolvedValue(undefined);
  includeLimits = false;
  phenomenonData = tinyJpeg;
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const context = { font: "", measureText: (text: string) => ({ width: text.length * Number(context.font.match(/(\d+)px/u)?.[1] ?? 16) * .53 }) };
    return context as never;
  });
  mocks.decode.mockImplementation(async value => value);
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/slides?")) return reply({ lessons: [{ lessonNumber: 5, lessonTitle: "Contact forces", learningObjective: "Trace support loads" }], models: INITIAL_MODEL_CATALOG });
    if (path.endsWith("/check")) return reply({ issues: [] });
    if (path.endsWith("/image")) {
      const request = JSON.parse(init!.body as string);
      return reply({ asset: { data: request.visualId === "phenomenon" ? phenomenonData : tinyJpeg, width: 1536, height: 1024 } });
    }
    return reply({ draft: sixStepDraft(includeLimits) });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function generate() {
  render(<SlidesWorkspace user={user} />);
  await screen.findByRole("option", { name: "5. Contact forces" });
  expect(screen.queryByLabelText("Analogy story")).toBeNull();
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText(`${includeLimits ? 7 : 6} slides ready to send.`);
}

it.each([false, true])("previews all six-step pages with limits=%s and uses a matching teacher review count", async boundary => {
  includeLimits = boundary;
  await generate();
  expect(bodies("/api/slides")[0].analogyMethod).toBe("six-step");
  const imageRequests = bodies("/api/slides/image");
  expect(imageRequests.map(body => body.visualId)).toEqual(["phenomenon", "analogue", "target"]);
  expect(imageRequests[2].referenceAsset.data).toBe(phenomenonData);
  const targetCheck = bodies("/api/slides/check").find(body => body.visualId === "target");
  expect(targetCheck).toMatchObject({ phenomenonAsset: { data: phenomenonData }, referenceAsset: { data: tinyJpeg }, asset: { data: tinyJpeg } });
  const count = boundary ? 7 : 6;
  const preview = screen.getByRole("region", { name: "Slide preview" });
  for (let page = 1; page <= count; page++) {
    expect(within(preview).getByText(`${page} / ${count}`)).toBeTruthy();
    expect(preview.querySelectorAll("image")).toHaveLength(page <= 3 ? 1 : page === count ? 0 : 2);
    expect(screen.queryByLabelText("Visible comparison hint")).toBeNull();
    expect(screen.queryByLabelText("Student response starter") !== null).toBe(page === 4);
    expect(within(preview).queryByText("MY QUESTION") !== null).toBe(page === count);
    if (page < count) fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  }
  expect((screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement).disabled).toBe(true);
  const checkbox = screen.getByRole("checkbox", { name: `I have reviewed all ${count} slides and their images.` });
  expect((checkbox as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(checkbox);
  expect((screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps six-step revision routing while adding a seventh page and updates the final question position", async () => {
  await generate();
  includeLimits = true;
  fireEvent.change(screen.getByLabelText("Revision request"), { target: { value: "Clarify that fixed supports cannot adjust their grip." } });
  fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
  await screen.findByText("7 slides ready to send.");
  expect(bodies("/api/slides")[1]).toMatchObject({ operation: "review", analogyMethod: "six-step", draft: { analogyMethod: "six-step" } });
  expect(screen.queryByLabelText("Analogy story")).toBeNull();
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  const preview = screen.getByRole("region", { name: "Slide preview" });
  expect(within(preview).getByText("6 / 7")).toBeTruthy();
  expect(within(preview).queryByText("MY QUESTION")).toBeNull();
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Could both adjust?");
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(within(preview).getByText("7 / 7")).toBeTruthy();
  expect(within(preview).getByText("MY QUESTION")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "I have reviewed all 7 slides and their images." })).toBeTruthy();
});

it("permits existing images with stale plans and optionally refreshes dependent target using the new reference", async () => {
  const saved = sixStepDeck(); saved.assets.phenomenon.sourcePrompt = "Earlier phenomenon image plan";
  mocks.load.mockResolvedValue(saved);
  render(<SlidesWorkspace user={user} />);
  await screen.findByText(/Saved draft restored/);
  const download = screen.getByRole("button", { name: "Download PPTX" }) as HTMLButtonElement;
  expect(download.disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Regenerate target image" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("region", { name: "Image recovery" })).toBeTruthy();
  phenomenonData = "data:image/jpeg;base64,/9j/4AE=";
  fireEvent.click(screen.getByRole("button", { name: "Regenerate phenomenon image" }));
  await screen.findByText("Image updated. Review suggestions are optional.");
  expect(download.disabled).toBe(false);
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  expect((screen.getByRole("checkbox") as HTMLButtonElement).disabled).toBe(false);
  expect(bodies("/api/slides/image").map(body => body.visualId)).toEqual(["phenomenon"]);
  fireEvent.click(screen.getByRole("button", { name: "Regenerate target image" }));
  await screen.findByText("Image updated. Review suggestions are optional.");
  await waitFor(() => expect((screen.getByRole("checkbox") as HTMLButtonElement).disabled).toBe(false));
  expect(bodies("/api/slides/image").at(-1)).toMatchObject({ visualId: "target", referenceAsset: { data: phenomenonData } });
  expect(bodies("/api/slides/check").at(-1)).toMatchObject({ visualId: "target", phenomenonAsset: { data: phenomenonData }, referenceAsset: { data: tinyJpeg } });
  expect(bodies("/api/slides/image").filter(body => body.visualId === "analogue")).toHaveLength(0);
  expect(screen.queryByRole("region", { name: "Image recovery" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(download.disabled).toBe(false);
});

it("keeps the question editor available when automatic repair removes page seven while the teacher is viewing it", async () => {
  includeLimits = true;
  const originalFetch = mocks.fetch.getMockImplementation()!;
  let resolveRepair: ((response: ReturnType<typeof reply>) => void) | undefined;
  let firstTextCheck = true;
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/slides" && JSON.parse(init!.body as string).operation === "review") {
      return new Promise(resolve => { resolveRepair = resolve; });
    }
    if (path === "/api/slides/check" && !JSON.parse(init!.body as string).visualId && firstTextCheck) {
      firstTextCheck = false;
      return reply({ issues: ["Omit the unnecessary boundary and keep the learner question last."] });
    }
    return originalFetch(path, init);
  });
  render(<SlidesWorkspace user={user} />);
  await screen.findByRole("option", { name: "5. Contact forces" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate slides" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate slides" }));
  await screen.findByText("Correcting slide content and layout...");
  await waitFor(() => expect(resolveRepair).toBeTypeOf("function"));
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
  expect(within(screen.getByRole("region", { name: "Slide preview" })).getByText("7 / 7")).toBeTruthy();
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Your question about supports");
  await act(async () => { resolveRepair!(reply({ draft: sixStepDraft() })); });
  await screen.findByText("6 slides ready to send.");
  const preview = screen.getByRole("region", { name: "Slide preview" });
  expect(within(preview).getByText("6 / 6")).toBeTruthy();
  expect(within(preview).getByText("MY QUESTION")).toBeTruthy();
  expect((screen.getByLabelText("Slide title") as HTMLTextAreaElement).value).toBe("Your question about supports");
  expect((screen.getByRole("button", { name: "Next slide" }) as HTMLButtonElement).disabled).toBe(true);
});
