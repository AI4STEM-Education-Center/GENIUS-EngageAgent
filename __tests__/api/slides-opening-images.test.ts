import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ begin: vi.fn(), complete: vi.fn(), generate: vi.fn(), edit: vi.fn(), session: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/slides/jobs", async original => {
  const actual = await original<typeof import("@/lib/slides/jobs")>();
  const { installSlideJobHarness, beginTestSlideJob, completedImageResponse } = await import("../fixtures/slide-job-harness");
  installSlideJobHarness(actual.finishSlideJob, async (params, spec) => {
    if (spec.kind !== "image") return mocks.complete(params);
    const tool = params.tools?.find(value => value.type === "image_generation");
    const result = await (tool?.type === "image_generation" && "action" in tool && tool.action === "edit" ? mocks.edit : mocks.generate)(params);
    return completedImageResponse(result) as import("openai").default.Responses.Response;
  });
  return { ...actual, beginSlideJob: mocks.begin.mockImplementation(beginTestSlideJob) };
});
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: (request: Request) => request.headers.get("origin") === "http://localhost" }));
vi.mock("@/lib/workspace", async original => ({ ...await original<object>(), workspaceContext: mocks.context }));
import { POST as startImage } from "@/app/api/slides/image/route";
import { POST as startCheck } from "@/app/api/slides/check/route";
import { cognitiveConflictOpeningDraft, slideFixture, tinyImage } from "../fixtures/slides";
import { tinyJpeg } from "../fixtures/analogy-six-step";
import { completedTextResponse, finishSlideRoute } from "../fixtures/slide-job-harness";

const base = { classId: "ea-class-test", assignmentId: "ea-task-test", lessonNumber: 3, strategy: "cognitive conflict" };
const request = (data: unknown) => new Request("http://localhost/api/slides", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify(data) });
const image = (data: unknown) => finishSlideRoute(startImage, request(data));
const check = (data: unknown) => finishSlideRoute(startCheck, request(data));
const reference = { data: tinyJpeg, width: 1536, height: 1024 };

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("OPENAI_API_KEY", "test-key");
  mocks.session.mockResolvedValue({ role: "teacher", geniusId: "teacher-test" });
  mocks.context.mockResolvedValue({});
  mocks.complete.mockResolvedValue(completedTextResponse({ issues: [] }));
  const result = { data: [{ b64_json: tinyJpeg.split(",")[1] }] };
  mocks.generate.mockResolvedValue(result); mocks.edit.mockResolvedValue(result);
});
afterEach(() => vi.unstubAllEnvs());

it("generates the opening independently and derives later evidence from the actual setup JPEG", async () => {
  const draft = cognitiveConflictOpeningDraft();
  expect((await image({ ...base, draft, visualId: "phenomenon" })).status).toBe(200);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  for (const referenceAsset of [undefined, { ...reference, data: tinyImage }, { ...reference, data: "https://example.test/setup.jpg" }, { ...reference, data: "data:image/jpeg;base64,AQID" }]) {
    expect((await image({ ...base, draft, visualId: "evidence", referenceAsset })).status).toBe(422);
  }
  expect(mocks.edit).not.toHaveBeenCalled();
  expect((await image({ ...base, draft, visualId: "evidence", referenceAsset: reference })).status).toBe(200);
  expect(mocks.edit).toHaveBeenCalledTimes(1);
  expect(mocks.edit.mock.calls[0][0].input[0].content[1].image_url).toBe(tinyJpeg);
  expect((await image({ ...base, draft, visualId: "phenomenon", referenceAsset: reference })).status).toBe(400);
});

it("checks outcome continuity against the actual setup and does not accept an unrelated reference on the opening", async () => {
  const draft = cognitiveConflictOpeningDraft();
  const asset = { ...reference, data: "data:image/jpeg;base64,/9j/4AE=" };
  expect((await check({ ...base, draft, visualId: "evidence", asset })).status).toBe(422);
  expect(mocks.complete).not.toHaveBeenCalled();
  expect((await check({ ...base, draft, visualId: "evidence", asset, referenceAsset: reference })).status).toBe(200);
  const content = mocks.complete.mock.calls[0][0].input[0].content;
  expect(content.filter((item: { type: string }) => item.type === "input_image").map((item: { image_url: string }) => item.image_url)).toEqual([reference.data, asset.data]);
  expect(content.map((item: { text?: string }) => item.text ?? "").join(" ")).toContain("PHENOMENON SETUP (first)");
  expect((await check({ ...base, draft, visualId: "phenomenon", asset: reference })).status).toBe(200);
  expect((await check({ ...base, draft, visualId: "phenomenon", asset: reference, referenceAsset: reference })).status).toBe(400);
});

it("continues to generate and check historical evidence-only decks without demanding a missing opening asset", async () => {
  const draft = slideFixture("cognitive conflict");
  expect((await image({ ...base, draft, visualId: "evidence" })).status).toBe(200);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(mocks.edit).not.toHaveBeenCalled();
  expect((await check({ ...base, draft, visualId: "evidence", asset: reference })).status).toBe(200);
  expect(mocks.complete.mock.calls[0][0].input[0].content.filter((item: { type: string }) => item.type === "input_image")).toHaveLength(1);
  expect((await check({ ...base, draft, visualId: "evidence", asset: reference, referenceAsset: reference })).status).toBe(400);
});
