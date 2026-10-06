import { CURRENT_MODEL, TEXT_MODELS, IMAGE_MODELS, slideTextModelLabel, type SlideModelCatalog } from "./models";
import { SlideRequestError } from "./server";

function configuredModels() {
  return {
    text: process.env.OPENAI_SLIDES_MODEL?.trim() || "gpt-6.1-sol",
    image: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
  };
}

export function slideModelCatalog(): SlideModelCatalog {
  const current = configuredModels();
  return {
    text: [{ id: CURRENT_MODEL, label: `Slides default (${current.text})` }, ...TEXT_MODELS.map(id => ({ id, label: slideTextModelLabel(id) }))],
    image: [{ id: CURRENT_MODEL, label: `Project default (${current.image})` }, ...IMAGE_MODELS.map(id => ({ id, label: `OpenAI - ${id}` }))],
  };
}

export function resolveSlideModel(kind: "text" | "image", selection: unknown): string {
  if (selection === undefined || selection === CURRENT_MODEL) return configuredModels()[kind];
  const allowed: readonly string[] = kind === "text" ? TEXT_MODELS : IMAGE_MODELS;
  if (typeof selection !== "string" || !allowed.includes(selection)) throw new SlideRequestError(`Choose a supported ${kind} model.`);
  return selection;
}

function hasQualityProfile(model: string) {
  // Only apply these settings to model IDs with documented API compatibility.
  return model === "gpt-6-astra" || model === "gpt-6.1-sol";
}

export function slideTextSettings(model: string) {
  // A short reasoning pass is needed for stage ordering and specific corrections.
  return hasQualityProfile(model) || /^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/u.test(model)
    ? { reasoning_effort: "low" as const } : {};
}

export function slideTextRequestLimits(model: string, operation: "generate" | "check") {
  // Completion limits include private reasoning as well as the visible JSON.
  // These bounded pilot allowances need measurement against real classroom drafts.
  if (hasQualityProfile(model)) return { timeoutMs: 110_000, maxCompletionTokens: operation === "generate" ? 12_000 : 8_000 };
  return { timeoutMs: 50_000, maxCompletionTokens: operation === "generate" ? 4200 : 3200 };
}

export function existingGenerationKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.trim()) throw new SlideRequestError("The project's existing OPENAI_API_KEY is not available in this server environment. Restore that configuration; no separate Slides key is required.", 503);
  return key;
}
