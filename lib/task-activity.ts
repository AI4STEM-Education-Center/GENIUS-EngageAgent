import type { UserContext } from "./auth";
import { agentTaskWrites, createAgentTaskOnce, getAgentTask, newAgentTask, taskActivityId, type AgentTask } from "./agent-tasks";
import { assignmentWrite, getWorkspaceAssignment, newWorkspaceAssignment, requireWorkspaceClass, WorkspaceError } from "./workspace";
import { workspacePut } from "./workspace-store";

// #176: an activity is the four teacher steps (assessment, strategy, materials,
// questions & discussion) for one class task. GENIUS activities already have a
// record (#153); these give EngageAgent's own class tasks one too. The task
// points to its activity; no #153 class link is written for `ea-class-*`
// classes. Step data stays keyed by class + task.

/** Creates a class task and its activity in one write. */
export async function createActivityTask(user: UserContext, classId: string, title: unknown) {
  const assignment = await newWorkspaceAssignment(user, classId, title);
  const activity = newAgentTask(user, assignment.title, taskActivityId(classId, assignment.id));
  const task = { ...assignment, activityId: activity.agentTaskId };
  await workspacePut([assignmentWrite(classId, task, true), ...agentTaskWrites(activity, true)]);
  return { assignment: task, activity };
}

/** The class task's activity, created the first time its teacher opens a task
 * made before #176. Teachers of the class only. */
export async function ensureTaskActivity(user: UserContext, classId: string, assignmentId: string): Promise<AgentTask> {
  if (user.role !== "teacher") throw new WorkspaceError("Teacher access required.", 403);
  await requireWorkspaceClass(user, classId);
  const assignment = await getWorkspaceAssignment(classId, assignmentId);
  if (!assignment) throw new WorkspaceError("Task not found in this class.", 404);
  if (assignment.activityId) {
    const existing = await getAgentTask(assignment.activityId);
    if (existing) return existing;
  }
  const activity = await createAgentTaskOnce(newAgentTask(user, assignment.title, taskActivityId(classId, assignmentId)));
  if (assignment.activityId !== activity.agentTaskId) {
    await workspacePut([assignmentWrite(classId, { ...assignment, activityId: activity.agentTaskId })]);
  }
  return activity;
}
