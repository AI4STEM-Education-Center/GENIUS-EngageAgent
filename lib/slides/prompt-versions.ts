export const SLIDE_PROMPT_REVISION = "student-inquiry-strategies-20261014-v6";
export const ANALOGY_PROMPT_REVISION = "analogy-illustrated-opening-20261014-v5";
export const SIX_STEP_PROMPT_REVISION = "analogy-six-step-20261014-v8";
export function analogyPromptRevision(method?: AnalogyMethod) {
  const resolved = resolveAnalogyMethod(method);
  return `${resolved === "six-step" ? SIX_STEP_PROMPT_REVISION : ANALOGY_PROMPT_REVISION}:${resolved}`;
}
export const PROMPT_VERSIONS = ["reference", "optimized"] as const;
export type SlidePromptVersion = typeof PROMPT_VERSIONS[number];
export const PROMPT_LABELS: Record<SlidePromptVersion, string> = {
  reference: "A - Original prompt + adaptation",
  optimized: "B - Optimized prompt",
};
export type SlidePromptProvenance = { version: SlidePromptVersion; revision: string; sourceSha256: string; analogyMethod?: AnalogyMethod };
export function isSlidePromptVersion(value: unknown): value is SlidePromptVersion {
  return PROMPT_VERSIONS.includes(value as SlidePromptVersion);
}
import { resolveAnalogyMethod, type AnalogyMethod } from "./analogy-methods";
