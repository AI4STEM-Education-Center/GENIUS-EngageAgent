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
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { analogyMethodDraft } from "../fixtures/analogy-methods";
import { sixStepDeck, sixStepDraft, tinyJpeg } from "../fixtures/analogy-six-step";

import { finishSlideRoute, completedTextResponse } from "../fixtures/slide-job-harness";
const POST = (request: Request) => finishSlideRoute(startDraft, request);
const image = (request: Request) => finishSlideRoute(startImage, request);
const check = (request: Request) => finishSlideRoute(startCheck, request);

const base = { classId: "ea-class-test", assignmentId: "ea-task-test", lessonNumber: 5, strategy: "analogy" };
const request = (data: unknown) => new Request("http://localhost/api/slides", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify(data) });
const completion = completedTextResponse;
const output = (includeLimits = false) => {
  const draft = sixStepDraft(includeLimits);
  delete draft.analogyMethod;
  return draft;
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  for (const key of ["OPENAI_MODEL", "OPENAI_SLIDES_MODEL", "OPENAI_IMAGE_MODEL"]) vi.stubEnv(key, "");
  mocks.session.mockResolvedValue({ role: "teacher", geniusId: "teacher-test" });
  mocks.context.mockResolvedValue({});
  mocks.answers.mockResolvedValue([]);
  mocks.complete.mockResolvedValue(completion(output()));
  const imageReply = { data: [{ b64_json: tinyJpeg.split(",")[1] }] };
  mocks.generate.mockResolvedValue(imageReply);
  mocks.edit.mockResolvedValue(imageReply);
});
afterEach(() => vi.unstubAllEnvs());

it.each([false, true])("accepts a six-step model output with limits=%s and injects its selected method", async includeLimits => {
  mocks.complete.mockResolvedValueOnce(completion(output(includeLimits)));
  const response = await POST(request({ ...base, analogyMethod: "six-step" }));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.draft.analogyMethod).toBe("six-step");
  expect(result.draft.slides).toHaveLength(includeLimits ? 7 : 6);
  expect(result.promptProvenance).toMatchObject({ analogyMethod: "six-step", revision: analogyPromptRevision("six-step"), sourceSha256: (await loadSlideSource("analogy", "six-step")).sha256 });
  const schema = mocks.complete.mock.calls[0][0].text.format.schema;
  expect(schema.properties.slides).toMatchObject({ minItems: 6, maxItems: 7 });
  expect(schema.properties).not.toHaveProperty("analogyMethod");
  expect(mocks.complete).toHaveBeenCalledTimes(1);
});

it("rejects a count/boundary mismatch returned by the model rather than returning a partial teaching sequence", async () => {
  const incomplete = output();
  incomplete.analogyPlan!.boundaryDecision = "include";
  mocks.complete.mockResolvedValueOnce(completion(incomplete));
  const response = await POST(request({ ...base, analogyMethod: "six-step" }));
  expect(response.status).toBe(422);
  expect(await response.json()).not.toHaveProperty("draft");
});

it("uses the new six-step source verbatim for A and method-specific criteria in text review", async () => {
  const source = await loadSlideSource("analogy", "six-step");
  const oldSource = await loadSlideSource("analogy");
  expect(source.sha256).not.toBe(oldSource.sha256);
  expect((await POST(request({ ...base, analogyMethod: "six-step", promptVersion: "reference" }))).status).toBe(200);
  expect(mocks.complete.mock.calls[0][0].instructions).toContain(source.text);
  expect(mocks.complete.mock.calls[0][0].instructions).not.toContain(`<original_method_prompt>\n${oldSource.text}`);
  mocks.complete.mockResolvedValueOnce(completion({ issues: [] }));
  expect((await check(request({ ...base, draft: sixStepDraft() }))).status).toBe(200);
  expect(mocks.complete.mock.calls[1][0].instructions).toContain(source.text);
  const context = JSON.parse(mocks.complete.mock.calls[1][0].input[0].content);
  expect(context.appOwnedImagePlacement[0]).toEqual({ slide: 1, images: ["phenomenon"] });
  expect(context.appOwnedImagePlacement[1]).toEqual({ slide: 2, images: ["target"] });
});

it("lets a six-step revision add a useful boundary without letting the next-generation picker change its method", async () => {
  const draft = sixStepDraft();
  mocks.complete.mockResolvedValueOnce(completion(output(true)));
  const response = await POST(request({ ...base, operation: "review", draft, feedback: "Add a short boundary that clarifies the comparison." }));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.draft.analogyMethod).toBe("six-step");
  expect(result.draft.slides).toHaveLength(7);
  for (const analogyMethod of ["reference-story", "predict-transfer"]) expect((await POST(request({ ...base, operation: "review", draft, analogyMethod }))).status).toBe(422);
  const legacy = analogyMethodDraft("predict-transfer");
  delete legacy.analogyMethod;
  expect((await POST(request({ ...base, operation: "review", draft: legacy, analogyMethod: "six-step" }))).status).toBe(422);
  expect(mocks.complete).toHaveBeenCalledTimes(1);
});

