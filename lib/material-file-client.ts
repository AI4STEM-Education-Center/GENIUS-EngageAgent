import { isSafeMaterialUrl } from "./material-url";
import { scopedClientAuthHeaders } from "./client-auth";

export type MaterialFileScope = { classId?: string; assignmentId?: string };
export const MAX_MATERIAL_FILE_BYTES = 4_400_000;

/** Upload only already-prepared bytes, once. Unavailable attachment storage must
 * not prevent the existing local download; an explicit caller abort still wins. */
export async function uploadMaterialFile(blob: Blob, fileName: string, scope?: MaterialFileScope, signal?: AbortSignal): Promise<{ url: string; fileName: string } | undefined> {
  signal?.throwIfAborted();
  if (!scope?.classId || !scope.assignmentId || blob.size > MAX_MATERIAL_FILE_BYTES) return undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const query = new URLSearchParams({ classId: scope.classId, assignmentId: scope.assignmentId, fileName });
    const response = await fetch(`/api/material-files?${query}`, { method: "POST", headers: { "Content-Type": blob.type, ...scopedClientAuthHeaders(scope) },
      body: blob, signal: controller.signal, cache: "no-store" });
    signal?.throwIfAborted();
    if (!response.ok) return undefined;
    const result: unknown = await response.json();
    signal?.throwIfAborted();
    if (!result || typeof result !== "object" || !("url" in result) || typeof result.url !== "string"
      || !("fileName" in result) || typeof result.fileName !== "string" || !result.fileName) return undefined;
    if (!isSafeMaterialUrl(result.url)) return undefined;
    return { url: result.url.startsWith("/") ? result.url : new URL(result.url).href, fileName: result.fileName };
  } catch {
    signal?.throwIfAborted();
    return undefined;
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
