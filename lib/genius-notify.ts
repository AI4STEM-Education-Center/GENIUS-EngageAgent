// Message type kept as "engage-agent.quiz-submitted" even though it now
// fires on Material Rating completion (#98), not quiz submission -- GENIUS's
// listener matches on this string, so changing it would need a coordinated
// change on the GENIUS side.
export const notifyTaskCompleted = (classId: string, assignmentId: string, geniusId: string) => {
  if (typeof window === "undefined" || window.parent === window) return;

  window.parent.postMessage(
    {
      type: "engage-agent.quiz-submitted",
      classId,
      assignmentId,
      geniusId,
    },
    "*",
  );
};

// A later publication makes an already-completed assignment active again.
// The hosting task validates the iframe window, origin and exact assignment.
export const notifyTaskReopened = (classId: string, assignmentId: string, geniusId: string) => {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage({ type: "engage-agent.activity-reopened", classId, assignmentId, geniusId }, "*");
};

// GENIUS standard-URL messages (/create, /edit, /delete). Sent only after the
// save or archive succeeds, and only to the configured GENIUS origin, never "*".
export type GeniusTaskEvent = "genius.task-created" | "genius.task-updated" | "genius.task-deleted";
export const notifyGeniusTask = (type: GeniusTaskEvent, task: { agentTaskId: string; title: string }, targetOrigin: string | null) => {
  if (typeof window === "undefined" || window.parent === window || !targetOrigin || targetOrigin === "*") return false;
  window.parent.postMessage({ type, version: 1, agentId: "EngageAgent", agentTaskId: task.agentTaskId, title: task.title }, targetOrigin);
  return true;
};
export const notifyTaskCreated = (task: { agentTaskId: string; title: string }, targetOrigin: string | null) =>
  notifyGeniusTask("genius.task-created", task, targetOrigin);
export const notifyTaskUpdated = (task: { agentTaskId: string; title: string }, targetOrigin: string | null) =>
  notifyGeniusTask("genius.task-updated", task, targetOrigin);
export const notifyTaskDeleted = (task: { agentTaskId: string; title: string }, targetOrigin: string | null) =>
  notifyGeniusTask("genius.task-deleted", task, targetOrigin);
