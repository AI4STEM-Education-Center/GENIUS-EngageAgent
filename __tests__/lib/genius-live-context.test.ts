import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { jwtVerify } from "jose";
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/workspace-store", () => ({
  workspaceGet: vi.fn(async (p, k) => rows.get(`${p}:${k}`) || null),
  workspacePut: vi.fn(async records => { for (const r of records) { if (r.remove) rows.delete(`${r.partition}:${r.key}`); else rows.set(`${r.partition}:${r.key}`, structuredClone(r.value)); } }),
}));
vi.mock("@/lib/nosql", () => ({ getClassProfile: vi.fn(async () => null) }));
vi.mock("@/lib/task-interests", () => ({ getTaskInterests: vi.fn(async () => null) }));
import { linkedGeniusClass, linkGeniusClass, listGeniusClasses, liveGeniusContextEnabled } from "@/lib/genius-context-client";
import { readClassroomContext, acceptedClassroomContext } from "@/lib/classroom-context-server";
import { materialClassroomContext } from "@/lib/material-classroom-context";
import { EMPTY_CLASS_PROFILE } from "@/lib/class-profile";
import { resolveExperienceSelection } from "@/lib/material-experiences";
const teacher = "111111111111111111111111", classId = "aaaaaaaaaaaaaaaaaaaaaaaa", otherClass = "bbbbbbbbbbbbbbbbbbbbbbbb";
const scope = { userId: teacher, classId: "ea-class-synthetic", assignmentId: "ea-task-synthetic" };
const provider = () => ({ schemaVersion: 2, classId, version: "v1", updatedAt: "2026-11-18T00:00:00Z", profile: { ...EMPTY_CLASS_PROFILE, locale: "rural" }, checkIn: { responseCount: 1, activities: [{ id: "bike", label: "Riding a bicycle", studentCount: 1, didCount: 1, watchedCount: 0 }] } });
const fetcher = vi.fn();
beforeEach(() => {
  rows.clear(); vi.clearAllMocks(); vi.stubEnv("GENIUS_CONTEXT_ENDPOINT", ""); vi.stubEnv("GENIUS_CONTEXT_MODE", "live"); vi.stubEnv("GENIUS_URL", "https://learn.ai4genius.org"); vi.stubEnv("SSO_SECRET", "unit-context-secret");
  fetcher.mockImplementation(async (url: URL) => new Response(JSON.stringify(url.pathname.endsWith("/classes") ? { classes: [{ id: classId, name: "Owned QA class" }, { id: otherClass, name: "Another owned QA class" }] } : { ...provider(), classId: url.searchParams.get("classId") })));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("uses the existing SSO trust with a separate short-lived, action-bound service JWT", async () => {
  expect(await listGeniusClasses(teacher)).toHaveLength(2);
  const [url, init] = fetcher.mock.calls[0];
  expect(url.href).toBe("https://learn.ai4genius.org/api/sso/engage/context/classes");
  const token = init.headers.Authorization.slice(7);
  const key = createHash("sha256").update("genius-classroom-context-v1\0unit-context-secret").digest();
  const { payload } = await jwtVerify(token, key, { issuer: "engageagent", audience: "genius-classroom-context" });
  expect(payload).toMatchObject({ sub: teacher, action: "classes" }); expect(payload.exp! - payload.iat!).toBe(60);
  expect(init.redirect).toBe("error"); expect(init.cache).toBe("no-store");
});
it("does not guess links for independent classes and restricts connection to owned GENIUS classes", async () => {
  expect(await linkedGeniusClass(scope)).toBeNull(); expect((await readClassroomContext(scope)).geniusConnected).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(linkGeniusClass(scope, "cccccccccccccccccccccccc")).rejects.toThrow(/not available/);
  await linkGeniusClass(scope, classId); expect(await linkedGeniusClass(scope)).toBe(classId);
  expect(await linkedGeniusClass({ ...scope, userId: "other-teacher" })).toBeNull();
});
it("syncs real class-wide v2 data into a task-bound immutable snapshot and generation context", async () => {
  await linkGeniusClass(scope, classId);
  const context = await readClassroomContext(scope);
  expect(context).toMatchObject({ classId: scope.classId, assignmentId: scope.assignmentId, geniusClassId: classId, geniusConnected: true,
    experiences: { provider: "genius", status: "ready", value: { responseCount: 1, enoughResponses: false } } });
  expect(context.profile.value?.locale).toBe("rural"); expect(context.experiences.value?.activities[0].activityId).toBe("genius:bike");
  expect(await materialClassroomContext(scope.classId, "Keep this note", { ...scope, contextRef: context.id })).toContain("Keep this note");
  await expect(materialClassroomContext(scope.classId, "Keep this note", scope)).rejects.toThrow(/Refresh and accept/);
  await expect(acceptedClassroomContext({ ...scope, assignmentId: "other-task" }, context.id)).rejects.toThrow();
});
it("embedded MongoDB class scopes sync directly without a native class connection", async () => {
  const context = await readClassroomContext({ ...scope, classId });
  expect(context).toMatchObject({ geniusClassId: classId, canLinkGenius: false, geniusConnected: true });
  expect(fetcher.mock.calls[0][0].searchParams.get("classId")).toBe(classId);
});
it("rejects a provider scope mismatch and never relabels another class's facts", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ ...provider(), classId: otherClass })));
  const context = await readClassroomContext({ ...scope, classId });
  expect(context.profile.status).toBe("error"); expect(context.profile.value).toBeUndefined();
});
it("invalidates previously accepted data after changing or removing the class connection", async () => {
  await linkGeniusClass(scope, classId); const context = await readClassroomContext(scope);
  await linkGeniusClass(scope, otherClass);
  await expect(acceptedClassroomContext(scope, context.id)).rejects.toThrow(/connected GENIUS class changed/);
  const other = await readClassroomContext(scope); expect(other.geniusClassId).toBe(otherClass);
  await linkGeniusClass(scope, null);
  await expect(acceptedClassroomContext(scope, other.id)).rejects.toThrow(/connected GENIUS class changed/);
  expect((await readClassroomContext(scope)).geniusConnected).toBe(false);
});
it("revalidates ownership before generation and clears revoked provider data", async () => {
  await linkGeniusClass(scope, classId); const context = await readClassroomContext(scope);
  fetcher.mockImplementation(async () => new Response(null, { status: 403 }));
  await expect(acceptedClassroomContext(scope, context.id)).rejects.toThrow(/not available/);
  const latest = await readClassroomContext(scope); expect(latest.summary).toBe(""); expect(latest.profile.value).toBeUndefined();
});
it("keeps native class linking optional and provides an explicit rollout rollback", () => {
  expect(liveGeniusContextEnabled()).toBe(true);
  vi.stubEnv("GENIUS_CONTEXT_MODE", "disabled"); expect(liveGeniusContextEnabled()).toBe(false);
  vi.stubEnv("GENIUS_CONTEXT_MODE", ""); vi.stubEnv("NODE_ENV", "production"); expect(liveGeniusContextEnabled()).toBe(true);
});
it("accepts a reduced current aggregate after removing the most recent respondent", async () => {
  const embedded = { ...scope, classId };
  const first = await readClassroomContext(embedded);
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ ...provider(), version: "removed", updatedAt: "2026-11-17T00:00:00Z", checkIn: { responseCount: 0, activities: [] } })));
  const next = await readClassroomContext(embedded);
  expect(next.id).not.toBe(first.id); expect(next.experiences.value?.responseCount).toBe(0);
});
it("does not describe unanswered or skipped questionnaire options as reported experiences", async () => {
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ ...provider(), checkIn: { responseCount: 1,
    activities: [...provider().checkIn.activities, { id: "skipped", label: "Skipped example", studentCount: 0, didCount: 0, watchedCount: 0 }] } })));
  const context = await readClassroomContext({ ...scope, classId });
  expect(context.experiences.value?.responseCount).toBe(1);
  expect(context.experiences.value?.activities.map(a => a.activity)).toEqual(["Riding a bicycle"]);
  expect(resolveExperienceSelection("Skipped example", "reported", "genius:skipped", [{ activityId: "genius:skipped", activity: "Skipped example", category: "Everyday", studentCount: 0, doCount: 0, watchedCount: 0, objects: [], incidents: [] }]).missing).toBe(true);
});
