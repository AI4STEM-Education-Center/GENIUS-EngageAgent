import type OpenAI from "openai";
import type { SlideJobSpec } from "@/lib/slides/jobs";
import { slideFailure, slideJson } from "@/lib/slides/server";

type ProviderResponse = OpenAI.Responses.Response;
type Params = OpenAI.Responses.ResponseCreateParamsNonStreaming;
type Finish = (response: ProviderResponse, spec: SlideJobSpec) => Record<string, unknown>;
type Provider = (params: Params, spec: SlideJobSpec, request: Request) => Promise<ProviderResponse>;
let provider: Provider;
let finalize: Finish;
let nextId = 0;
const completed = new Map<string, { response: ProviderResponse; spec: SlideJobSpec }>();

/** Historical teaching-contract tests simulate submission and a later completed
 * poll, while using the production finalizer. Actual 202/poll/auth behavior has
 * separate route/job tests; this harness never calls a network provider.
 */
export function installSlideJobHarness(finish: Finish, responseProvider: Provider) {
  finalize = finish;
  provider = responseProvider;
  completed.clear();
}

export async function beginTestSlideJob(request: Request, _authorized: { classId: string; assignmentId: string }, params: Params, spec: SlideJobSpec) {
  const response = await provider(params, spec, request);
  const id = `test-job-${++nextId}`;
  completed.set(id, { response, spec });
  return slideJson({ job: { id, pollAfterMs: 2000 } }, 202);
}

export async function finishSlideRoute(route: (request: Request) => Promise<Response>, request: Request) {
  const accepted = await route(request);
  if (accepted.status !== 202) return accepted;
  const { job } = await accepted.json();
  const result = completed.get(job.id);
  if (!result) throw new Error("Missing simulated background result.");
  completed.delete(job.id);
  try { return slideJson(finalize(result.response, result.spec)); }
  catch (error) { return slideFailure(error); }
}

export const completedTextResponse = (value: unknown) => ({
  id: "resp_fixture", status: "completed", output_text: JSON.stringify(value),
  output: [{ type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value), annotations: [] }] }],
});

export const completedImageResponse = (reply: { data?: Array<{ b64_json?: string }> }) => ({
  id: "resp_fixture", status: "completed", output_text: "",
  output: (reply.data ?? []).filter(item => item.b64_json).map(item => ({ type: "image_generation_call", status: "completed", result: item.b64_json })),
});
