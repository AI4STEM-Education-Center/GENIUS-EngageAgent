import { parseMaterialActivity } from "./material-activities";
import { materialInquiryIssues } from "./material-inquiry-quality";
import type { ContentItem } from "./types";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value);

/** AI can change language and scaffolding, never the facts depicted by saved media. */
export function applyVideoTextAdaptation(original: ContentItem, value: unknown): ContentItem {
  if (!record(value) || !text(value.title, 160)) throw new Error("The adapted title was incomplete. Your original is retained.");
  if (!original.activity) {
    if (!text(value.body, 16000)) throw new Error("The adapted text was incomplete. Your original is retained.");
    return { ...original, title: value.title.trim(), body: value.body.trim() };
  }
  if (!Array.isArray(value.stages) || value.stages.length !== original.activity.stages.length) throw new Error("The adapted activity was incomplete. Your original is retained.");
  const stages = value.stages;
  if (stages.some((stage, i) => !record(stage) || stage.id !== original.activity!.stages[i].id || !text(stage.title, 100) || !text(stage.text, 1600))) {
    throw new Error("The adapted stages were incomplete. Your original is retained.");
  }
  const activity = parseMaterialActivity({ ...original.activity, stages }, original.strategy);
  if (!activity) throw new Error("The adapted activity was invalid. Your original is retained.");
  const result = { ...original, title: value.title.trim(), activity, body: activity.stages.map(stage => `${stage.title}\n${stage.text}`).join("\n\n") };
  if (materialInquiryIssues(result, original.strategy).length) throw new Error("The adapted text revealed evidence too early or omitted an inquiry step. Your original is retained; try again.");
  return result;
}
