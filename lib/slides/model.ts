import { analogyPlanErrors, type AnalogyPlan } from "./analogy";
import { analogyStages, analogyVisualIds, analogyVisibleVisualIds, isAnalogyMethod, type AnalogyMethod } from "./analogy-methods";

export const STRATEGIES = ["analogy", "cognitive conflict", "experience bridging"] as const;
export type SlideStrategy = typeof STRATEGIES[number];
export const SLIDE_CONTRACT_VERSION = "student-inquiry-strategies-20261005-v5";
export const ANALOGY_OPENING_CONTRACT_VERSION = "analogy-six-step-20261001";
export const SIX_STEP_REVIEW_CONTRACT_VERSION = "analogy-lesson-context-20261003";
export const STAGES: Record<SlideStrategy, readonly string[]> = {
  analogy: ["analogue", "mapping", "predict", "reflect", "question"],
  "cognitive conflict": ["phenomenon", "prediction", "discrepant", "compare", "question"],
  "experience bridging": ["experience", "notice", "name", "connect", "question"],
};
export function experienceBridgingStages(includeConnection = true): readonly string[] {
  return includeConnection ? STAGES["experience bridging"] : ["experience", "notice", "name", "question"];
}
export function methodStages(strategy: SlideStrategy, method?: AnalogyMethod, includeLimits = false): readonly string[] {
  return strategy === "analogy" ? analogyStages(method, includeLimits) : STAGES[strategy];
}
export function stageOptions(strategy: SlideStrategy, index: number, method?: AnalogyMethod, includeLimits = false): readonly string[] {
  return strategy === "analogy" && method !== "six-step" && index === 3 ? ["reflect", "limits"] : [methodStages(strategy, method, includeLimits)[index]];
}
export const VISUALS: Record<SlideStrategy, readonly string[]> = {
  analogy: ["analogue", "target", "variation"], "cognitive conflict": ["evidence"], "experience bridging": ["experience"],
};
export function methodVisualIds(strategy: SlideStrategy, method?: AnalogyMethod): readonly string[] {
  return strategy === "analogy" ? analogyVisualIds(method) : VISUALS[strategy];
}
export type TeachingSlide = { stage: string; title: string; body: string; task: string; teacherNotes: string[] };
export type SlideVisual = { id: string; prompt: string; caption: string; alt: string };
export type SlideDraft = { title: string; slides: TeachingSlide[]; visuals: SlideVisual[]; analogyPlan?: AnalogyPlan; analogyMethod?: AnalogyMethod };
export type SlideAsset = { data: string; width: number; height: number; model?: string; sourcePrompt?: string; referenceData?: string };
export type SlideCheck = { key: string; issues: string[]; model?: string; imageData?: string };
export type SlideChecks = { text?: SlideCheck; images: Record<string, SlideCheck> };
export type SlideDeck = { id: string; lessonNumber: number; strategy: SlideStrategy; classroomContext?: string; draft: SlideDraft; assets: Record<string, SlideAsset>; modelSelection?: SlideModelSelection; textModel?: string; promptProvenance?: SlidePromptProvenance; checks?: SlideChecks; teacherDecision?: { reason: string; draftKey: string; checks: SlideChecks; assets: Record<string, SlideAsset> } };
export type SlideLesson = { lessonNumber: number; lessonTitle: string; learningObjective: string };

export function isSlideStrategy(value: unknown): value is SlideStrategy {
  return STRATEGIES.includes(value as SlideStrategy);
}

