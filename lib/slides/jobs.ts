import { parseSlideRevision, validSlideRevisionIndex } from "./slide-revision";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { workspaceGet, workspacePut } from "../workspace-store";
import type { SlideDraft, SlideStrategy } from "./model";
import type { AnalogyMethod } from "./analogy-methods";
import type { SlidePromptProvenance } from "./prompt-versions";
import { SIX_STEP_CONTEXT_FIELDS } from "./analogy";
import { existingGenerationKey } from "./model-config";
import { parseTextFindings } from "./review";
import { authorizeSlides, requestDraft, slideJson, SlideRequestError, type AuthorizedSlideContext } from "./server";

export type SlideJobSpec =
  | { kind: "draft"; model: string; strategy: SlideStrategy; analogyMethod?: AnalogyMethod; requireOpeningPhenomenon?: true; promptProvenance: SlidePromptProvenance }
  | { kind: "slide-revision"; model: string; strategy: SlideStrategy; lessonNumber: number; slideIndex: number; draft: SlideDraft }
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
      ...(spec.strategy === "cognitive conflict" && spec.requireOpeningPhenomenon === true ? { requireOpeningPhenomenon: true } : {}),
      ...(spec.analogyMethod ? { analogyMethod: spec.analogyMethod } : {}), promptProvenance: {
        version: spec.promptProvenance.version, revision: spec.promptProvenance.revision,
        sourceSha256: spec.promptProvenance.sourceSha256,
        ...(spec.promptProvenance.analogyMethod ? { analogyMethod: spec.promptProvenance.analogyMethod } : {}),
      } }; break;
    case "slide-revision": {
      const draft = requestDraft(spec.draft, spec.strategy, true, spec.draft.analogyMethod);
      if (!validSlideRevisionIndex(draft, spec.slideIndex) || !Number.isInteger(spec.lessonNumber) || spec.lessonNumber < 1 || spec.lessonNumber > 8) throw new SlideRequestError("Choose one valid slide to revise.");
      value = { kind: spec.kind, model: spec.model, strategy: spec.strategy, lessonNumber: spec.lessonNumber, slideIndex: spec.slideIndex, draft };
      break;
    }
    case "text-check": value = { kind: spec.kind, model: spec.model, strategy: spec.strategy,
      draft: requestDraft(spec.draft, spec.strategy, true, spec.draft.analogyMethod) }; break;
    default: value = { kind: spec.kind, model: spec.model };
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) throw new SlideRequestError(`The slide draft is too large to ${spec.kind === "slide-revision" ? "revise" : "check"}. Shorten the draft and retry.`, 413);
  // DocumentClient does not remove undefined values; keep persisted JSON canonical.
  return JSON.parse(serialized) as SlideJobSpec;
}

export async function beginSlideJob(request: Request, authorized: AuthorizedSlideContext,
  params: OpenAI.Responses.ResponseCreateParamsNonStreaming, spec: SlideJobSpec) {
  const metadata = boundedSpec(spec);
  const expiresAt = Math.floor(Date.now() / 1000) + SLIDE_JOB_TTL_SECONDS;
  const provider = client();
  const response = await provider.responses.create({ ...params, background: true, store: false, stream: false }, { signal: request.signal });
  if (typeof response.id !== "string" || !response.id || response.id.length > 256) throw new SlideRequestError("The model did not start slide generation. Please try again.", 502);
  const id = randomUUID();
  const record: SlideJob = { classId: authorized.classId, assignmentId: authorized.assignmentId, ownerId: authorized.userId, providerResponseId: response.id, expiresAt, spec: metadata };
  try {
    await workspacePut([{ partition: partition(authorized.userId), key: jobKey(id), value: record, createOnly: true, expiresAt }]);
  } catch (error) {
    // A ticket that could not be persisted must not leave unnecessary work running.
    try { await provider.responses.cancel(response.id, { timeout: 2000 }); } catch { /* best effort */ }
    throw error;
  }
  return pending(id);
}

