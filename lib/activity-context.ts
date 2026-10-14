import type { InterestActivity, TaskInterests } from "./task-interests";

export const CLASSROOM_CONTEXT_LIMIT = 1200;

/** A teacher can opt into this factual context before generating new materials. */
export function activityContextParagraph(interests: TaskInterests, activity: InterestActivity): string {
  const source = interests.stale ? "Survey context (last available analysis)" : "Survey context";
  const objects = activity.objects.length ? ` Reported objects: ${activity.objects.slice(0, 3).join(", ")}.` : "";
  return `${source}: In this task's survey on "${interests.dailyExperienceTopic}", ${activity.studentCount} of ${interests.responseCount} respondents mentioned ${activity.activity} (${activity.doCount} do it; ${activity.watchedCount} have watched it).${objects} Use this activity only when relevant to the lesson; do not assume it is familiar to every student.`;
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Counts can change on refresh; the same survey activity remains opted in. */
export function hasActivityContext(context: string, interests: TaskInterests, activity: InterestActivity): boolean {
  const topic = escapePattern(interests.dailyExperienceTopic);
  const name = escapePattern(activity.activity);
  return new RegExp(`(?:^|\\n\\n)Survey context(?: \\(last available analysis\\))?: In this task's survey on "${topic}", \\d+ of \\d+ respondents mentioned ${name} \\(\\d+ do it; \\d+ have watched it\\)\\.`).test(context);
}

/** Keep teacher-authored text byte-for-byte; never trim it to fit a suggestion. */
export function appendActivityContext(context: string, paragraph: string): string | null {
  if (context.includes(paragraph)) return context;
  const next = context ? `${context}\n\n${paragraph}` : paragraph;
  return next.length <= CLASSROOM_CONTEXT_LIMIT ? next : null;
}
