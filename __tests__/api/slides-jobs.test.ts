import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
const mocks = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), cancel: vi.fn(), client: vi.fn(), session: vi.fn(), context: vi.fn(), get: vi.fn(), put: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  constructor(options: unknown) { mocks.client(options); }
  responses = { create: mocks.create, retrieve: mocks.retrieve, cancel: mocks.cancel };
} }));
vi.mock("@/lib/session", () => ({ sessionUser: mocks.session, sameOriginRequest: (r: Request) => r.headers.get("origin") === "http://localhost" }));
vi.mock("@/lib/workspace", async original => ({ ...await original<object>(), workspaceContext: mocks.context }));
vi.mock("@/lib/workspace-store", () => ({ workspaceGet: mocks.get, workspacePut: mocks.put }));
import { POST } from "@/app/api/slides/jobs/route";
import { beginSlideJob, finishSlideJob, SLIDE_JOB_TTL_SECONDS, type SlideJobSpec } from "@/lib/slides/jobs";
import { WorkspaceError } from "@/lib/workspace";
import { slideFixture } from "../fixtures/slides";
import { sixStepDraft } from "../fixtures/analogy-six-step";

const context = { classId: "ea-class-test", assignmentId: "ea-task-test" };
const teacher = { role: "teacher", geniusId: "teacher-test" };
const provenance = { version: "optimized" as const, revision: "test-revision", sourceSha256: "test-hash" };
const draftSpec: SlideJobSpec = { kind: "draft", model: "gpt-6.1-sol", strategy: "cognitive conflict", promptProvenance: provenance };
const records = new Map<string, Record<string, unknown>>();
const request = (data: unknown, origin = "http://localhost") => new Request("http://localhost/api/slides/jobs", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(data) });
const completed = (value: unknown, extra = {}) => ({ id: "resp_private_provider_id", status: "completed", output_text: JSON.stringify(value), output: [], error: null, incomplete_details: null, ...extra }) as unknown as OpenAI.Responses.Response;
const start = (spec: SlideJobSpec = draftSpec) => beginSlideJob(request(context), context, { model: "gpt-6.1-sol", input: "Private request data", background: false, store: true }, spec);
const ticket = async (spec: SlideJobSpec = draftSpec) => (await (await start(spec)).json()).job.id as string;
const poll = (jobId: string, more = {}, origin?: string) => POST(request({ ...context, jobId, ...more }, origin));