// Provider diagnostics are an explicit allowlist: never log messages, prompts,
// output bodies, response IDs, request headers, credentials or image data.
const providerStatuses = ["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"];
const providerErrors = ["image_generation_user_error", "image_generation_failed", "model_not_found", "unsupported_image_model", "server_error", "rate_limit_exceeded", "invalid_prompt", "vector_store_timeout", "invalid_image", "invalid_image_format", "invalid_base64_image", "invalid_image_url", "image_too_large", "image_too_small", "image_parse_error", "image_content_policy_violation", "invalid_image_mode", "image_file_too_large", "unsupported_image_media_type", "empty_image_file", "failed_to_download_image", "image_file_not_found"];
const providerOutputTypes = ["message", "reasoning", "image_generation_call", "function_call", "web_search_call", "file_search_call", "computer_call", "code_interpreter_call", "mcp_call"];
const known = (value: unknown, allowed: string[]) => typeof value === "string" && allowed.includes(value) ? value : value === null || value === undefined ? null : "other";
// Provider machine codes use a bounded lowercase identifier; never emit free-form messages.
const providerCode = (value: unknown, allowed: string[]) => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : known(value, allowed);
const tokenCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
function incompleteResult(response: OpenAI.Responses.Response, spec: SlideJobSpec, refused: boolean): never {
  const reason = known(response.incomplete_details?.reason, ["max_output_tokens", "content_filter", "max_messages", "steered"]);
  const code = providerCode(response.error?.code, providerErrors);
  console.warn("Slide provider result incomplete", {
    kind: spec.kind, status: known(response.status, providerStatuses), errorCode: code,
    incompleteReason: reason, refused,
    output: (Array.isArray(response.output) ? response.output : []).slice(0, 12).map(item => ({
      type: known(item.type, providerOutputTypes), status: providerCode("status" in item ? item.status : undefined, providerStatuses),
    })),
    outputTokens: tokenCount(response.usage?.output_tokens),
    reasoningTokens: tokenCount(response.usage?.output_tokens_details?.reasoning_tokens),
    maxOutputTokens: tokenCount(response.max_output_tokens),
  });
  const result = spec.kind === "image" ? "image" : spec.kind === "draft" ? "slide draft" : spec.kind === "slide-revision" ? "slide revision" : "review";
  const action = spec.kind === "image" ? "Retry this image" : spec.kind === "draft" ? "Retry generation" : spec.kind === "slide-revision" ? "Retry revising this slide" : "Retry checking";
  if (code === "model_not_found" || code === "unsupported_image_model") throw new SlideRequestError(`The selected ${result} model is unavailable. Choose another model or ask the platform administrator to update its model configuration; your current draft is unchanged.`, 503);
  if (reason === "max_output_tokens") throw new SlideRequestError(`The ${result} reached its generation limit before finishing. ${action}; your current draft is unchanged.`, 502);
  if (refused || reason === "content_filter" || code === "image_content_policy_violation" || code === "invalid_prompt") throw new SlideRequestError(`The model could not use this ${result} request. Adjust the description and try again; your current draft is unchanged.`, 502);
  if (code === "rate_limit_exceeded") throw new SlideRequestError(`The generation service is busy. Wait a moment and ${action.toLowerCase()}; your current draft is unchanged.`, 502);
  throw new SlideRequestError(`The model did not return a complete ${result}. ${action}; your current draft is unchanged.`, 502);
}

/** Validate completed provider output using the same contracts as synchronous routes. */
export function finishSlideJob(response: OpenAI.Responses.Response, spec: SlideJobSpec): Record<string, unknown> {
  const output = Array.isArray(response.output) ? response.output : [];
  const refused = output.some(item => item.type === "message" && item.content.some(part => part.type === "refusal"));
  if (response.status !== "completed" || response.error || response.incomplete_details || refused) {
    incompleteResult(response, spec, refused);
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
  if (spec.kind === "slide-revision") {
    try { return { slide: parseSlideRevision(parsed, spec.draft, spec.strategy, spec.slideIndex, spec.lessonNumber), slideIndex: spec.slideIndex, model: spec.model }; }
    catch { throw new SlideRequestError("The revised slide did not meet its content requirements. Your original draft is unchanged. Retry revising this slide.", 502); }
  }
  if (spec.kind === "draft") {
    // Retain bounded editable text for repair; export remains strict.
    const draft = requestDraft(parsed, spec.strategy, true, spec.analogyMethod);
    // Saved decks and jobs submitted before the opening-image contract remain
    // readable. Newly submitted conflict drafts must satisfy the current output
    // contract even when a provider does not honor its structured-output schema.
    if (spec.strategy === "cognitive conflict" && spec.requireOpeningPhenomenon && !draft.visuals.some(visual => visual.id === "phenomenon")) throw new SlideRequestError("The opening phenomenon image plan is missing. Please retry generation.", 502);
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
  const stored = await workspaceGet<SlideJob>(partition(context.userId), jobKey(body.jobId));
  if (!stored || stored.ownerId !== context.userId || stored.classId !== context.classId || stored.assignmentId !== context.assignmentId) throw new SlideRequestError("Slide generation job not found.", 404);
  if (!Number.isFinite(stored.expiresAt) || stored.expiresAt <= Math.floor(Date.now() / 1000)) return terminal("This slide generation job expired. Your current draft is unchanged. Please try again.", 410);
  if (body.operation === "cancel") {
    if (!stored.cancelled) {
      await workspacePut([{ partition: partition(context.userId), key: jobKey(body.jobId), value: { ...stored, cancelled: true }, expiresAt: stored.expiresAt }]);
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
