import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { workspaceGet, workspacePut } from "./workspace-store";

type Scope = { userId: string; classId: string; assignmentId: string };
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const partition = (userId: string) => `GENIUS_CONTEXT_LINK#${digest(userId)}`;
export const liveGeniusContextEnabled = () => !process.env.GENIUS_CONTEXT_ENDPOINT && process.env.GENIUS_CONTEXT_MODE !== "disabled"
  && !!process.env.SSO_SECRET && (process.env.NODE_ENV === "production" || process.env.GENIUS_CONTEXT_MODE === "live");
export class GeniusContextError extends Error {
  constructor(public status: number) { super(status === 403 || status === 401 ? "This GENIUS class is not available to this account." : "GENIUS class information is temporarily unavailable."); }
}
export function geniusContextOrigin() {
  const url = new URL(process.env.GENIUS_URL || "https://learn.ai4genius.org");
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("Invalid GENIUS origin.");
  return url.origin;
}
/** Every GENIUS that may host an embedded class: GENIUS_URL first, then the other
 * GENIUS sites allowed to embed EngageAgent (ALLOWED_ORIGINS), such as staging. */
export function geniusContextOrigins() {
  const primary = geniusContextOrigin();
  let app: string | null = null;
  try { app = process.env.ENGAGE_APP_URL ? new URL(process.env.ENGAGE_APP_URL).origin : null; } catch { app = null; }
  const origins = [primary];
  for (const entry of (process.env.ALLOWED_ORIGINS ?? "").split(",").map(o => o.trim()).filter(Boolean)) {
    try {
      const url = new URL(entry);
      const allowed = url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
      if (allowed && !url.username && !url.password && url.origin !== app && !origins.includes(url.origin)) origins.push(url.origin);
    } catch { /* Not an origin; it cannot host a GENIUS class. */ }
  }
  return origins;
}
export async function requestGeniusContext(userId: string, action: "classes" | "classroom", classId?: string, origin = geniusContextOrigin()): Promise<unknown> {
  if (!liveGeniusContextEnabled()) throw new GeniusContextError(503);
  const key = createHash("sha256").update(`genius-classroom-context-v1\0${process.env.SSO_SECRET}`).digest();
  const token = await new SignJWT({ action, ...(classId ? { classId } : {}) }).setProtectedHeader({ alg: "HS256" })
    .setIssuer("engageagent").setAudience("genius-classroom-context").setSubject(userId).setIssuedAt().setExpirationTime("60s").sign(key);
  const url = new URL(`/api/sso/engage/context/${action}`, origin);
  if (classId) url.searchParams.set("classId", classId);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new GeniusContextError(response.status);
  const text = await response.text();
  if (text.length > 100_000) throw new GeniusContextError(502);
  return JSON.parse(text);
}
/** A GENIUS class lives on exactly one GENIUS (learn or staging have separate
 * classes). Ask each in turn; the first that recognizes the teacher's class
 * answers. Each GENIUS still checks that this teacher may see the class. */
export async function requestGeniusClassroom(userId: string, classId: string): Promise<{ value: unknown; origin: string }> {
  let failure: unknown = null, denied: GeniusContextError | null = null;
  for (const origin of geniusContextOrigins()) {
    try { return { value: await requestGeniusContext(userId, "classroom", classId, origin), origin }; }
    catch (error) {
      if (error instanceof GeniusContextError && [401, 403, 404].includes(error.status)) denied ??= error;
      else failure ??= error;
    }
  }
  // Report an outage before a denial: a GENIUS that could not answer may own the class.
  throw failure ?? denied ?? new GeniusContextError(503);
}
export async function listGeniusClasses(userId: string): Promise<{ id: string; name: string }[]> {
  const raw = await requestGeniusContext(userId, "classes") as { classes?: unknown };
  if (!Array.isArray(raw?.classes) || raw.classes.some(c => !c || !/^[a-f0-9]{24}$/i.test(c.id) || typeof c.name !== "string" || c.name.length > 500)) throw new GeniusContextError(502);
  return raw.classes.map(c => ({ id: c.id, name: c.name }));
}
export async function linkedGeniusClass(scope: Scope): Promise<string | null> {
  if (!liveGeniusContextEnabled()) return null;
  if (/^[a-f0-9]{24}$/i.test(scope.classId)) return scope.classId;
  if (!scope.classId.startsWith("ea-class-")) return null;
  return (await workspaceGet<{ classId: string }>(partition(scope.userId), digest(scope.classId)))?.classId || null;
}
/** The caller must first authorize this native teacher/class/task. GENIUS then
 * independently checks the same teacher owns the selected source class. */
export async function linkGeniusClass(scope: Scope, classId: string | null) {
  if (!scope.classId.startsWith("ea-class-") || !liveGeniusContextEnabled()) throw new Error("Only independent EngageAgent classes need a GENIUS connection.");
  if (classId !== null) {
    if (!/^[a-f0-9]{24}$/i.test(classId)) throw new Error("Choose one of your GENIUS classes.");
    const owned = await listGeniusClasses(scope.userId);
    if (!owned.some(c => c.id === classId)) throw new GeniusContextError(403);
  }
  await workspacePut([classId ? { partition: partition(scope.userId), key: digest(scope.classId), value: { classId } }
    : { partition: partition(scope.userId), key: digest(scope.classId), remove: true }]);
}
