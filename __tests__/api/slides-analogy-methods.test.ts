import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ begin: vi.fn(), complete: vi.fn(), generate: vi.fn(), edit: vi.fn(), session: vi.fn(), context: vi.fn(), answers: vi.fn() }));
vi.mock("@/lib/slides/jobs", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/slides/jobs")>();
  const { installSlideJobHarness, beginTestSlideJob, completedImageResponse } = await import("../fixtures/slide-job-harness");
  installSlideJobHarness(actual.finishSlideJob, async (params, spec, request) => {
    if (spec.kind === "image") {
      const tool = params.tools?.find(value => value.type === "image_generation");
      const reply = await (tool?.type === "image_generation" && "action" in tool && tool.action === "edit" ? mocks.edit : mocks.generate)(params, { signal: request.signal });
      return completedImageResponse(reply) as import("openai").default.Responses.Response;
    }
    return mocks.complete(params, { signal: request.signal });
  });
  return { ...actual, beginSlideJob: mocks.begin.mockImplementation(beginTestSlideJob) };
});
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: (request: Request) => request.headers.get("origin") === "http://localhost" }));
vi.mock("@/lib/workspace", async importOriginal => ({ ...await importOriginal<object>(), workspaceContext: mocks.context }));
vi.mock("@/lib/nosql", () => ({ listStudentAnswers: mocks.answers }));

import { POST as startDraft } from "@/app/api/slides/route";
import { POST as startCheck } from "@/app/api/slides/check/route";
import { POST as startImage } from "@/app/api/slides/image/route";
import { analogyPromptRevision } from "@/lib/slides/prompt-versions";
import { analogyMethodDeck, analogyMethodDraft } from "../fixtures/analogy-methods";

import { finishSlideRoute, completedTextResponse } from "../fixtures/slide-job-harness";
const POST = (request: Request) => finishSlideRoute(startDraft, request);
const image = (request: Request) => finishSlideRoute(startImage, request);
const check = (request: Request) => finishSlideRoute(startCheck, request);

