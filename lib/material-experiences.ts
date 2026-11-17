export type ExperienceSuggestions = {
  suggestions: { activity: string; reason: string }[];
  fit: { activity: string; fit: "good" | "weak"; reason: string }[];
};
export function parseExperienceSuggestions(value: unknown, activities: string[]): ExperienceSuggestions {
  if (!value || typeof value !== "object") throw new Error("Experience suggestions could not be read. Try again.");
  const input = value as ExperienceSuggestions;
  const valid = (entry: { activity: string; reason: string }) => entry && typeof entry.activity === "string" && entry.activity.trim().length > 0 && entry.activity.length <= 160
    && typeof entry.reason === "string" && entry.reason.trim().length > 0 && entry.reason.length <= 300;
  if (!Array.isArray(input.suggestions) || !input.suggestions.length || input.suggestions.length > 3 || !input.suggestions.every(valid)
    || !Array.isArray(input.fit) || input.fit.length !== activities.length || new Set(input.fit.map(entry => entry.activity)).size !== activities.length || input.fit.some(entry => !valid(entry) || !activities.includes(entry.activity) || !["good", "weak"].includes(entry.fit))) {
    throw new Error("Experience suggestions were incomplete. Try again.");
  }
  return { suggestions: input.suggestions.map(({ activity, reason }) => ({ activity: activity.trim(), reason })),
    fit: input.fit.map(({ activity, fit, reason }) => ({ activity, fit, reason })) };
}
export function resolveExperienceSelection(value: string, source: "reported" | "ai_suggested" | "teacher_entered" | undefined, activityId: string | undefined, activities: import("./task-interests").TaskInterests["activities"] = []) {
  const reported = source === "ai_suggested" || source === "teacher_entered" ? undefined
    : activities.find(item => activityId ? item.activityId === activityId : item.activity === value);
  return { value: reported?.activity || value, reported, missing: Boolean(value && source === "reported" && !reported) };
}
