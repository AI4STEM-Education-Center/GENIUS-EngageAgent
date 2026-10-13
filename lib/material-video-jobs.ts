import { createHash } from "node:crypto";
import { workspaceGet, workspacePut } from "./workspace-store";

export type MaterialVideoJobScope = { classId: string; assignmentId: string; studentId: string; contentItemId: string; ownerId: string };
type MaterialVideoJob = MaterialVideoJobScope & { requestId: string; expiresAt: number };
const partition = (classId: string) => `WORKSPACE#${classId}`;
const key = (requestId: string) => `MATERIAL_VIDEO_JOB#${createHash("sha256").update(requestId).digest("hex")}`;
export const validVideoRequestId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/u.test(value);
export const validVideoScopeId = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 160;

/** Record the provider ticket before returning it to the browser. Provider IDs
 * grant no access by themselves and never choose the destination for saved media. */
export async function saveMaterialVideoJob(requestId: string, scope: MaterialVideoJobScope) {
  if (!validVideoRequestId(requestId) || !Object.values(scope).every(validVideoScopeId)) throw new Error("Invalid video job context.");
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  await workspacePut([{ partition: partition(scope.classId), key: key(requestId), value: { ...scope, requestId, expiresAt }, createOnly: true, expiresAt }]);
}

export async function matchesMaterialVideoJob(requestId: string, scope: MaterialVideoJobScope): Promise<boolean> {
  if (!validVideoRequestId(requestId) || !Object.values(scope).every(validVideoScopeId)) return false;
  const job = await workspaceGet<MaterialVideoJob>(partition(scope.classId), key(requestId));
  return !!job && job.requestId === requestId && job.expiresAt > Math.floor(Date.now() / 1000)
    && Object.entries(scope).every(([field, value]) => job[field as keyof MaterialVideoJobScope] === value);
}
