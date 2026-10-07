import type { UserContext } from "./auth";

export type ClientAuthScope = { classId?: string; assignmentId?: string };

// Only AuthProvider's successful verification establishes an embedded identity.
// Keeping it in memory also works when third-party sessionStorage is unavailable.
let activeIdentity: { token: string; classId: string; assignmentId: string } | null = null;

export function clearVerifiedClientAuth() {
  activeIdentity = null;
}

export function setVerifiedClientAuth(token: string, user: UserContext) {
  clearVerifiedClientAuth();
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
