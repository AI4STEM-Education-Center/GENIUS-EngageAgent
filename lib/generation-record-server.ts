import { createHash, randomUUID } from "node:crypto";
import { workspaceGet, workspacePut } from "./workspace-store";
import { GALLERY_TAG_LABELS } from "./material-gallery";
import type { MaterialTeachingContext } from "./material-teaching-context";
import type { GenerationFocus, GenerationRecord } from "./generation-record";
import type { ResolvedFocus } from "./strategy-focus";
import { toMisconceptionIds } from "./misconceptions";
import { SlideRequestError } from "./slides/server";
import { acceptedClassroomContext } from "./classroom-context-server";

type Scope = { userId: string; classId: string; assignmentId: string };
type Input = { lessonNumber: number; strategy: string; format: "slides" | "video"; operation: string; model: string;
  prompt: { system: string; user: string }; variables?: Record<string, unknown>; settings?: MaterialTeachingContext;
  focus?: ResolvedFocus | null; focusSelection?: unknown; parentId?: string; parameters?: Record<string, unknown> };
type Stored = { schemaVersion: 1; ownerId: string; classId: string; assignmentId: string; summary: GenerationRecord; input: Input };
const partition = (userId: string) => `GENERATION_INPUTS#${createHash("sha256").update(userId).digest("hex")}`;
const privateKeys = new Set(["CURRENT_UNDERSTANDING", "LEARNER_CONTEXT", "CLASS_PROFILE"]);

// Use the wording resolved in the lesson at generation time. In particular,
// never look up an old core-idea index in today's edited curriculum.
function capturedFocus(input: Input): GenerationFocus | undefined {
  const focus = input.focus;
  if (!focus || !["coreIdeas", "misconceptions"].includes(focus.kind) ||
    !Array.isArray(focus.items) || !focus.items.length || focus.items.length > 2 ||
    !focus.items.every(item => typeof item === "string" && item.trim())) return undefined;
  const selection = input.focusSelection as Partial<Record<ResolvedFocus["kind"], unknown[]>> | undefined;
  const ids = selection?.[focus.kind];
  const items = focus.items.map((label, index) => {
    const key = Array.isArray(ids) && ids.length === focus.items.length ? ids[index] : undefined;
    let id: string | undefined;
    if (focus.kind === "coreIdeas" && typeof key === "number" && Number.isSafeInteger(key) && key >= 0) id = `Core idea ${key + 1}`;
    if (focus.kind === "misconceptions" && typeof key === "string") id = toMisconceptionIds(input.lessonNumber, key)[0];
    return { label, ...(id ? { id } : {}) };
  });
  return { kind: focus.kind, origin: "operation", items };
}

function storedFocus(stored: Stored) {
  return stored.summary.focus ?? capturedFocus(stored.input);
}

function carriesMaterialFocus(operation: string) {
  return ["image", "image-revision", "video", "review", "review-slide"].includes(operation);
}

export async function recordGeneration(scope: Scope, input: Input): Promise<GenerationRecord> {
  let parentTags: Record<string, string> | undefined;
  let focus = capturedFocus(input);
  // A copied public material has its own source receipt. Only link a private
  // generation parent when it is owned by this teacher and matches this format.
  if (input.parentId) {
    const parent = /^[a-f0-9-]{36}$/u.test(input.parentId) ? await workspaceGet<Stored>(partition(scope.userId), input.parentId) : null;
    input = { ...input };
    if (!parent || parent.ownerId !== scope.userId || parent.summary.lessonNumber !== input.lessonNumber || parent.summary.strategy !== input.strategy || parent.summary.format !== input.format) delete input.parentId;
    else {
      parentTags = parent.summary.tags;
      const prior = storedFocus(parent);
      if (!focus && input.focus === undefined && prior && carriesMaterialFocus(input.operation)) {
        focus = { ...prior, origin: "source-material" };
      }
    }
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
  for (const [parameter, label] of [["duration", "DURATION"], ["size", "IMAGE_SIZE"], ["quality", "IMAGE_QUALITY"], ["aspect_ratio", "ASPECT_RATIO"], ["resolution", "RESOLUTION"], ["output_format", "MEDIA_ENCODING"]]) {
    const value = input.parameters?.[parameter];
    if (typeof value === "string" || typeof value === "number") tags[label] = `${value}${parameter === "duration" ? " seconds" : ""}`;
  }
  const summary: GenerationRecord = { id: randomUUID(), capturedAt: tags.INPUT_CAPTURED_AT, lessonNumber: input.lessonNumber, strategy: input.strategy,
    format: input.format, operation: input.operation, model: input.model, promptHash: createHash("sha256").update(JSON.stringify(input.prompt)).digest("hex"),
    ...(input.parentId ? { parentId: input.parentId } : {}), ...(focus ? { focus } : {}), tags };
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

/** Call only with heads loaded from an authorized material, never a client ID. */
export async function generationLineage(owners: string[], head: GenerationRecord) {
  const records: GenerationRecord[] = [];
  const seen = new Set<string>();
  let current: GenerationRecord | undefined = head;
  const partitions = [...new Set(owners)].map(partition);
  async function retained(id: string) {
    const candidates = await Promise.all(partitions.map(p => workspaceGet<Stored>(p, id)));
    return candidates.find(value => value && value.summary.id === id && owners.includes(value.ownerId) &&
      value.summary.lessonNumber === head.lessonNumber && value.summary.strategy === head.strategy && value.summary.format === head.format);
  }
  // Existing material heads predate focus snapshots. Only recover what their
  // authorized, original receipts actually contain, without updating the asset.
  if (!head.focus) {
    const original = await retained(head.id);
    const focus = original && storedFocus(original);
    if (focus) current = { ...head, focus };
  }
  while (current && records.length < 50 && !seen.has(current.id)) {
    records.push(current); seen.add(current.id);
    if (!current.parentId) return { records, incomplete: false };
    const parent = await retained(current.parentId);
    if (!parent) return { records, incomplete: true };
    const focus = storedFocus(parent);
    current = focus ? { ...parent.summary, focus } : parent.summary;
  }
  return { records, incomplete: !!current };
}
