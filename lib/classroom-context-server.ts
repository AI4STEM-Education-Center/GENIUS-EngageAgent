import { createHash } from "node:crypto";
import { getClassProfile } from "./nosql";
import { getTaskInterests, type TaskInterests } from "./task-interests";
import { classProfileGenerationSummary, parseClassProfileAnswers, type ClassProfile } from "./class-profile";
import type { ClassroomContextSnapshot, ContextSource } from "./classroom-context";
import { isWorkspaceConflict, workspaceGet, workspacePut } from "./workspace-store";
import { GeniusContextError, geniusContextOrigin, linkedGeniusClass, liveGeniusContextEnabled, requestGeniusContext } from "./genius-context-client";

type Scope = { userId: string; classId: string; assignmentId: string };
type Payload = Omit<ClassroomContextSnapshot, "id">;
const digest = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const partition = (userId: string) => `CLASS_CONTEXT#${digest(userId)}`;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const timestamp = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;

// The profile, experience picker and context panel can refresh concurrently.
// Their idempotent cache/snapshot writes must not turn a transaction collision
// into a misleading provider outage. Retry conflicts only, with a small bound.
async function saveContext(records: Parameters<typeof workspacePut>[0]) {
  for (let attempt = 0; ; attempt++) {
    try { await workspacePut(records); return; }
    catch (error) {
      if (attempt >= 2 || !isWorkspaceConflict(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

/** Legacy v1 adapter parser. Live class-wide GENIUS v2 data is scope-checked
 * before conversion below. Callers must authorize the exact teacher/class/task. */
export function parseGeniusContext(value: unknown, scope: Scope): Payload {
  if (!record(value) || value.schemaVersion !== 1 || value.classId !== scope.classId || value.assignmentId !== scope.assignmentId
    || !text(value.version, 120) || !timestamp(value.updatedAt)) throw new Error("Incompatible GENIUS class information.");
  const base = { provider: "genius" as const, version: value.version, updatedAt: value.updatedAt, syncedAt: new Date().toISOString() };
  let profile: ContextSource<ClassProfile> = { ...base, status: "empty" };
  if (value.profile != null) {
    const parsed = parseClassProfileAnswers(value.profile);
    if ("error" in parsed) throw new Error("Invalid GENIUS class profile.");
    profile = { ...base, status: "ready", value: { ...parsed.answers, class_id: scope.classId, status: "saved", updated_at: value.updatedAt } };
  }
  let experiences: ContextSource<TaskInterests> = { ...base, status: "empty" };
  if (value.checkIn != null) {
    const checkIn = value.checkIn;
    if (!record(checkIn) || !count(checkIn.responseCount) || !Array.isArray(checkIn.activities) || checkIn.activities.length > 100) throw new Error("Invalid GENIUS check-in.");
    if (checkIn.classSize !== undefined && (!count(checkIn.classSize) || checkIn.classSize < checkIn.responseCount)) throw new Error("Invalid GENIUS class size.");
    const ids = new Set<string>();
    const activities = checkIn.activities.map(activity => {
      if (!record(activity) || !text(activity.id, 120) || ids.has(activity.id) || !text(activity.label, 160)
        || !count(activity.studentCount) || activity.studentCount > Number(checkIn.responseCount)
        || !count(activity.didCount) || !count(activity.watchedCount) || activity.didCount > activity.studentCount || activity.watchedCount > activity.studentCount) throw new Error("Invalid GENIUS experience.");
      ids.add(activity.id);
      if (activity.objects !== undefined && (!Array.isArray(activity.objects) || activity.objects.length > 5 || activity.objects.some(object => !record(object) || !text(object.name, 40) || !count(object.studentCount) || object.studentCount > Number(activity.studentCount)))) throw new Error("Invalid GENIUS object counts.");
      if (activity.incidents !== undefined && (!Array.isArray(activity.incidents) || activity.incidents.length > 3 || activity.incidents.some(incident => !text(incident, 400)))) throw new Error("Invalid GENIUS reviewed examples.");
      const objects = (activity.objects || []) as { name: string; studentCount: number }[];
      return { activityId: `genius:${activity.id}`, activity: activity.label, category: typeof activity.category === "string" ? activity.category.slice(0, 100) : "Everyday experience",
        studentCount: activity.studentCount, doCount: activity.didCount, watchedCount: activity.watchedCount,
        objects: objects.map(object => object.name), objectCounts: objects, incidents: (activity.incidents || []) as string[] };
    }).filter(activity => activity.studentCount > 0).sort((a, b) => b.studentCount - a.studentCount);
    const interests: TaskInterests = { classId: scope.classId, assignmentId: scope.assignmentId, surveyId: `genius:${value.version}`, dailyExperienceTopic: "Experience check-in",
      analyzedAt: value.updatedAt, responseCount: checkIn.responseCount, ...(checkIn.classSize === undefined ? {} : { classSize: checkIn.classSize as number }), unclassifiedCount: 0, enoughResponses: checkIn.responseCount >= 3,
      top: checkIn.responseCount >= 3 ? activities.slice(0, 2) : [], activities, stale: false };
    experiences = { ...base, status: checkIn.responseCount ? "ready" : "empty", value: interests };
  }
  return { schemaVersion: 1, classId: scope.classId, assignmentId: scope.assignmentId, profile, experiences,
    summary: [classProfileGenerationSummary(profile.value ?? null), experienceGenerationSummary(experiences.value)].filter(Boolean).join("\n\n"), geniusConnected: true };
}

function experienceGenerationSummary(experiences?: TaskInterests) {
  if (!experiences?.responseCount) return "";
  return [`GENIUS experience check-in: ${experiences.responseCount}${experiences.classSize === undefined ? "" : ` of ${experiences.classSize}`} students responded. Counts describe respondents, not the whole class.`,
    ...experiences.activities.slice(0, 5).map(activity => [
      `${activity.activity} (${activity.category}): ${activity.doCount} did it, ${activity.watchedCount} watched.`,
      activity.objectCounts?.length ? `Objects mentioned: ${activity.objectCounts.map(object => `${object.name} (${object.studentCount})`).join(", ")}.` : "",
      ...activity.incidents.map(example => `Teacher-reviewed example: ${example}`),
    ].filter(Boolean).join(" "))].join("\n");
}

async function localContext(scope: Scope): Promise<Payload> {
  const [profileResult, interestsResult] = await Promise.allSettled([getClassProfile(scope.classId), getTaskInterests(scope.classId, scope.assignmentId)]);
  const profileValue = profileResult.status === "fulfilled" ? profileResult.value : null;
  const interests = interestsResult.status === "fulfilled" ? interestsResult.value : null;
  const profile: ContextSource<ClassProfile> = { provider: "engageagent", status: profileResult.status === "rejected" ? "error" : profileValue?.status === "saved" ? "ready" : "empty",
    ...(profileValue ? { value: profileValue, version: profileValue.updated_at, updatedAt: profileValue.updated_at } : {}) };
  const experiences: ContextSource<TaskInterests> = { provider: "engageagent", status: interestsResult.status === "rejected" ? "error" : interests?.stale ? "stale" : interests?.responseCount ? "ready" : "empty",
    ...(interests ? { value: { ...interests, activities: interests.activities.map(a => ({ ...a, activityId: `local:${digest(a.activity.trim().toLowerCase()).slice(0, 24)}` })) }, version: digest(interests), updatedAt: interests.analyzedAt } : {}) };
  return { schemaVersion: 1, classId: scope.classId, assignmentId: scope.assignmentId, profile, experiences, summary: classProfileGenerationSummary(profileValue), geniusConnected: false };
}

export async function readClassroomContext(scope: Scope): Promise<ClassroomContextSnapshot> {
  const endpoint = process.env.GENIUS_CONTEXT_ENDPOINT;
  const geniusClassId = await linkedGeniusClass(scope);
  let payload: Payload;
  const cacheKey = `PROVIDER#${digest([scope.classId, scope.assignmentId, ...(geniusClassId ? [geniusClassId] : [])])}`;
  if (!endpoint && !geniusClassId) payload = await localContext(scope);
  else {
    try {
      let value: unknown;
      if (geniusClassId) {
        const raw = await requestGeniusContext(scope.userId, "classroom", geniusClassId);
        if (!record(raw) || raw.schemaVersion !== 2 || raw.classId !== geniusClassId) throw new Error("Incompatible GENIUS class information.");
        value = { ...raw, schemaVersion: 1, classId: scope.classId, assignmentId: scope.assignmentId };
      } else {
        const url = new URL(endpoint!);
        if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Invalid provider endpoint.");
        if (url.username || url.password || !process.env.GENIUS_CONTEXT_TOKEN) throw new Error("Provider configuration is incomplete.");
        url.searchParams.set("classId", scope.classId); url.searchParams.set("assignmentId", scope.assignmentId);
        const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.GENIUS_CONTEXT_TOKEN}`, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
        if ([401, 403].includes(response.status)) throw new GeniusContextError(response.status);
        if (!response.ok) throw new Error("Provider unavailable.");
        const raw = await response.text();
        if (raw.length > 100_000) throw new Error("Provider response is too large.");
        value = JSON.parse(raw);
      }
      payload = parseGeniusContext(value, scope);
      const previous = await workspaceGet<Payload>(partition(scope.userId), cacheKey);
      // Live v2 versions hash the exported facts. Removing the most recent
      // respondent can lower updatedAt, so it is not a monotonic v2 revision.
      if (!geniusClassId && previous?.profile.updatedAt && Date.parse(previous.profile.updatedAt) > Date.parse(payload.profile.updatedAt!)) payload = previous;
      else await saveContext([{ partition: partition(scope.userId), key: cacheKey, value: payload }]);
    } catch (error) {
      const previous = await workspaceGet<Payload>(partition(scope.userId), cacheKey);
      const denied = error instanceof GeniusContextError && [401, 403, 404].includes(error.status);
      const source = <T>(s?: ContextSource<T>): ContextSource<T> => denied ? { provider: "genius", status: "forbidden" } : s ? { ...s, status: s.status === "forbidden" ? "forbidden" : "stale" } : { provider: "genius", status: "error" };
      payload = { schemaVersion: 1, classId: scope.classId, assignmentId: scope.assignmentId, geniusConnected: true,
        profile: source(previous?.profile), experiences: source(previous?.experiences), summary: denied ? "" : previous?.summary || "" };
      if (denied) await saveContext([{ partition: partition(scope.userId), key: cacheKey, value: payload }]);
    }
  }
  if (liveGeniusContextEnabled()) payload = { ...payload, canLinkGenius: scope.classId.startsWith("ea-class-"),
    ...(geniusClassId ? { geniusClassId, geniusManageUrl: `${geniusContextOrigin()}/teacher/classes/${geniusClassId}/context` } : {}) };
  // Synced-at is display metadata, not a semantic version: polling unchanged
  // information must not continually prompt the teacher to accept a new version.
  const id = digest({ ...payload, profile: { ...payload.profile, syncedAt: undefined }, experiences: { ...payload.experiences, syncedAt: undefined } });
  const snapshot = JSON.parse(JSON.stringify({ ...payload, id })) as ClassroomContextSnapshot;
  await saveContext([{ partition: partition(scope.userId), key: `SNAPSHOT#${id}`, value: snapshot }]);
  return snapshot;
}

/** Pin the teacher-accepted version. Never substitute latest data mid-generation. */
export async function acceptedClassroomContext(scope: Scope, id: string): Promise<ClassroomContextSnapshot> {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error("Refresh the class information before generating.");
  const snapshot = await workspaceGet<ClassroomContextSnapshot>(partition(scope.userId), `SNAPSHOT#${id}`);
  if (!snapshot || (scope.classId && snapshot.classId !== scope.classId) || (scope.assignmentId && snapshot.assignmentId !== scope.assignmentId)) throw new Error("This class information does not belong to the selected task.");
  const sourceScope = { ...scope, classId: snapshot.classId, assignmentId: snapshot.assignmentId };
  const linked = await linkedGeniusClass(sourceScope);
  if ((snapshot.geniusClassId || null) !== linked) throw new Error("The connected GENIUS class changed. Refresh and accept the class information.");
  // Revalidate current ownership before using a pinned version for generation.
  // Fetching newer facts here does not replace the teacher-accepted snapshot.
  if (linked) await readClassroomContext(sourceScope);
  const latest = await workspaceGet<Payload>(partition(scope.userId), `PROVIDER#${digest([snapshot.classId, snapshot.assignmentId, ...(linked ? [linked] : [])])}`);
  if ([snapshot.profile.status, snapshot.experiences.status, latest?.profile.status, latest?.experiences.status].includes("forbidden")) throw new Error("This class information is not available to this account.");
  return snapshot;
}
