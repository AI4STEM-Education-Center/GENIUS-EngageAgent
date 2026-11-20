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
// save or archive succeeds, and only to configured GENIUS origins, never "*".
// Learn and staging can both host these pages, so send to the one that is the
// parent window. If the parent cannot be identified, send to each configured
// origin: the browser delivers only to the one that matches the parent.
export type GeniusTaskEvent = "genius.task-created" | "genius.task-updated" | "genius.task-deleted";
const parentOrigin = () => {
  try {
    const ancestor = window.location?.ancestorOrigins?.[0];
    if (ancestor) return ancestor;
    return typeof document !== "undefined" && document.referrer ? new URL(document.referrer).origin : null;
  } catch { return null; }
};
export const notifyGeniusTask = (type: GeniusTaskEvent, task: { agentTaskId: string; title: string }, targetOrigins: readonly string[]) => {
  if (typeof window === "undefined" || window.parent === window) return false;
  const origins = targetOrigins.filter(origin => origin && origin !== "*");
  if (!origins.length) return false;
  const parent = parentOrigin();
  const message = { type, version: 1, agentId: "EngageAgent", agentTaskId: task.agentTaskId, title: task.title };
  for (const origin of parent && origins.includes(parent) ? [parent] : origins) window.parent.postMessage(message, origin);
  return true;
};
export const notifyTaskCreated = (task: { agentTaskId: string; title: string }, targetOrigins: readonly string[]) =>
  notifyGeniusTask("genius.task-created", task, targetOrigins);
export const notifyTaskUpdated = (task: { agentTaskId: string; title: string }, targetOrigins: readonly string[]) =>
  notifyGeniusTask("genius.task-updated", task, targetOrigins);
export const notifyTaskDeleted = (task: { agentTaskId: string; title: string }, targetOrigins: readonly string[]) =>
  notifyGeniusTask("genius.task-deleted", task, targetOrigins);