// Reveal order is owned by the application, never by model-generated coordinates.
export function visibleVisualIds(strategy: SlideStrategy, index: number, method?: AnalogyMethod, includeLimits = false): readonly string[] {
  if (strategy === "analogy") return analogyVisibleVisualIds(method, index, includeLimits);
  if (strategy === "cognitive conflict") return index === 2 || index === 3 ? ["evidence"] : [];
  return index === 0 || index === 1 ? ["experience"] : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const words = (value: string) => value.trim().split(/\s+/u).length;
export function draftErrors(value: unknown, strategy: SlideStrategy, editable = false): string[] {
  const errors: string[] = [];
  const object = (v: unknown, keys: string[], path: string): v is Record<string, unknown> => {
    if (!record(v)) { errors.push(`${path}: expected an object.`); return false; }
    if (Object.keys(v).some(key => !keys.includes(key))) errors.push(`${path}: unexpected field.`);
    return true;
  };
  const text = (v: unknown, path: string, chars: number, maxWords?: number, allowEmpty = false) => {
    if (allowEmpty && v === "") return;
    if (editable) chars *= 4;
    if (typeof v !== "string" || !v.trim() || v.length > chars || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(v)) errors.push(`${path}: enter 1-${chars} characters of plain text.`);
    else if (!editable && maxWords && words(v) > maxWords) errors.push(`${path}: use at most ${maxWords} words.`);
  };
  if (!object(value, ["title", "slides", "visuals", "analogyPlan", "analogyMethod"], "Deck")) return errors;
  if ("analogyMethod" in value && (strategy !== "analogy" || !isAnalogyMethod(value.analogyMethod))) errors.push("Deck.analogyMethod: choose a supported analogy story method for an analogy draft.");
  const method = isAnalogyMethod(value.analogyMethod) ? value.analogyMethod : undefined;
  const sixStep = strategy === "analogy" && method === "six-step";
  const studentInquiry = sixStep || strategy !== "analogy";
  const includeLimits = record(value.analogyPlan) && value.analogyPlan.boundaryDecision === "include";
  if ("analogyPlan" in value) {
    if (strategy !== "analogy") errors.push("Deck.analogyPlan: only the analogy strategy can have an analogy plan.");
    else errors.push(...analogyPlanErrors(value.analogyPlan, method));
  }
  text(value.title, "Deck title", 80, 12);
  // The connection is genuinely optional; no filler page is inserted when omitted.
  const shortExperience = strategy === "experience bridging" && Array.isArray(value.slides) && value.slides.length === 4;
  const count = shortExperience ? 4 : methodStages(strategy, method, includeLimits).length;
  if (!Array.isArray(value.slides) || value.slides.length !== count) errors.push(count === 5 ? "Deck: exactly five slides are required." : `Deck: exactly ${count} slides are required for this story and boundary decision.`);
  else value.slides.forEach((slide, index) => {
    const path = `Slide ${index + 1}`;
    if (!object(slide, ["stage", "title", "body", "task", "teacherNotes"], path)) return;
    const allowedStages = shortExperience ? [experienceBridgingStages(false)[index]] : stageOptions(strategy, index, method, includeLimits);
    if (!allowedStages.includes(slide.stage as string)) errors.push(`${path}.stage: expected ${allowedStages.join(" or ")}.`);
    text(slide.title, `${path}.title`, 64, 10);
    text(slide.body, `${path}.body`, 260, 29, studentInquiry);
    text(slide.task, `${path}.task`, 180, 24);
    // Question starters are separate app-owned elements, not generated body prose.
    if (!editable && typeof slide.body === "string" && slide.body.split(/[.!?]+(?:\s|$)/u).filter(s => s.trim()).length > 2) errors.push(`${path}.body: use at most two sentences.`);
    if (!Array.isArray(slide.teacherNotes) || slide.teacherNotes.length > 2) errors.push(`${path}.teacherNotes: use at most two notes.`);
    else slide.teacherNotes.forEach((note, n) => text(note, `${path}.teacherNotes ${n + 1}`, studentInquiry ? 900 : 300, studentInquiry ? 150 : 50));
  });
  const ids = methodVisualIds(strategy, method);
  if (!Array.isArray(value.visuals) || value.visuals.length !== ids.length) errors.push(`Deck: ${ids.length} image plan(s) required.`);
  else value.visuals.forEach((visual, index) => {
    const path = `Image ${index + 1}`;
    if (!object(visual, ["id", "prompt", "caption", "alt"], path)) return;
    if (visual.id !== ids[index]) errors.push(`${path}.id: expected ${ids[index]}.`);
    text(visual.prompt, `${path}.prompt`, 1800);
    text(visual.caption, `${path}.caption`, 85, 12, studentInquiry);
    text(visual.alt, `${path}.alt`, 160, 30);
  });
  return errors;
}

export function parseDraft(value: unknown, strategy: SlideStrategy, editable = false): SlideDraft {
  const errors = draftErrors(value, strategy, editable);
  if (errors.length) throw new Error(errors.join("\n"));
  return value as SlideDraft;
}

export function isSlideAsset(value: unknown): value is SlideAsset {
  if (!record(value) || typeof value.data !== "string" || value.data.length > 12_000_000) return false;
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value.data)
    && Number.isInteger(value.width) && Number.isInteger(value.height)
    && Number(value.width) > 0 && Number(value.height) > 0 && Number(value.width) <= 4096 && Number(value.height) <= 4096;
}
import type { SlideModelSelection } from "./models";
import type { SlidePromptProvenance } from "./prompt-versions";
