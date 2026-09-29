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