const base = { classId: "ea-class-test", assignmentId: "ea-task-test", lessonNumber: 5, strategy: "analogy" };
const request = (data: unknown) => new Request("http://localhost/api/slides", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify(data) });
const completion = completedTextResponse;
const generated = (method: "reference-story" | "predict-transfer" = "reference-story") => {
  const draft = analogyMethodDraft(method);
  delete draft.analogyMethod; // Application-owned metadata is absent from model output.
  return draft;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  for (const key of ["OPENAI_MODEL", "OPENAI_SLIDES_MODEL", "OPENAI_IMAGE_MODEL"]) vi.stubEnv(key, "");
  mocks.session.mockResolvedValue({ role: "teacher", geniusId: "teacher-test" });
  mocks.context.mockResolvedValue({});
  mocks.answers.mockResolvedValue([]);
  mocks.complete.mockResolvedValue(completion(generated()));
  mocks.generate.mockResolvedValue({ data: [{ b64_json: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64") }] });
});
afterEach(() => vi.unstubAllEnvs());

it.each(["reference", "optimized"] as const)("injects the selected reference method into %s output and asks for only its two image plans", async promptVersion => {
  const response = await POST(request({ ...base, analogyMethod: "reference-story", promptVersion }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.draft.analogyMethod).toBe("reference-story");
  expect(body.draft.visuals.map((visual: { id: string }) => visual.id)).toEqual(["analogue", "target"]);
  expect(body.promptProvenance).toMatchObject({ version: promptVersion, analogyMethod: "reference-story", revision: analogyPromptRevision("reference-story") });
  const call = mocks.complete.mock.calls[0][0];
  const schema = call.text.format.schema;
  expect(schema.properties).not.toHaveProperty("analogyMethod");
  expect(schema.properties.visuals.minItems).toBe(2);
  expect(schema.properties.visuals.maxItems).toBe(2);
  expect(schema.properties.analogyPlan.properties).not.toHaveProperty("changedInput");
  expect(schema.properties.slides.items.anyOf[2].properties.stage.enum).toEqual(["mapping"]);
  expect(JSON.parse(call.input[0].content).appOwnedImagePlacement[1]).toEqual({ slide: 2, images: ["analogue"] });
  expect(mocks.complete).toHaveBeenCalledTimes(1);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("preserves the legacy omitted-method API default and records its distinct provenance", async () => {
  mocks.complete.mockResolvedValue(completion(generated("predict-transfer")));
  const response = await POST(request(base));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.draft.analogyMethod).toBe("predict-transfer");
  expect(body.draft.visuals).toHaveLength(3);
  expect(body.promptProvenance.revision).toBe(analogyPromptRevision("predict-transfer"));
  expect(body.promptProvenance.revision).not.toBe(analogyPromptRevision("reference-story"));
});

it("rejects invalid or cross-strategy method selections before provider calls", async () => {
  for (const analogyMethod of [null, {}, [], "", "reference", "../reference-story"]) {
    expect((await POST(request({ ...base, analogyMethod }))).status).toBe(400);
  }
  expect((await POST(request({ ...base, strategy: "cognitive conflict", analogyMethod: "reference-story" }))).status).toBe(400);
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.answers).not.toHaveBeenCalled();
});

it("derives the reference method from a revision draft when the caller omits the selection", async () => {
  const draft = analogyMethodDraft();
  const response = await POST(request({ ...base, operation: "review", draft, feedback: "Keep the familiar activation before mapping." }));
  expect(response.status).toBe(200);
  expect((await response.json()).draft.analogyMethod).toBe("reference-story");
  const call = mocks.complete.mock.calls[0][0];
  expect(call.text.format.schema.properties.visuals.minItems).toBe(2);
  expect(JSON.parse(call.input[0].content).appOwnedImagePlacement[2]).toEqual({ slide: 3, images: ["analogue", "target"] });
});

it("rejects an explicit method change on reference and legacy revision drafts before any provider call", async () => {
  const legacy = analogyMethodDraft("predict-transfer");
  delete legacy.analogyMethod;
  for (const [draft, analogyMethod] of [[analogyMethodDraft(), "predict-transfer"], [legacy, "reference-story"]] as const) {
    expect((await POST(request({ ...base, operation: "review", draft, analogyMethod }))).status).toBe(422);
  }
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.answers).not.toHaveBeenCalled();
});

it("does not allow the provider to return conflicting method metadata or the other story's structure", async () => {
  for (const [output, status] of [[{ ...generated(), analogyMethod: "predict-transfer" }, 502], [generated("predict-transfer"), 422]] as const) {
    mocks.complete.mockResolvedValueOnce(completion(output));
    const response = await POST(request({ ...base, analogyMethod: "reference-story" }));
    expect(response.status).toBe(status);
    expect(await response.json()).not.toHaveProperty("draft");
  }
});

it.each(["text-check", "image-check", "image-generation"] as const)("rejects a mismatched story for %s before billing", async operation => {
  const deck = analogyMethodDeck();
  const body = { ...base, draft: deck.draft, analogyMethod: "predict-transfer" };
  const response = operation === "image-generation"
    ? await image(request({ ...body, visualId: "analogue" }))
    : await check(request({ ...body, ...(operation === "image-check" ? { visualId: "target", asset: deck.assets.target, referenceAsset: deck.assets.analogue } : {}) }));
  expect(response.status).toBe(422);
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.edit).not.toHaveBeenCalled();
});

it("grounds reference target image review in the actual third-page scaffold and ordered image pair", async () => {
  const deck = analogyMethodDeck();
  const familiar = { ...deck.assets.analogue, data: "data:image/png;base64,AQID" };
  mocks.complete.mockResolvedValueOnce(completion({ issues: [] }));
  const response = await check(request({ ...base, draft: deck.draft, visualId: "target", asset: deck.assets.target, referenceAsset: familiar }));
  expect(response.status).toBe(200);
  const content = mocks.complete.mock.calls[0][0].input[0].content;
  const context = JSON.parse(content[0].text);
  expect(context.mappingSlide).toEqual(deck.draft.slides[2]);
  expect(context.mappingSlide).not.toEqual(deck.draft.slides[1]);
  expect(context.openingSlide).toEqual(deck.draft.slides[0]);
  expect(context.studentScaffold).toEqual({ hint: deck.draft.analogyPlan!.mappingHint, starter: deck.draft.analogyPlan!.responseStarter });
  expect(content.filter((part: { type: string }) => part.type === "input_image").map((part: { image_url: string }) => part.image_url)).toEqual([familiar.data, deck.assets.target.data]);
  expect(mocks.complete).toHaveBeenCalledTimes(1);
});

it("allows only the two reference pictures and never asks the image service for a variation", async () => {
  const draft = analogyMethodDraft();
  expect((await image(request({ ...base, draft, visualId: "variation" }))).status).toBe(400);
  expect(mocks.generate).not.toHaveBeenCalled();
  for (const visualId of ["analogue", "target"]) {
    expect((await image(request({ ...base, draft, visualId }))).status).toBe(200);
  }
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  expect(mocks.edit).not.toHaveBeenCalled();
});
