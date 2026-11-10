import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentTask, isAgentTaskId, listAgentTaskLinks, taskActivityId } from "@/lib/agent-tasks";
import { createActivityTask, ensureTaskActivity } from "@/lib/task-activity";
import { createWorkspaceAssignment, createWorkspaceClass, getWorkspaceAssignment, joinWorkspaceClass, workspaceClassDetail } from "@/lib/workspace";
import { workspaceQuery } from "@/lib/workspace-store";
import type { UserContext } from "@/lib/auth";

const teacher: UserContext = { geniusId: "teacher-1", userId: "teacher-1", name: "Teacher", email: null, role: "teacher" };
const otherTeacher: UserContext = { ...teacher, geniusId: "teacher-2", userId: "teacher-2" };
const student: UserContext = { geniusId: "student-1", userId: "student-1", name: "Student", email: null, role: "student" };
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "engage-task-activity-"));
  vi.stubEnv("ENGAGE_LOCAL_DATA_DIR", dir); vi.stubEnv("DYNAMODB_TABLE", "");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("class task activities (#176)", () => {
  it("creates the task and its activity together", async () => {
    const classroom = await createWorkspaceClass(teacher, "Physics");
    const { assignment, activity } = await createActivityTask(teacher, classroom.id, "  Forces  ");
    expect(isAgentTaskId(activity.agentTaskId)).toBe(true);
    expect(activity.agentTaskId).toBe(taskActivityId(classroom.id, assignment.id));
    expect(assignment).toMatchObject({ title: "Forces", activityId: activity.agentTaskId });
    expect(await getAgentTask(activity.agentTaskId)).toMatchObject({ title: "Forces", ownerGeniusId: "teacher-1", archived: false });
    expect((await workspaceClassDetail(teacher, classroom.id)).assignments).toEqual([assignment]);
    // It shows up with the teacher's other activities, but no GENIUS class link is made.
    expect(await workspaceQuery("AGENT_TASK_OWNER#teacher-1", "TASK#")).toEqual([{ agentTaskId: activity.agentTaskId, title: "Forces", archived: false }]);
    expect(await listAgentTaskLinks(activity.agentTaskId)).toEqual([]);
  });

  it("gives an older task an activity the first time its teacher opens it, once", async () => {
    const classroom = await createWorkspaceClass(teacher, "Physics");
    const older = await createWorkspaceAssignment(teacher, classroom.id, "Lesson 1");
    expect(older.activityId).toBeUndefined();
    const [a, b] = await Promise.all([ensureTaskActivity(teacher, classroom.id, older.id), ensureTaskActivity(teacher, classroom.id, older.id)]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ agentTaskId: taskActivityId(classroom.id, older.id), title: "Lesson 1" });
    expect((await getWorkspaceAssignment(classroom.id, older.id))?.activityId).toBe(a.agentTaskId);
    expect(await ensureTaskActivity(teacher, classroom.id, older.id)).toEqual(a);
    expect(await workspaceQuery("AGENT_TASK_OWNER#teacher-1", "TASK#")).toHaveLength(1);
  });

  it("keeps activities apart for each class and task", () => {
    expect(taskActivityId("ea-class-a", "ea-task-1")).not.toBe(taskActivityId("ea-class-b", "ea-task-1"));
    expect(taskActivityId("ea-class-a", "ea-task-1")).not.toBe(taskActivityId("ea-class-a", "ea-task-2"));
    expect(taskActivityId("ea-class-a", "ea-task-1")).toBe(taskActivityId("ea-class-a", "ea-task-1"));
  });

  it("is for the class's own teacher only", async () => {
    const classroom = await createWorkspaceClass(teacher, "Physics");
    const { assignment } = await createActivityTask(teacher, classroom.id, "Forces");
    await joinWorkspaceClass(student, classroom.joinCode);
    await expect(createActivityTask(student, classroom.id, "No")).rejects.toMatchObject({ status: 403 });
    await expect(createActivityTask(otherTeacher, classroom.id, "No")).rejects.toMatchObject({ status: 403 });
    await expect(ensureTaskActivity(student, classroom.id, assignment.id)).rejects.toMatchObject({ status: 403 });
    await expect(ensureTaskActivity(otherTeacher, classroom.id, assignment.id)).rejects.toMatchObject({ status: 403 });
    await expect(ensureTaskActivity(teacher, classroom.id, "ea-task-missing")).rejects.toMatchObject({ status: 404 });
    await expect(createActivityTask(teacher, classroom.id, " ")).rejects.toMatchObject({ status: 400 });
    expect((await workspaceClassDetail(teacher, classroom.id)).assignments).toHaveLength(1);
  });
});
