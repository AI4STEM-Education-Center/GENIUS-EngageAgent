import { classProfileGenerationSummary } from "./class-profile";
import { getClassProfile } from "./nosql";
import { acceptedClassroomContext } from "./classroom-context-server";
import { linkedGeniusClass } from "./genius-context-client";

/** Call only after authorizing this class/task. Never trust a profile supplied by a client. */
export async function materialClassroomContext(classId: string, taskContext = "", accepted?: { userId: string; assignmentId: string; contextRef?: string }): Promise<string> {
  if (accepted?.contextRef) {
    const context = await acceptedClassroomContext({ classId, userId: accepted.userId, assignmentId: accepted.assignmentId }, accepted.contextRef);
    return [context.summary, taskContext.trim() && `Teacher's task context: ${taskContext.trim()}`].filter(Boolean).join("\n\n");
  }
  if (!classId) return taskContext.trim();
  if (accepted && (process.env.GENIUS_CONTEXT_ENDPOINT || await linkedGeniusClass({ ...accepted, classId }))) throw new Error("Refresh and accept the class information before generating. Your additional context is retained.");
  let profile;
  try {
    profile = await getClassProfile(classId);
  } catch {
    throw new Error("Class profile is temporarily unavailable. Please retry generation.");
  }
  const summary = classProfileGenerationSummary(profile);
  return summary ? [summary, taskContext.trim() && `Teacher's task context: ${taskContext.trim()}`].filter(Boolean).join("\n\n") : taskContext.trim();
}
