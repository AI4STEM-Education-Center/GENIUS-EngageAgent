import { randomBytes, randomUUID } from "node:crypto";
import type { UserContext } from "./auth";
import { workspaceGet, workspacePut, workspaceQuery } from "./workspace-store";

export type WorkspaceClass = { id: string; name: string; teacherGeniusId: string; joinCode: string; createdAt: string };
export type WorkspaceAssignment = { id: string; title: string; createdAt: string };
export type WorkspaceMember = { geniusId: string; name: string };
export class WorkspaceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const classPartition = (id: string) => `WORKSPACE#${id}`;
export const isWorkspaceClass = (id: unknown): id is string => typeof id === "string" && id.startsWith("ea-class-");

function label(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new WorkspaceError(`${name} must contain 1 to 120 characters.`);
  return value.trim();
}

export async function listWorkspaceClasses(user: UserContext) {
  return workspaceQuery<{ id: string; name: string }>(`WORKSPACE_USER#${user.geniusId}`, "CLASS#");
}

export async function requireWorkspaceClass(user: UserContext, id: string): Promise<WorkspaceClass> {
  const classroom = await workspaceGet<WorkspaceClass>(classPartition(id), "META");
  if (!classroom) throw new WorkspaceError("Class not found.", 404);
  if (user.role === "teacher" && classroom.teacherGeniusId === user.geniusId) return classroom;
  if (user.role !== "teacher" && await workspaceGet(classPartition(id), `MEMBER#${user.geniusId}`)) return classroom;
  throw new WorkspaceError("You do not have access to this class.", 403);
}

export async function createWorkspaceClass(user: UserContext, name: unknown) {
  if (user.role !== "teacher") throw new WorkspaceError("Only teachers can create classes.", 403);
  const classroom: WorkspaceClass = { id: `ea-class-${randomUUID()}`, name: label(name, "Class name"),
    teacherGeniusId: user.geniusId, joinCode: randomBytes(8).toString("hex").toUpperCase(), createdAt: new Date().toISOString() };
  await workspacePut([
    { partition: classPartition(classroom.id), key: "META", value: classroom, createOnly: true },
    { partition: `WORKSPACE_USER#${user.geniusId}`, key: `CLASS#${classroom.id}`, value: { id: classroom.id, name: classroom.name }, createOnly: true },
    { partition: `WORKSPACE_JOIN#${classroom.joinCode}`, key: "META", value: { classId: classroom.id }, createOnly: true },
  ]);
  return classroom;
}

export async function joinWorkspaceClass(user: UserContext, code: unknown) {
  if (user.role === "teacher") throw new WorkspaceError("Join a class using a student account.", 403);
  if (typeof code !== "string" || !/^[A-Fa-f0-9]{16}$/.test(code.trim())) throw new WorkspaceError("Enter a valid class code.");
  const found = await workspaceGet<{ classId: string }>(`WORKSPACE_JOIN#${code.trim().toUpperCase()}`, "META");
  if (!found) throw new WorkspaceError("Class code not found.", 404);
  const classroom = await workspaceGet<WorkspaceClass>(classPartition(found.classId), "META");
  if (!classroom) throw new WorkspaceError("Class not found.", 404);
  await workspacePut([
    { partition: classPartition(classroom.id), key: `MEMBER#${user.geniusId}`, value: { geniusId: user.geniusId, name: user.name } },
    { partition: `WORKSPACE_USER#${user.geniusId}`, key: `CLASS#${classroom.id}`, value: { id: classroom.id, name: classroom.name } },
  ]);
  return { id: classroom.id, name: classroom.name };
}

export async function workspaceClassDetail(user: UserContext, id: string) {
  const classroom = await requireWorkspaceClass(user, id);
  const assignments = await workspaceQuery<WorkspaceAssignment>(classPartition(id), "ASSIGN#");
  const members = user.role === "teacher" ? await workspaceQuery<WorkspaceMember>(classPartition(id), "MEMBER#") : [];
  return { classroom: { id: classroom.id, name: classroom.name, ...(user.role === "teacher" ? { joinCode: classroom.joinCode } : {}) }, assignments, members };
}

export async function createWorkspaceAssignment(user: UserContext, classId: string, title: unknown) {
  await requireWorkspaceClass(user, classId);
  if (user.role !== "teacher") throw new WorkspaceError("Only teachers can create tasks.", 403);
  const assignment: WorkspaceAssignment = { id: `ea-task-${randomUUID()}`, title: label(title, "Task title"), createdAt: new Date().toISOString() };
  await workspacePut([{ partition: classPartition(classId), key: `ASSIGN#${assignment.id}`, value: assignment, createOnly: true }]);
  return assignment;
}

export async function workspaceContext(user: UserContext, classId: string, assignmentId: string): Promise<UserContext> {
  const classroom = await requireWorkspaceClass(user, classId);
  if (!await workspaceGet(classPartition(classId), `ASSIGN#${assignmentId}`)) throw new WorkspaceError("Task not found in this class.", 404);
  return { ...user, classId, className: classroom.name, assignmentId, taskId: assignmentId };
}
