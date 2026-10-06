export const CURRENT_MODEL = "current";
export const TEXT_MODELS = ["gpt-6-astra", "gpt-6.1-sol", "gpt-4.1", "gpt-5-mini"] as const;
export const IMAGE_MODELS = ["gpt-image-1", "gpt-image-1.5", "gpt-image-2"] as const;
export type SlideModelOption = { id: string; label: string };
export type SlideModelCatalog = { text: SlideModelOption[]; image: SlideModelOption[] };
export type SlideModelSelection = { textModel: string; imageModel: string };
export const DEFAULT_MODEL_SELECTION: SlideModelSelection = { textModel: CURRENT_MODEL, imageModel: CURRENT_MODEL };

export function slideTextModelLabel(id: string) {
  if (id === "gpt-6-astra") return "OpenAI - gpt-6-astra (quality)";
  if (id === "gpt-6.1-sol") return "OpenAI - gpt-6.1-sol (balanced)";
  return `OpenAI - ${id}`;
}

// Safe initial UI values. The server supplies the actual project model names.
export const INITIAL_MODEL_CATALOG: SlideModelCatalog = {
  text: [{ id: CURRENT_MODEL, label: "Slides default" }, ...TEXT_MODELS.map(id => ({ id, label: slideTextModelLabel(id) }))],
  image: [{ id: CURRENT_MODEL, label: "Project default" }, ...IMAGE_MODELS.map(id => ({ id, label: `OpenAI - ${id}` }))],
};