it("requires a valid phenomenon JPEG for six-step target generation and uses editing rather than a disconnected image", async () => {
  const draft = sixStepDraft();
  const body = { ...base, draft, visualId: "target" };
  for (const referenceAsset of [undefined, { data: "https://example.com/picture.jpg", width: 100, height: 100 }, { data: "data:image/png;base64,AQID", width: 100, height: 100 }]) {
    expect((await image(request({ ...body, referenceAsset }))).status).toBe(422);
  }
  expect(mocks.edit).not.toHaveBeenCalled();
  const referenceAsset = { data: tinyJpeg, width: 1536, height: 1024 };
  expect((await image(request({ ...body, referenceAsset }))).status).toBe(200);
  expect(mocks.edit).toHaveBeenCalledTimes(1);
  expect(mocks.edit.mock.calls[0][0].input[0].content[1].image_url).toBe(referenceAsset.data);
  expect(mocks.generate).not.toHaveBeenCalled();
  for (const visualId of ["phenomenon", "analogue"]) {
    expect((await image(request({ ...base, draft, visualId }))).status).toBe(200);
    expect((await image(request({ ...base, draft, visualId, referenceAsset }))).status).toBe(400);
  }
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});

it("reviews six-step continuity and mapping using three actual images and the fourth-page scaffold", async () => {
  const deck = sixStepDeck();
  const familiar = { ...deck.assets.analogue, data: "data:image/jpeg;base64,/9j/4AE=" };
  const phenomenon = { ...deck.assets.phenomenon, data: "data:image/jpeg;base64,/9j/4AI=" };
  mocks.complete.mockResolvedValueOnce(completion({ issues: [] }));
  expect((await check(request({ ...base, draft: deck.draft, visualId: "target", asset: deck.assets.target, referenceAsset: familiar, phenomenonAsset: phenomenon }))).status).toBe(200);
  const content = mocks.complete.mock.calls[0][0].input[0].content;
  const data = JSON.parse(content[0].text);
  expect(data.mappingSlide).toEqual(deck.draft.slides[3]);
  expect(data.studentScaffold).toEqual({ starter: deck.draft.analogyPlan!.responseStarter });
  const actualImages = content.filter((part: { type: string }) => part.type === "input_image").map((part: { image_url: string }) => part.image_url);
  expect(actualImages).toEqual([phenomenon.data, familiar.data, deck.assets.target.data]);
  expect(mocks.complete.mock.calls[0][0].instructions).toMatch(/THREE pictures/iu);
});

it("requires a valid actual phenomenon image before checking a six-step target", async () => {
  const deck = sixStepDeck();
  const body = { ...base, draft: deck.draft, visualId: "target", asset: deck.assets.target, referenceAsset: deck.assets.analogue };
  for (const phenomenonAsset of [undefined, null, {}, { data: "https://example.com/phenomenon.jpg", width: 1536, height: 1024 }]) {
    expect((await check(request({ ...body, phenomenonAsset }))).status).toBe(422);
  }
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("rejects an extraneous phenomenon asset for text, single-picture or earlier-method reviews", async () => {
  const deck = sixStepDeck();
  const phenomenonAsset = deck.assets.phenomenon;
  const cases = [
    { draft: deck.draft },
    { draft: deck.draft, visualId: "phenomenon", asset: phenomenonAsset },
    { draft: deck.draft, visualId: "analogue", asset: deck.assets.analogue },
    { draft: analogyMethodDraft(), visualId: "target", asset: deck.assets.target, referenceAsset: deck.assets.analogue },
  ];
  for (const data of cases) expect((await check(request({ ...base, ...data, phenomenonAsset }))).status).toBe(400);
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("rejects incompatible six-step check/image method metadata before any provider call", async () => {
  const draft = sixStepDraft();
  expect((await check(request({ ...base, draft, analogyMethod: "predict-transfer" }))).status).toBe(422);
  expect((await image(request({ ...base, draft, visualId: "phenomenon", analogyMethod: "reference-story" }))).status).toBe(422);
  expect((await POST(request({ ...base, analogyMethod: "sixstep" }))).status).toBe(400);
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.edit).not.toHaveBeenCalled();
});

it.each(["targetPhenomenon", "authenticityRationale", "discussionGoal", "mappingHint"] as const)("rejects new teacher-led generation missing its %s contract", async field => {
  const generated = output();
  if (field === "mappingHint") generated.analogyPlan![field] = "The board corresponds to the deck.";
  else delete generated.analogyPlan![field];
  mocks.complete.mockResolvedValueOnce(completion(generated));
  const response = await POST(request({ ...base, analogyMethod: "six-step" }));
  expect(response.status).toBe(502);
  expect(await response.json()).not.toHaveProperty("draft");
});
