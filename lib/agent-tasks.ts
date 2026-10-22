import { randomUUID } from "node:crypto";
import type { UserContext } from "./auth";
import { isWorkspaceClass, WorkspaceError } from "./workspace";
import { workspaceGet, workspacePut, workspaceQuery } from "./workspace-store";

/** An EngageAgent activity that GENIUS embeds by `task_id` (/create, /edit, /view,
 * /delete, /launch). Separate from GENIUS's class, learning-task and assignment IDs,
 * and from the token's `taskId` claim. Student data stays keyed by class + assignment. */
export type AgentTask = {
  agentTaskId: string;
  title: string;
  ownerGeniusId: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};
/** One GENIUS class/assignment that uses this activity; an activity may have several. */
export type AgentTaskLink = { classId: string; assignmentId: string; linkedAt: string; linkedBy: string };

const AGENT_TASK_PATTERN = /^ea-agent-task-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const isAgentTaskId = (id: unknown): id is string => typeof id === "string" && AGENT_TASK_PATTERN.test(id);
const taskPartition = (id: string) => `AGENT_TASK#${id}`;
const ownerPartition = (geniusId: string) => `AGENT_TASK_OWNER#${geniusId}`;
const linkKey = (classId: string, assignmentId: string) => `LINK#${encodeURIComponent(classId)}#${encodeURIComponent(assignmentId)}`;

function title(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new WorkspaceError("Title must contain 1 to 120 characters.");
  return value.trim();
}

function scopeId(value: unknown) {
  return typeof value === "string" && value.trim() && value.length <= 160 ? value.trim() : null;
}

async function save(task: AgentTask, createOnly = false) {
  await workspacePut([
    { partition: taskPartition(task.agentTaskId), key: "META", value: task, createOnly },
    { partition: ownerPartition(task.ownerGeniusId), key: `TASK#${task.agentTaskId}`,
      value: { agentTaskId: task.agentTaskId, title: task.title, archived: task.archived }, createOnly },
  ]);
}

export async function getAgentTask(id: unknown): Promise<AgentTask | null> {
  return isAgentTaskId(id) ? workspaceGet<AgentTask>(taskPartition(id), "META") : null;
}

/** Unknown and malformed IDs share one answer so IDs cannot be probed. */
async function requireAgentTask(id: unknown) {
  const task = await getAgentTask(id);
  if (!task) throw new WorkspaceError("Activity not found.", 404);
  return task;
}

/** Teacher-only access to their own activity. Archived activities stay readable
 * only where asked (e.g. a repeated /delete confirmation). */
export async function requireOwnedAgentTask(user: UserContext, id: unknown, options: { allowArchived?: boolean } = {}) {
  if (user.role !== "teacher") throw new WorkspaceError("Teacher access required.", 403);
  const task = await requireAgentTask(id);
  if (task.ownerGeniusId !== user.geniusId) throw new WorkspaceError("You do not have access to this activity.", 403);
  if (task.archived && !options.allowArchived) throw new WorkspaceError("This activity is no longer available.", 410);
  return task;
}

export async function createAgentTask(user: UserContext, name: unknown) {
  if (user.role !== "teacher") throw new WorkspaceError("Only teachers can create activities.", 403);
  const now = new Date().toISOString();
  const task: AgentTask = { agentTaskId: `ea-agent-task-${randomUUID()}`, title: title(name),
    ownerGeniusId: user.geniusId, archived: false, createdAt: now, updatedAt: now };
  await save(task, true);
  return task;
}

export async function updateAgentTask(user: UserContext, id: unknown, changes: { title?: unknown }) {
  const task = await requireOwnedAgentTask(user, id);
  const next: AgentTask = { ...task, title: title(changes.title), updatedAt: new Date().toISOString() };
  await save(next);
  return next;
}

/** Archive, never delete: links, student answers, surveys and materials are kept. */
export async function archiveAgentTask(user: UserContext, id: unknown) {
  const task = await requireOwnedAgentTask(user, id, { allowArchived: true });
  if (task.archived) return task;
  const now = new Date().toISOString();
  const next: AgentTask = { ...task, archived: true, archivedAt: now, updatedAt: now };
  await save(next);
  return next;
}

export async function listAgentTaskLinks(id: string) {
  return workspaceQuery<AgentTaskLink>(taskPartition(id), "LINK#");
}

/** Record that a signed GENIUS class/assignment uses this activity. Native
 * `ea-class-*` classes are never linked; repeated launches keep the first link. */
export async function linkAgentTask(id: string, user: UserContext) {
  const classId = scopeId(user.classId), assignmentId = scopeId(user.assignmentId);
  if (!classId || !assignmentId || isWorkspaceClass(classId)) return null;
  const key = linkKey(classId, assignmentId);
  const existing = await workspaceGet<AgentTaskLink>(taskPartition(id), key);
  if (existing) return existing;
  const link: AgentTaskLink = { classId, assignmentId, linkedAt: new Date().toISOString(), linkedBy: user.geniusId };
  try {
    await workspacePut([{ partition: taskPartition(id), key, value: link, createOnly: true }]);
  } catch (error) {
    // A concurrent launch for the same class wrote it first.
    const raced = await workspaceGet<AgentTaskLink>(taskPartition(id), key);
    if (raced) return raced;
    throw error;
  }
  return link;
}

/** /launch: any signed-in GENIUS user whose token names a class and assignment.
 * Access to class data is still decided by that signed scope, not by task_id. */
export async function requireLaunchableAgentTask(user: UserContext, id: unknown) {
  const task = await requireAgentTask(id);
  if (task.archived) throw new WorkspaceError("This activity is no longer available.", 410);
  if (!scopeId(user.classId) || !scopeId(user.assignmentId) || isWorkspaceClass(user.classId)) {
    throw new WorkspaceError("Open this activity from its GENIUS class.", 403);
  }
  await linkAgentTask(task.agentTaskId, user);
  return task;
}
