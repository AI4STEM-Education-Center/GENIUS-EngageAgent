import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ begin: vi.fn(), session: vi.fn(), context: vi.fn(), answers: vi.fn() }));
vi.mock("@/lib/slides/jobs", () => ({ beginSlideJob: mocks.begin }));
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: (request: Request) => request.headers.get("origin") === "http://localhost" }));
vi.mock("@/lib/workspace", async importOriginal => ({ ...await importOriginal<object>(), workspaceContext: mocks.context }));
vi.mock("@/lib/nosql", () => ({ listStudentAnswers: mocks.answers }));
import { POST as draft } from "@/app/api/slides/route";
import { POST as check } from "@/app/api/slides/check/route";
import { POST as image } from "@/app/api/slides/image/route";
import { slideJson } from "@/lib/slides/server";
import { slidePrompt, slideOutputFormat, slideImagePrompt } from "@/lib/slides/prompts";
import { textReviewFormat } from "@/lib/slides/review";
import { getLessonGenerationContext } from "@/lib/lesson-context";
import { loadSlideSource } from "@/lib/slides/source-prompts";
import { slideFixture, deckFixture } from "../fixtures/slides";
const base = { classId: "ea-class-test", assignmentId: "ea-task-test", lessonNumber: 3, strategy: "cognitive conflict" };
const request = (data: unknown) => new Request("http://localhost/api/slides", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify(data) });
const pending = { job: { id: "opaque-application-job", pollAfterMs: 2000 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_SLIDES_MODEL", "gpt-6.1-sol");
  mocks.session.mockResolvedValue({ role: "teacher", geniusId: "teacher-test" });
  mocks.context.mockResolvedValue({});
  mocks.answers.mockResolvedValue([]);
  mocks.begin.mockImplementation(async () => slideJson(pending, 202));
});
afterEach(() => vi.unstubAllEnvs());

it.each(["gpt-4.1", "gpt-5-mini", "gpt-6-astra", "gpt-6.1-sol"])("submits %s drafts as background work without waiting for completed output or changing prompts", async textModel => {
  const req = request({ ...base, textModel });
  const response = await draft(req);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual(pending);
  const [passedRequest, context, parameters, spec] = mocks.begin.mock.calls[0];
  expect(passedRequest).toBe(req);
  expect(context).toEqual({ classId: base.classId, assignmentId: base.assignmentId });
  const source = await loadSlideSource("cognitive conflict");
  const expected = slidePrompt(getLessonGenerationContext(3)!, "cognitive conflict", undefined, undefined,
    { responses: 0, selections: [] }, { version: "optimized", referenceText: source.text, classroomContext: "" });
  expect(parameters.instructions).toBe(expected.system);
  expect(parameters.input).toEqual([{ role: "user", content: expected.user }]);
  expect(parameters.text.format).toEqual({ type: "json_schema", ...slideOutputFormat("cognitive conflict").json_schema });
  expect(parameters.model).toBe(textModel);
  expect(parameters).not.toHaveProperty("messages");
  expect(parameters).not.toHaveProperty("response_format");
  expect(parameters).not.toHaveProperty("max_completion_tokens");
  expect(parameters.reasoning).toEqual(textModel === "gpt-4.1" ? undefined : { effort: "low" });
  expect(spec).toMatchObject({ kind: "draft", strategy: "cognitive conflict", model: textModel, promptProvenance: { version: "optimized", sourceSha256: source.sha256 } });
});

it.each(["generate", "review"])("submits a %s operation as its own job", async operation => {
  const existing = slideFixture("cognitive conflict");
  expect((await draft(request({ ...base, operation, ...(operation === "review" ? { draft: existing, feedback: "Keep prediction before evidence." } : {}) }))).status).toBe(202);
  expect(mocks.begin).toHaveBeenCalledTimes(1);
  expect(mocks.begin.mock.calls[0][3].kind).toBe("draft");
  if (operation === "review") expect(JSON.parse(mocks.begin.mock.calls[0][2].input[0].content).correctionRequest).toBe("Keep prediction before evidence.");
});

it("returns hard teaching errors immediately without starting a semantic job", async () => {
  const existing = slideFixture("cognitive conflict");
  existing.slides[4].task = "Copy the answer.";
  const response = await check(request({ ...base, draft: existing }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ model: "output-rules", issues: expect.arrayContaining([expect.stringContaining("Slide 5.task")]) });
  expect(mocks.begin).not.toHaveBeenCalled();
});

it("keeps the exact current draft for grounded text-review completion", async () => {
  const existing = slideFixture("cognitive conflict");
  const response = await check(request({ ...base, draft: existing }));
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual(pending);
  const [, , parameters, spec] = mocks.begin.mock.calls[0];
  expect(parameters.text.format).toEqual({ type: "json_schema", ...textReviewFormat(existing).json_schema });
  expect(spec).toEqual({ kind: "text-check", model: "gpt-6.1-sol", strategy: "cognitive conflict", draft: existing });
  expect(parameters.max_output_tokens).toBe(8000);
});

it("passes actual inline pixels to an image-check job", async () => {
  const deck = deckFixture("cognitive conflict");
  const response = await check(request({ ...base, draft: deck.draft, visualId: "evidence", asset: deck.assets.evidence }));
  expect(response.status).toBe(202);
  const [, , parameters, spec] = mocks.begin.mock.calls[0];
  expect(parameters.input[0].content[1]).toEqual({ type: "input_image", image_url: deck.assets.evidence.data, detail: "high" });
  expect(spec).toEqual({ kind: "image-check", model: "gpt-6.1-sol" });
});

it("submits only the selected image tool and exact planned scene in an image job", async () => {
  const existing = slideFixture("cognitive conflict");
  const response = await image(request({ ...base, draft: existing, visualId: "evidence", imageModel: "gpt-image-2" }));
  expect(response.status).toBe(202);
  const [, , parameters, spec] = mocks.begin.mock.calls[0];
  expect(parameters.model).toBe("gpt-4.1");
  expect(parameters.tools).toEqual([{ type: "image_generation", model: "gpt-image-2", size: "1536x1024", quality: "high", output_format: "jpeg", output_compression: 85, action: "generate" }]);
  expect(parameters.input[0].content).toEqual([{ type: "input_text", text: slideImagePrompt(existing, "cognitive conflict", "evidence") }]);
  expect(parameters.tool_choice).toEqual({ type: "image_generation" });
  expect(spec).toEqual({ kind: "image", model: "gpt-image-2" });
});

it("does not fall back to a synchronous request or another model when job submission fails", async () => {
  mocks.begin.mockRejectedValue(new Error("private provider failure"));
  const response = await draft(request({ ...base, textModel: "gpt-6.1-sol" }));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private provider failure");
  expect(mocks.begin).toHaveBeenCalledTimes(1);
  expect(mocks.begin.mock.calls[0][2].model).toBe("gpt-6.1-sol");
});
