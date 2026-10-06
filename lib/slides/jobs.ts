import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { sessionUser } from "../session";
import { workspaceGet, workspacePut } from "../workspace-store";
import type { SlideDraft, SlideStrategy } from "./model";
import type { AnalogyMethod } from "./analogy-methods";
import type { SlidePromptProvenance } from "./prompt-versions";
import { SIX_STEP_CONTEXT_FIELDS } from "./analogy";
import { existingGenerationKey } from "./model-config";
import { parseTextFindings } from "./review";
import { authorizeSlides, requestDraft, slideJson, SlideRequestError } from "./server";

export type SlideJobSpec =
  | { kind: "draft"; model: string; strategy: SlideStrategy; analogyMethod?: AnalogyMethod; promptProvenance: SlidePromptProvenance }
  | { kind: "text-check"; model: string; strategy: SlideStrategy; draft: SlideDraft }
  | { kind: "image-check"; model: string }
  | { kind: "image"; model: string };
type Context = { classId: string; assignmentId: string };
type SlideJob = Context & { ownerId: string; providerResponseId: string; expiresAt: number; spec: SlideJobSpec; cancelled?: boolean };

// Leave a margin before the provider's approximately ten-minute polling retention.
export const SLIDE_JOB_TTL_SECONDS = 9 * 60;
const MAX_METADATA_BYTES = 192_000;
const partition = (ownerId: string) => `SLIDE_JOBS#${ownerId}`;
const jobKey = (id: string) => `JOB#${id}`;
const pending = (id: string) => slideJson({ job: { id, pollAfterMs: 2000 } }, 202);
const terminal = (message: string, status = 502) => slideJson({ error: message, jobFailure: true }, status);
const client = () => new OpenAI({ apiKey: existingGenerationKey(), timeout: 20_000, maxRetries: 0 });

// Only server-selected metadata is retained. In particular, never persist the
// provider request, source diagnostics, reference images, or generated images.
function boundedSpec(spec: SlideJobSpec): SlideJobSpec {
  let value: SlideJobSpec;
  switch (spec.kind) {
    case "draft": value = { kind: spec.kind, model: spec.model, strategy: spec.strategy,
      ...(spec.analogyMethod ? { analogyMethod: spec.analogyMethod } : {}), promptProvenance: {
        version: spec.promptProvenance.version, revision: spec.promptProvenance.revision,
        sourceSha256: spec.promptProvenance.sourceSha256,
        ...(spec.promptProvenance.analogyMethod ? { analogyMethod: spec.promptProvenance.analogyMethod } : {}),
      } }; break;
    case "text-check": value = { kind: spec.kind, model: spec.model, strategy: spec.strategy,
      draft: requestDraft(spec.draft, spec.strategy, true, spec.draft.analogyMethod) }; break;
    default: value = { kind: spec.kind, model: spec.model };
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) throw new SlideRequestError("The slide draft is too large to check. Shorten the draft and retry.", 413);
  // DocumentClient does not remove undefined values; keep persisted JSON canonical.
  return JSON.parse(serialized) as SlideJobSpec;
}

export async function beginSlideJob(request: Request, authorized: Context,
  params: OpenAI.Responses.ResponseCreateParamsNonStreaming, spec: SlideJobSpec) {
  const user = await sessionUser();
  if (!user) throw new SlideRequestError("Sign in to EngageAgent first.", 401);
  if (user.role !== "teacher") throw new SlideRequestError("Only teachers can create slides.", 403);
  const metadata = boundedSpec(spec);
  const expiresAt = Math.floor(Date.now() / 1000) + SLIDE_JOB_TTL_SECONDS;
  const provider = client();
  const response = await provider.responses.create({ ...params, background: true, store: false, stream: false }, { signal: request.signal });
  if (typeof response.id !== "string" || !response.id || response.id.length > 256) throw new SlideRequestError("The model did not start slide generation. Please try again.", 502);
  const id = randomUUID();
  const record: SlideJob = { ...authorized, ownerId: user.geniusId, providerResponseId: response.id, expiresAt, spec: metadata };
  try {
    await workspacePut([{ partition: partition(user.geniusId), key: jobKey(id), value: record, createOnly: true, expiresAt }]);
  } catch (error) {
    // A ticket that could not be persisted must not leave unnecessary work running.
    try { await provider.responses.cancel(response.id, { timeout: 2000 }); } catch { /* best effort */ }
    throw error;
  }
  return pending(id);
}

