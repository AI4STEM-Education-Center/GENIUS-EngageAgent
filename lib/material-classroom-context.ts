import { classProfileGenerationSummary } from "./class-profile";
import { getClassProfile } from "./nosql";

/** Call only after authorizing this class/task. Never trust a profile supplied by a client. */
export async function materialClassroomContext(classId: string, taskContext = ""): Promise<string> {
  let profile;
  try {
    profile = await getClassProfile(classId);
  } catch {
    throw new Error("Class profile is temporarily unavailable. Please retry generation.");
  }
  const summary = classProfileGenerationSummary(profile);
  return summary ? [summary, taskContext.trim() && `Teacher's task context: ${taskContext.trim()}`].filter(Boolean).join("\n\n") : taskContext.trim();
}
