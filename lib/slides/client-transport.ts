import { scopedClientAuthHeaders } from "../client-auth";

const REQUEST_TIMEOUT_MS = 15_000;
const SUBMIT_TIMEOUT_MS = 25_000;
const JOB_TIMEOUT_MS = 8 * 60_000;
const MAX_POLL_RETRIES = 3;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

class SlideTransportError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function requestJson(path: string, body: object, signal: AbortSignal, timeoutMs: number, headers: Record<string, string>, onResponse?: (status: number, data: Record<string, unknown>) => void) {
  signal.throwIfAborted();
  const request = new AbortController();
  const abort = () => request.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; request.abort(); }, timeoutMs);
  try {
    const response = await fetch(path, { method: "POST", headers,
      body: JSON.stringify(body), signal: request.signal, cache: "no-store" });
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new SlideTransportError(`The slide request did not finish (HTTP ${response.status}). Your current draft is retained. Retry the current step.`, RETRYABLE_STATUS.has(response.status)); }
    if (record(data)) onResponse?.(response.status, data);
    signal.throwIfAborted();
    if (!response.ok) throw new SlideTransportError(record(data) && typeof data.error === "string" ? data.error
      : `The slide request failed (HTTP ${response.status}). Your current draft is retained. Retry the current step.`, RETRYABLE_STATUS.has(response.status) && !(record(data) && data.jobFailure === true));
    if (!record(data)) throw new SlideTransportError("The server returned an incomplete slide response. Your current draft is retained. Retry the current step.");
    return { status: response.status, data };
  } catch (error) {
    signal.throwIfAborted();
    if (timedOut) throw new SlideTransportError("The slide connection timed out. Your current draft is retained. Retry the current step.", true);
    if (error instanceof SlideTransportError) throw error;
    throw new SlideTransportError("The slide connection was interrupted. Your current draft is retained. Retry the current step.", true);
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

function pendingJob(data: Record<string, unknown>) {
  const job = data.job;
  if (!record(job) || typeof job.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/u.test(job.id)) {
    throw new SlideTransportError("The server did not return a usable slide job. Your current draft is retained.");
  }
  return { id: job.id, pollAfterMs: typeof job.pollAfterMs === "number" && Number.isFinite(job.pollAfterMs)
    ? Math.max(500, Math.min(5000, job.pollAfterMs)) : 2000 };
}

/** Submit once, then poll that same operation. A transient poll never starts another model request. */
export async function postSlideRequest<T>(path: string, body: { classId?: string; assignmentId?: string } & object, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  if (!/^\/api\/slides(?:\/(?:check|image|revise))?$/u.test(path)) throw new Error("Invalid slide operation.");
  const headers = { "Content-Type": "application/json", ...scopedClientAuthHeaders(body) };
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let jobId: string | undefined;
  let cancelled = false;
  const cancel = () => {
    if (!jobId || cancelled) return;
    cancelled = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    // Best effort on Cancel, context change, unmount, or exhausted polling. This
    // small request has its own signal so cancelling generation does not cancel it.
    void fetch("/api/slides/jobs", { method: "POST", headers, cache: "no-store", keepalive: true,
      body: JSON.stringify({ classId: body.classId, assignmentId: body.assignmentId, jobId, operation: "cancel" }), signal: controller.signal })
      .catch(() => {}).finally(() => clearTimeout(timer));
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    let response = await requestJson(path, body, signal, SUBMIT_TIMEOUT_MS, headers, (status, data) => {
      if (status === 202) {
        jobId = pendingJob(data).id;
        // A response may arrive just as the view is cancelled. Capture its ticket
        // before observing abort so that this accepted job can still be cancelled.
        if (signal.aborted) cancel();
      }
    });
    if (response.status !== 202) return response.data as T;
    let pending = pendingJob(response.data);
    jobId = pending.id;
    let transientFailures = 0;
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new SlideTransportError("This slide step took too long. Your current draft is retained. Retry the current step.");
      await waitForPoll(Math.min(pending.pollAfterMs, remaining), signal);
      if (Date.now() >= deadline) throw new SlideTransportError("This slide step took too long. Your current draft is retained. Retry the current step.");
      try {
        response = await requestJson("/api/slides/jobs", { classId: body.classId, assignmentId: body.assignmentId, jobId }, signal,
          Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()), headers);
      } catch (error) {
        if (!(error instanceof SlideTransportError) || !error.retryable || ++transientFailures > MAX_POLL_RETRIES) throw error;
        pending = { ...pending, pollAfterMs: Math.min(5000, 1000 * 2 ** transientFailures) };
        continue;
      }
      transientFailures = 0;
      if (response.status !== 202) return response.data as T;
      pending = pendingJob(response.data);
      if (pending.id !== jobId) throw new SlideTransportError("The server returned a different slide job. Your current draft is retained.");
    }
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener("abort", cancel); }
}