/** Validate completed provider output using the same contracts as synchronous routes. */
export function finishSlideJob(response: OpenAI.Responses.Response, spec: SlideJobSpec): Record<string, unknown> {
  const output = Array.isArray(response.output) ? response.output : [];
  const refused = output.some(item => item.type === "message" && item.content.some(part => part.type === "refusal"));
  if (response.status !== "completed" || response.error || response.incomplete_details || refused) {
    throw new SlideRequestError("The model did not return a complete slide result. Please try again.", 502);
  }
  if (spec.kind === "image") {
    const images = output.filter(item => item.type === "image_generation_call");
    const base64 = images.length === 1 && images[0].status === "completed" ? images[0].result : null;
    if (!base64 || base64.length > 4_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) throw new SlideRequestError("The model returned an invalid or oversized slide image. Please try again.", 502);
    const bytes = Buffer.from(base64, "base64");
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new SlideRequestError("The model returned an unsupported slide image. Please try again.", 502);
    return { asset: { data: `data:image/jpeg;base64,${base64}`, width: 1536, height: 1024, model: spec.model } };
  }
  const content = response.output_text || output.flatMap(item => item.type === "message" ? item.content.filter(part => part.type === "output_text").map(part => part.text) : []).join("");
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { throw new SlideRequestError("The model returned an unreadable slide result. Please try again.", 502); }
  if (spec.kind === "draft") {
    // Retain bounded editable text for repair; export remains strict.
    const draft = requestDraft(parsed, spec.strategy, true, spec.analogyMethod);
    if (spec.strategy === "analogy" && !draft.analogyPlan) throw new SlideRequestError("The analogy design is incomplete. Please retry generation.", 502);
    if (spec.analogyMethod === "six-step" && (SIX_STEP_CONTEXT_FIELDS.some(field => !draft.analogyPlan?.[field]?.trim()) || draft.analogyPlan?.mappingHint !== "")) throw new SlideRequestError("The teacher-led analogy design is incomplete. Please retry generation.", 502);
    return { draft, model: spec.model, promptProvenance: spec.promptProvenance };
  }
  const issues = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).issues : undefined;
  if (spec.kind === "text-check") {
    try { return { issues: parseTextFindings(issues, spec.draft), model: spec.model }; }
    catch { throw new SlideRequestError("Content review was not grounded in the current draft. Retry checking; your draft is unchanged.", 502); }
  }
  if (!Array.isArray(issues) || issues.length > 5 || issues.some(issue => typeof issue !== "string" || !issue.trim() || issue.length > 800)) throw new SlideRequestError("The model returned an invalid image review. Please retry checking.", 502);
  return { issues, model: spec.model };
}

export async function pollSlideJob(request: Request, body: Record<string, unknown>) {
  const context = await authorizeSlides(request, body);
  if (typeof body.jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(body.jobId)) throw new SlideRequestError("Choose a valid slide generation job.");
  if (body.operation !== undefined && body.operation !== "cancel") throw new SlideRequestError("Unsupported slide job operation.");
  const user = await sessionUser();
  if (!user) throw new SlideRequestError("Sign in to EngageAgent first.", 401);
  const stored = await workspaceGet<SlideJob>(partition(user.geniusId), jobKey(body.jobId));
  if (!stored || stored.ownerId !== user.geniusId || stored.classId !== context.classId || stored.assignmentId !== context.assignmentId) throw new SlideRequestError("Slide generation job not found.", 404);
  if (!Number.isFinite(stored.expiresAt) || stored.expiresAt <= Math.floor(Date.now() / 1000)) return terminal("This slide generation job expired. Your current draft is unchanged. Please try again.", 410);
  if (body.operation === "cancel") {
    if (!stored.cancelled) {
      await workspacePut([{ partition: partition(user.geniusId), key: jobKey(body.jobId), value: { ...stored, cancelled: true }, expiresAt: stored.expiresAt }]);
      try { await client().responses.cancel(stored.providerResponseId, { timeout: 10_000 }); } catch { /* Cancellation is best effort; never expose provider errors. */ }
    }
    return slideJson({ cancelled: true });
  }
  if (stored.cancelled) return terminal("Slide generation was cancelled. Your current draft is unchanged.", 410);
  const response = await client().responses.retrieve(stored.providerResponseId, { stream: false }, { timeout: 10_000, signal: request.signal });
  if (response.status === "queued" || response.status === "in_progress") return pending(body.jobId);
  try { return slideJson(finishSlideJob(response, stored.spec)); }
  catch (error) {
    if (error instanceof SlideRequestError) return terminal(error.message, error.status);
    return terminal("The model returned an invalid slide result. Your current draft is unchanged. Please try again.");
  }
}
