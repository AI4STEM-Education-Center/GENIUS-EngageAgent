import type { UserContext } from "./auth";

export type ClientAuthScope = { classId?: string; assignmentId?: string };

// Only AuthProvider's successful verification establishes an embedded identity.
// Keeping it in memory also works when third-party sessionStorage is unavailable.
let activeIdentity: { token: string; classId: string; assignmentId: string } | null = null;
// GENIUS standard URLs (/create, /edit, /view, /delete, /launch) may carry no class.
let activeEmbedToken: string | null = null;

export function clearVerifiedClientAuth() {
  activeIdentity = null;
  activeEmbedToken = null;
}

export function setVerifiedClientAuth(token: string, user: UserContext) {
  clearVerifiedClientAuth();
  if (token && !user.classId?.startsWith("ea-class-")) activeEmbedToken = token;
  if (token && user.classId && user.assignmentId && !user.classId.startsWith("ea-class-")) {
    activeIdentity = { token, classId: user.classId, assignmentId: user.assignmentId };
  }
}

/** Capture once per operation; use only on protected, same-origin API requests.
 * Never copy these headers onto images, links, or downloadable files. */
export function scopedClientAuthHeaders(scope: ClientAuthScope): Record<string, string> {
  if (!activeIdentity || scope.classId !== activeIdentity.classId || scope.assignmentId !== activeIdentity.assignmentId) return {};
  return { Authorization: `Bearer ${activeIdentity.token}` };
}

/** Only attach the verified launch credential to our task APIs. Never forward
 * it to media URLs, provider endpoints, downloads, or public lesson assets. */
export function scopedTaskFetch(scope: ClientAuthScope, input: string, init?: RequestInit): Promise<Response> {
  const protectedPath = /^\/api\/(?:quiz-status|student-answers|strategy-cache|strategy-job(?:\/[^/?]+)?|strategy-single|strategy-batch|content-publish|content-rating|review-questions|activity-status|media|surveys(?:\/publish)?|survey-responses|teacher-annotation|engagement-(?:content|plan|image|video)(?:\/status)?|auto-answer-test-students)(?:\?|$)/u.test(input);
  if (!protectedPath) return fetch(input, init);
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(scopedClientAuthHeaders(scope))) headers.set(key, value);
  return fetch(input, { ...init, headers });
}

/** The activity API authorizes by the verified GENIUS token alone, so it is the
 * only request that receives it without a matching class scope. */
export function agentTaskFetch(body: Record<string, unknown>): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (activeEmbedToken) headers.Authorization = `Bearer ${activeEmbedToken}`;
  return fetch("/api/agent-tasks", { method: "POST", headers, body: JSON.stringify(body) });
}
