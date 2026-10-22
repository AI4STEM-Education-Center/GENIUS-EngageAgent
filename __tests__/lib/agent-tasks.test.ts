import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archiveAgentTask, createAgentTask, getAgentTask, isAgentTaskId, linkAgentTask, listAgentTaskLinks, requireLaunchableAgentTask, requireOwnedAgentTask, updateAgentTask } from "@/lib/agent-tasks";
import { workspaceQuery } from "@/lib/workspace-store";
import type { UserContext } from "@/lib/auth";

const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Teacher", email: null, role: "teacher" };
const otherTeacher: UserContext = { ...teacher, geniusId: "teacher-2", userId: "teacher-2" };
const student: UserContext = { geniusId: "student-1", userId: "student-1", name: "Student", email: null, role: "student", classId: "class-a", assignmentId: "assign-a" };
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-agent-tasks-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir); vi.stubEnv("DYNAMODB_TABLE", "");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("agent task records", () => {
  it("creates an owned activity with its own ID and stores it outside engage-nosql.json", async () => {
    const task = await createAgentTask(teacher, "  Forces lesson  ");
    expect(isAgentTaskId(task.agentTaskId)).toBe(true);
    expect(task).toMatchObject({ title: "Forces lesson", ownerGeniusId: "teacher-1", archived: false });
    expect(await getAgentTask(task.agentTaskId)).toEqual(task);
    expect(await workspaceQuery(`AGENT_TASK_OWNER#teacher-1`, "TASK#")).toEqual([{ agentTaskId: task.agentTaskId, title: "Forces lesson", archived: false }]);
    expect(JSON.parse(await readFile(path.join(dir, "workspace.json"), "utf8"))).toHaveLength(2);
  });
  it("rejects students and invalid titles", async () => {
    await expect(createAgentTask(student, "x")).rejects.toMatchObject({ status: 403 });
    await expect(createAgentTask(teacher, "  ")).rejects.toMatchObject({ status: 400 });
    await expect(createAgentTask(teacher, "x".repeat(121))).rejects.toMatchObject({ status: 400 });
  });
  it("treats unknown and malformed IDs as not found", async () => {
    for (const id of ["ea-agent-task-00000000-0000-0000-0000-000000000000", "ea-task-1", "../x", undefined]) {
      expect(await getAgentTask(id)).toBeNull();
      await expect(requireOwnedAgentTask(teacher, id)).rejects.toMatchObject({ status: 404 });
      await expect(requireLaunchableAgentTask(student, id)).rejects.toMatchObject({ status: 404 });
    }
  });
});

describe("ownership", () => {
  it("lets only the owning teacher read, edit or archive", async () => {
    const task = await createAgentTask(teacher, "Forces");
    for (const user of [otherTeacher, { ...student, geniusId: "teacher-1" }]) {
      await expect(requireOwnedAgentTask(user, task.agentTaskId)).rejects.toMatchObject({ status: 403 });
      await expect(updateAgentTask(user, task.agentTaskId, { title: "Hijack" })).rejects.toMatchObject({ status: 403 });
      await expect(archiveAgentTask(user, task.agentTaskId)).rejects.toMatchObject({ status: 403 });
    }
    expect((await getAgentTask(task.agentTaskId))?.title).toBe("Forces");
  });
  it("updates the title in the record and the owner index", async () => {
    const task = await createAgentTask(teacher, "Forces");
    const updated = await updateAgentTask(teacher, task.agentTaskId, { title: "Forces and motion" });
    expect(updated).toMatchObject({ title: "Forces and motion", createdAt: task.createdAt });
    expect(await workspaceQuery(`AGENT_TASK_OWNER#teacher-1`, "TASK#")).toEqual([{ agentTaskId: task.agentTaskId, title: "Forces and motion", archived: false }]);
  });
});

describe("archiving", () => {
  it("archives instead of deleting and keeps links", async () => {
    const task = await createAgentTask(teacher, "Forces");
    await requireLaunchableAgentTask(student, task.agentTaskId);
    const archived = await archiveAgentTask(teacher, task.agentTaskId);
    expect(archived).toMatchObject({ archived: true, title: "Forces" });
    expect(archived.archivedAt).toBeTruthy();
    expect(await archiveAgentTask(teacher, task.agentTaskId)).toEqual(archived);
    expect(await getAgentTask(task.agentTaskId)).toEqual(archived);
    expect(await listAgentTaskLinks(task.agentTaskId)).toHaveLength(1);
  });
  it("blocks edit and launch of an archived activity", async () => {
    const task = await createAgentTask(teacher, "Forces");
    await archiveAgentTask(teacher, task.agentTaskId);
    await expect(requireOwnedAgentTask(teacher, task.agentTaskId)).rejects.toMatchObject({ status: 410 });
    await expect(updateAgentTask(teacher, task.agentTaskId, { title: "New" })).rejects.toMatchObject({ status: 410 });
    await expect(requireLaunchableAgentTask(student, task.agentTaskId)).rejects.toMatchObject({ status: 410, message: "This activity is no longer available." });
    expect(await requireOwnedAgentTask(teacher, task.agentTaskId, { allowArchived: true })).toMatchObject({ archived: true });
  });
});

describe("class links", () => {
  it("records each signed class/assignment once, for several classes", async () => {
    const task = await createAgentTask(teacher, "Forces");
    await requireLaunchableAgentTask(student, task.agentTaskId);
    await requireLaunchableAgentTask({ ...student, geniusId: "student-2" }, task.agentTaskId);
    await linkAgentTask(task.agentTaskId, { ...teacher, classId: "class-b", assignmentId: "assign-b" });
    const links = await listAgentTaskLinks(task.agentTaskId);
    expect(links.map(link => [link.classId, link.assignmentId, link.linkedBy]).sort()).toEqual([["class-a", "assign-a", "student-1"], ["class-b", "assign-b", "teacher-1"]]);
  });
  it("keeps IDs containing separators distinct", async () => {
    const task = await createAgentTask(teacher, "Forces");
    await linkAgentTask(task.agentTaskId, { ...teacher, classId: "a#b", assignmentId: "c" });
    await linkAgentTask(task.agentTaskId, { ...teacher, classId: "a", assignmentId: "b#c" });
    expect(await listAgentTaskLinks(task.agentTaskId)).toHaveLength(2);
  });
  it("never links native workspace classes or launches without a signed class", async () => {
    const task = await createAgentTask(teacher, "Forces");
    expect(await linkAgentTask(task.agentTaskId, { ...teacher, classId: "ea-class-1", assignmentId: "ea-task-1" })).toBeNull();
    expect(await linkAgentTask(task.agentTaskId, teacher)).toBeNull();
    await expect(requireLaunchableAgentTask({ ...student, classId: undefined }, task.agentTaskId)).rejects.toMatchObject({ status: 403 });
    await expect(requireLaunchableAgentTask({ ...student, classId: "ea-class-1" }, task.agentTaskId)).rejects.toMatchObject({ status: 403 });
    expect(await listAgentTaskLinks(task.agentTaskId)).toEqual([]);
  });
});
