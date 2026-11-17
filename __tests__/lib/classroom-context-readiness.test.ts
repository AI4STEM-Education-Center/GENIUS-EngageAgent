import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/workspace-store", () => ({
  workspaceGet: vi.fn(async (p, k) => store.get(`${p}:${k}`) ?? null),
  workspacePut: vi.fn(async rows => { for (const r of rows) { if (r.remove) store.delete(`${r.partition}:${r.key}`); else store.set(`${r.partition}:${r.key}`, structuredClone(r.value)); } }),
}));
vi.mock("@/lib/nosql", () => ({ getClassProfile: vi.fn(async () => null) }));
vi.mock("@/lib/task-interests", () => ({ getTaskInterests: vi.fn(async () => null) }));
import { EMPTY_CLASS_PROFILE } from "@/lib/class-profile";
import { readClassroomContext, acceptedClassroomContext, parseGeniusContext } from "@/lib/classroom-context-server";
import { getClassProfile } from "@/lib/nosql";
import { materialClassroomContext } from "@/lib/material-classroom-context";
const scope = { userId: "teacher-a", classId: "class-a", assignmentId: "task-a" };
const fixture = () => ({ schemaVersion: 1, classId: scope.classId, assignmentId: scope.assignmentId, version: "v1", updatedAt: "2026-11-17T12:00:00.000Z",
  profile: { ...EMPTY_CLASS_PROFILE, locale: "rural" }, checkIn: { responseCount: 4, activities: [{ id: "soccer", label: "Soccer", studentCount: 3, didCount: 2, watchedCount: 1 }] } });
beforeEach(() => { store.clear(); vi.clearAllMocks(); vi.stubEnv("GENIUS_CONTEXT_ENDPOINT", ""); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("GENIUS context readiness", () => {
  it("distinguishes disconnected local data from a connected empty check-in", async () => {
    const local = await readClassroomContext(scope);
    expect(local).toMatchObject({ geniusConnected: false, profile: { status: "empty", provider: "engageagent" } });
    expect(parseGeniusContext({ ...fixture(), checkIn: { responseCount: 0, activities: [] } }, scope).experiences).toMatchObject({ status: "empty", provider: "genius", value: { responseCount: 0 } });
  });
  it("validates scope, version, counts and stable experience IDs", () => {
    const raw = fixture();
    expect(parseGeniusContext(raw, scope).experiences.value?.activities[0].activityId).toBe("genius:soccer");
    expect(() => parseGeniusContext({ ...raw, classId: "another" }, scope)).toThrow();
    expect(() => parseGeniusContext({ ...raw, schemaVersion: 2 }, scope)).toThrow();
    expect(() => parseGeniusContext({ ...raw, checkIn: { ...raw.checkIn, responseCount: 1 } }, scope)).toThrow();
    expect(() => parseGeniusContext({ ...raw, checkIn: { ...raw.checkIn, activities: [...raw.checkIn.activities, ...raw.checkIn.activities] } }, scope)).toThrow();
  });
  it("pins an accepted version and rejects another teacher/task", async () => {
    vi.mocked(getClassProfile).mockResolvedValueOnce({ ...EMPTY_CLASS_PROFILE, locale: "rural", class_id: scope.classId, status: "saved", updated_at: "2026-11-17T12:00:00Z" });
    const first = await readClassroomContext(scope);
    const next = await readClassroomContext(scope);
    expect(first.id).not.toBe(next.id);
    expect((await acceptedClassroomContext(scope, first.id)).profile.value?.locale).toBe("rural");
    await expect(acceptedClassroomContext({ ...scope, userId: "teacher-b" }, first.id)).rejects.toThrow();
    await expect(acceptedClassroomContext({ ...scope, assignmentId: "task-b" }, first.id)).rejects.toThrow();
  });
  it("keeps stale values on failure but drops cached values on forbidden", async () => {
    vi.stubEnv("GENIUS_CONTEXT_ENDPOINT", "https://genius.example.test/context"); vi.stubEnv("GENIUS_CONTEXT_TOKEN", "test-only");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture()))).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    const first = await readClassroomContext(scope);
    expect(first.profile.status).toBe("ready");
    expect((await readClassroomContext(scope)).profile).toMatchObject({ status: "stale", value: { locale: "rural" } });
    const denied = await readClassroomContext(scope);
    expect(denied.profile).toEqual({ provider: "genius", status: "forbidden" });
    expect(denied.summary).toBe("");
    await expect(acceptedClassroomContext(scope, first.id)).rejects.toThrow(/not available/);
    expect(fetcher.mock.calls[0][0].searchParams.get("classId")).toBe(scope.classId);
  });
  it("does not create new semantic versions just because the sync time changed", async () => {
    vi.stubEnv("GENIUS_CONTEXT_ENDPOINT", "https://genius.example.test/context"); vi.stubEnv("GENIUS_CONTEXT_TOKEN", "test-only");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(fixture()))));
    expect((await readClassroomContext(scope)).id).toBe((await readClassroomContext(scope)).id);
  });
  it("retains a newer accepted provider version when an older response arrives", async () => {
    vi.stubEnv("GENIUS_CONTEXT_ENDPOINT", "https://genius.example.test/context"); vi.stubEnv("GENIUS_CONTEXT_TOKEN", "test-only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...fixture(), version: "v2", updatedAt: "2026-11-17T13:00:00Z" }))).mockResolvedValueOnce(new Response(JSON.stringify(fixture()))));
    const newer = await readClassroomContext(scope);
    expect((await readClassroomContext(scope)).id).toBe(newer.id);
  });
  it("cannot bypass a configured provider by omitting the accepted context reference", async () => {
    vi.stubEnv("GENIUS_CONTEXT_ENDPOINT", "https://genius.example.test/context");
    await expect(materialClassroomContext(scope.classId, "My supplement", scope)).rejects.toThrow(/Refresh and accept/);
    expect(getClassProfile).not.toHaveBeenCalled();
  });
});