beforeEach(() => {
  vi.clearAllMocks(); records.clear(); vi.stubEnv("OPENAI_API_KEY", "test-key");
  mocks.session.mockResolvedValue(teacher); mocks.context.mockResolvedValue({});
  mocks.create.mockResolvedValue({ id: "resp_private_provider_id", status: "queued" });
  mocks.retrieve.mockResolvedValue({ status: "in_progress" }); mocks.cancel.mockResolvedValue({ status: "cancelled" });
  mocks.get.mockImplementation(async (partition, key) => records.get(`${partition}/${key}`) || null);
  mocks.put.mockImplementation(async rows => { for (const row of rows) records.set(`${row.partition}/${row.key}`, structuredClone(row.value)); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("durable owner-bound slide jobs", () => {
  it("starts once with short provider timeout, no storage, opaque ticket, and bounded metadata only", async () => {
    const response = await start();
    expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json();
    expect(result).toEqual({ job: { id: expect.stringMatching(/^[0-9a-f-]{36}$/u), pollAfterMs: 2000 } });
    expect(JSON.stringify(result)).not.toContain("resp_private");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ background: true, store: false, stream: false });
    expect(mocks.client).toHaveBeenCalledWith({ apiKey: "test-key", timeout: 20_000, maxRetries: 0 });
    const row = mocks.put.mock.calls[0][0][0];
    expect(row.createOnly).toBe(true);
    expect(row.expiresAt).toBe(row.value.expiresAt);
    expect(row.expiresAt).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + SLIDE_JOB_TTL_SECONDS - 1);
    expect(row.value).toMatchObject({ ...context, ownerId: teacher.geniusId, providerResponseId: "resp_private_provider_id", spec: draftSpec });
    expect(JSON.stringify(row)).not.toContain("Private request data");
  });

  it("preserves a ticket across requests, authorizes each poll, and returns only the completed payload", async () => {
    const id = await ticket();
    for (const status of ["queued", "in_progress"]) {
      mocks.retrieve.mockResolvedValueOnce({ status });
      const waiting = await poll(id); expect(waiting.status).toBe(202);
      expect(await waiting.json()).toEqual({ job: { id, pollAfterMs: 2000 } });
    }
    const draft = slideFixture("cognitive conflict"); mocks.retrieve.mockResolvedValue(completed(draft));
    const response = await poll(id);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ draft, model: draftSpec.model, promptProvenance: provenance });
    expect(mocks.context).toHaveBeenCalledTimes(3);
    expect(mocks.retrieve).toHaveBeenLastCalledWith("resp_private_provider_id", { stream: false }, { timeout: 10_000, signal: expect.any(AbortSignal) });
    expect(mocks.put).toHaveBeenCalledTimes(1); // No result images or response bodies persisted.
  });

  it("denies unauthenticated, student, cross-origin, missing task, wrong owner and wrong context polls/cancels before provider access", async () => {
    const id = await ticket();
    for (const operation of [undefined, "cancel"]) {
      mocks.session.mockResolvedValue(null); expect((await poll(id, { operation })).status).toBe(401);
      mocks.session.mockResolvedValue({ ...teacher, role: "student" }); expect((await poll(id, { operation })).status).toBe(403);
      mocks.session.mockResolvedValue(teacher); expect((await poll(id, { operation }, "https://intruder.example")).status).toBe(403);
      mocks.context.mockRejectedValueOnce(new WorkspaceError("Task not found in this class.", 404)); expect((await poll(id, { operation })).status).toBe(404);
      mocks.session.mockResolvedValue({ ...teacher, geniusId: "other-teacher" }); expect((await poll(id, { operation })).status).toBe(404);
      mocks.session.mockResolvedValue(teacher);
      expect((await poll(id, { operation, assignmentId: "ea-task-other" })).status).toBe(404);
      expect((await poll(id, { operation, classId: "ea-class-other" })).status).toBe(404);
    }
    expect(mocks.retrieve).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("does not permit a raw provider ID, unsupported operation, or oversized polling input", async () => {
    expect((await poll("resp_private_provider_id")).status).toBe(400);
    const id = await ticket();
    expect((await poll(id, { operation: "retrieve" })).status).toBe(400);
    expect((await poll(id, { extraneous: "x".repeat(2000) })).status).toBe(413);
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("expires tickets at nine minutes even before physical database TTL cleanup", async () => {
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
    const id = await ticket(); vi.spyOn(Date, "now").mockReturnValue(now + SLIDE_JOB_TTL_SECONDS * 1000);
    for (const operation of [undefined, "cancel"]) {
      const response = await poll(id, { operation }); expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ jobFailure: true, error: expect.stringContaining("expired") });
    }
    expect(mocks.retrieve).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("marks cancellation durably and safely repeats it even if provider cancellation fails", async () => {
    const id = await ticket(); mocks.cancel.mockRejectedValue(new Error("secret provider error resp_private_provider_id"));
    for (let i = 0; i < 2; i++) expect(await (await poll(id, { operation: "cancel" })).json()).toEqual({ cancelled: true });
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    const response = await poll(id); expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ jobFailure: true, error: expect.stringContaining("cancelled") });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("cancels a submitted provider response if its ticket cannot be stored", async () => {
    mocks.put.mockRejectedValueOnce(new Error("storage failed"));
    await expect(start()).rejects.toThrow("storage failed");
    expect(mocks.cancel).toHaveBeenCalledWith("resp_private_provider_id", { timeout: 2000 });
    expect(records.size).toBe(0);
  });

  it("does not retry initial submission and never leaks provider errors from polling", async () => {
    mocks.create.mockRejectedValueOnce(new Error("submission timeout"));
    await expect(start()).rejects.toThrow("submission timeout"); expect(mocks.create).toHaveBeenCalledTimes(1);
    const id = await ticket(); mocks.retrieve.mockRejectedValueOnce(new Error("private credential resp_private_provider_id"));
    const response = await poll(id); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/private credential|resp_private/u);
  });

  it.each(["failed", "cancelled", "incomplete"])("labels provider terminal %s without reflecting its raw error", async status => {
    const id = await ticket(); mocks.retrieve.mockResolvedValue(completed({}, { status, error: { message: "private upstream error" } }));
    const response = await poll(id); expect(response.status).toBe(502);
    const result = await response.json(); expect(result.jobFailure).toBe(true); expect(JSON.stringify(result)).not.toContain("private upstream");
  });

  it("does not retain an image request or any extraneous spec fields", async () => {
    const spec = { kind: "image", model: "gpt-image-2", image: "data:image/jpeg;base64,private" } as SlideJobSpec;
    await start(spec); const saved = mocks.put.mock.calls[0][0][0];
    expect(saved.value.spec).toEqual({ kind: "image", model: "gpt-image-2" });
    expect(JSON.stringify(saved)).not.toContain("data:image");
  });

  it("rejects oversized UTF-8 validation metadata before paid provider submission", async () => {
    const draft = sixStepDraft();
    for (const slide of draft.slides) slide.teacherNotes = ["界".repeat(3600), "界".repeat(3600)];
    for (const visual of draft.visuals) visual.prompt = "界".repeat(7200);
    await expect(start({ kind: "text-check", model: "review-model", strategy: "analogy", draft })).rejects.toMatchObject({ status: 413 });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });

  it("keeps the current editable draft for grounded review without undefined marshal values", async () => {
    const draft = slideFixture("experience bridging");
    await start({ kind: "text-check", model: "review-model", strategy: "experience bridging", draft });
    const saved = mocks.put.mock.calls[0][0][0].value;
    expect(saved.spec.draft).toEqual(draft);
    expect(saved).toEqual(JSON.parse(JSON.stringify(saved)));
  });
});

describe("completed slide output validation", () => {
  it("accepts output text blocks without the SDK convenience output_text property", () => {
    const response = completed({}, { output_text: undefined, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ issues: [] }) }] }] });
    expect(finishSlideJob(response, { kind: "image-check", model: "review-model" })).toEqual({ issues: [], model: "review-model" });
  });
  it.each([
    { output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] },
    { incomplete_details: { reason: "max_output_tokens" } },
    { output_text: "not JSON" },
  ])("rejects incomplete, refused or unreadable text output %j", extra => {
    expect(() => finishSlideJob(completed(slideFixture("cognitive conflict"), extra), draftSpec)).toThrow();
  });
  it("retains strict six-step design metadata checks and method binding", () => {
    const spec: SlideJobSpec = { ...draftSpec, kind: "draft", strategy: "analogy", analogyMethod: "six-step" };
    const draft = sixStepDraft(); expect(finishSlideJob(completed(draft), spec).draft).toEqual(draft);
    draft.analogyPlan!.mappingHint = "Premature correspondence";
    expect(() => finishSlideJob(completed(draft), spec)).toThrow();
    draft.analogyPlan!.mappingHint = ""; draft.analogyPlan!.targetPhenomenon = "";
    expect(() => finishSlideJob(completed(draft), spec)).toThrow();
  });
  it("grounds text review in the saved draft and rejects invented quotes or oversized image reviews", () => {
    const draft = slideFixture("cognitive conflict");
    const spec: SlideJobSpec = { kind: "text-check", model: "review-model", strategy: "cognitive conflict", draft };
    const finding = { field: "slide-1-title", quote: draft.slides[0].title, problem: "Example problem.", correction: "Example correction." };
    expect(finishSlideJob(completed({ issues: [finding] }), spec)).toMatchObject({ issues: ["Slide 1.title: Example problem. Example correction."] });
    expect(() => finishSlideJob(completed({ issues: [{ ...finding, quote: "invented content" }] }), spec)).toThrow("not grounded");
    for (const issues of [null, [""], ["x".repeat(801)], Array(6).fill("Issue")]) expect(() => finishSlideJob(completed({ issues }), { kind: "image-check", model: "review" })).toThrow();
  });
  it("accepts exactly one completed bounded JPEG image and does not require an assistant text message", () => {
    const base64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
    const image = { type: "image_generation_call", status: "completed", result: base64 };
    const spec: SlideJobSpec = { kind: "image", model: "gpt-image-2" };
    expect(finishSlideJob(completed(null, { output: [image] }), spec)).toEqual({ asset: { data: `data:image/jpeg;base64,${base64}`, width: 1536, height: 1024, model: "gpt-image-2" } });
    for (const output of [[], [image, image], [{ ...image, status: "failed" }], [{ ...image, result: "AAAA" }], [{ ...image, result: "!bad!" }], [{ ...image, result: "x".repeat(4_500_001) }]]) expect(() => finishSlideJob(completed(null, { output }), spec)).toThrow();
  });
});
