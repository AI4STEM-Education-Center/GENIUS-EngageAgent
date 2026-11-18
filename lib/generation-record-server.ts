import { createHash, randomUUID } from "node:crypto";
import { workspaceGet, workspacePut } from "./workspace-store";
import { GALLERY_TAG_LABELS } from "./material-gallery";
import type { MaterialTeachingContext } from "./material-teaching-context";
import type { GenerationRecord } from "./generation-record";
import { SlideRequestError } from "./slides/server";
import { acceptedClassroomContext } from "./classroom-context-server";

type Scope = { userId: string; classId: string; assignmentId: string };
type Input = { lessonNumber: number; strategy: string; format: "slides" | "video"; operation: string; model: string;
  prompt: { system: string; user: string }; variables?: Record<string, unknown>; settings?: MaterialTeachingContext;
  focus?: unknown; parentId?: string; parameters?: Record<string, unknown> };
type Stored = { schemaVersion: 1; ownerId: string; classId: string; assignmentId: string; summary: GenerationRecord; input: Input };
const partition = (userId: string) => `GENERATION_INPUTS#${createHash("sha256").update(userId).digest("hex")}`;
const privateKeys = new Set(["CURRENT_UNDERSTANDING", "LEARNER_CONTEXT", "CLASS_PROFILE"]);

export async function recordGeneration(scope: Scope, input: Input): Promise<GenerationRecord> {
  let parentTags: Record<string, string> | undefined;
  // A copied public material has its own source receipt. Only link a private
  // generation parent when it is owned by this teacher and matches this format.
  if (input.parentId) {
    const parent = /^[a-f0-9-]{36}$/u.test(input.parentId) ? await workspaceGet<Stored>(partition(scope.userId), input.parentId) : null;
    input = { ...input };
    if (!parent || parent.ownerId !== scope.userId || parent.summary.lessonNumber !== input.lessonNumber || parent.summary.strategy !== input.strategy || parent.summary.format !== input.format) delete input.parentId;
    else parentTags = parent.summary.tags;
  }
  if (input.settings?.contextRef) {
    const context = await acceptedClassroomContext(scope, input.settings.contextRef);
    const experience = context.experiences.value?.activities.find(a => a.studentCount > 0 && (input.settings?.experienceId ? a.activityId === input.settings.experienceId && a.activity === input.settings.experienceContext : a.activity === input.settings?.experienceContext));
    const settings = { ...input.settings };
    if (settings.experienceSource === "reported") {
      if (experience) settings.experienceId = experience.activityId;
      else { settings.experienceSource = "teacher_entered"; delete settings.experienceId; }
    } else delete settings.experienceId;
    input = { ...input, settings, parameters: { ...input.parameters, contextVersions: { profile: context.profile.version, checkIn: context.experiences.version }, ...(experience && settings.experienceSource === "reported" ? { selectedExperience: experience } : {}) } };
  }
  let variables = input.variables;
  if (!variables) { try { variables = JSON.parse(input.prompt.user).referenceVariables; } catch { /* video and revision inputs are text */ } }
  const tags = Object.fromEntries(Object.entries({ ...parentTags, ...variables }).filter(([key, value]) => key in GALLERY_TAG_LABELS && !privateKeys.has(key) && value !== undefined)
    .map(([key, value]) => [key, (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 4000)]));
  Object.assign(tags, { SELECTED_STRATEGY: input.strategy, PREFERRED_MEDIA_TYPE: input.format === "slides" ? "Slide deck" : "Video activity",
    GRADE_LEVEL: input.settings?.gradeBand || "Not supplied", EXPERIENCE_CONTEXT: input.settings?.experienceContext || "Not supplied",
    CURRENT_UNDERSTANDING: input.settings?.quizPattern || "Not shared", LEARNER_CONTEXT: "Private class context retained with generation",
    MODEL: input.model, INPUT_CAPTURED_AT: new Date().toISOString() });
  const summary: GenerationRecord = { id: randomUUID(), capturedAt: tags.INPUT_CAPTURED_AT, lessonNumber: input.lessonNumber, strategy: input.strategy,
    format: input.format, operation: input.operation, model: input.model, promptHash: createHash("sha256").update(JSON.stringify(input.prompt)).digest("hex"),
    ...(input.parentId ? { parentId: input.parentId } : {}), tags };
  const stored = JSON.parse(JSON.stringify({ schemaVersion: 1, ownerId: scope.userId, classId: scope.classId, assignmentId: scope.assignmentId, summary, input })) as Stored;
  if (Buffer.byteLength(JSON.stringify(stored), "utf8") > 340_000) throw new SlideRequestError("The generation inputs are too large. Shorten the material or context.", 413);
  await workspacePut([{ partition: partition(scope.userId), key: summary.id, value: stored, createOnly: true }]);
  return summary;
}

/** A browser cannot forge generation provenance or load another teacher's inputs. */
export async function resolveGeneration(userId: string, value: unknown, lessonNumber: number, strategy: string, inherited?: GenerationRecord, format?: "slides" | "video"): Promise<GenerationRecord | undefined> {
  if (inherited && (inherited.lessonNumber !== lessonNumber || inherited.strategy !== strategy || (format && inherited.format !== format))) throw new SlideRequestError("Generation record does not belong to this material.", 422);
  if (value === undefined) return inherited;
  const id = value && typeof value === "object" && "id" in value ? value.id : value;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/u.test(id)) throw new SlideRequestError("Invalid generation record.", 422);
  if (inherited?.id === id) return inherited;
  const stored = await workspaceGet<Stored>(partition(userId), id);
  if (!stored || stored.ownerId !== userId || stored.summary.lessonNumber !== lessonNumber || stored.summary.strategy !== strategy || (format && stored.summary.format !== format)) throw new SlideRequestError("Generation record does not belong to this material.", 422);
  return stored.summary;
}
