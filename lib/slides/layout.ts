import { assertSlideLayout, containImage, wrapText } from "@/scripts/slides/layout-rules.mjs";
import { draftErrors, isSlideAsset, visibleVisualIds, type SlideDeck } from "./model";
import { qualityErrors } from "./quality";
import { getSlideLearningTarget } from "./learning-target";
import { analogyMappingIndex } from "./analogy-methods";

export type Frame = { left: number; top: number; width: number; height: number };
export type TextElement = { id: string; kind: "text"; role: string; text: string; fontSize: number; bold: boolean; color: string; frame: Frame; autoFit: "none"; renderedLines?: string[] };
export type ImageElement = { id: string; kind: "image"; frame: Frame; fit: "contain"; data?: string; alt: string };
export type SlideElement = TextElement | ImageElement;
export type MeasureText = (text: string, element: TextElement) => number;
export const CANVAS = { width: 1280, height: 720 };

export function slideElements(deck: SlideDeck, index: number): SlideElement[] {
  const slide = deck.draft.slides[index];
  const sixStep = deck.strategy === "analogy" && deck.draft.analogyMethod === "six-step";
  const privateQuestionRecap = sixStep || deck.strategy !== "analogy";
  const showLearningTarget = deck.strategy === "experience bridging" ? slide.stage === "name" : index === 0;
  const images = visibleVisualIds(deck.strategy, index, deck.draft.analogyMethod, deck.draft.analogyPlan?.boundaryDecision === "include");
  const openingPair = deck.strategy === "analogy" && index === 0 && images.length === 2;
  const mapping = deck.strategy === "analogy" && index === analogyMappingIndex(deck.draft.analogyMethod) ? deck.draft.analogyPlan : undefined;
  const frame = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });
  const text = (id: string, value: string, area: Frame, size: number, role = "body", bold = false, color = "20262D"): TextElement =>
    ({ id, kind: "text", role, text: value, frame: area, fontSize: size, bold, color, autoFit: "none" });
  const elements: SlideElement[] = [
    text("step-number", String(index + 1), frame(48, openingPair ? 32 : 44, 64, mapping ? 60 : 64), 44, "title", true, "1553A4"),
    text("title", slide.title, frame(136, openingPair ? 32 : 44, 1096, openingPair ? 108 : mapping ? 60 : 116), openingPair || mapping ? 40 : 44, "title", true),
  ];
  if (showLearningTarget) elements.push(text("learning-target", `Today we investigate: ${getSlideLearningTarget(deck.lessonNumber)}`, frame(64, openingPair ? 148 : 172, 1152, openingPair ? 38 : 44), 26, "body", true, "1553A4"));
  if (slide.stage === "question" && index === deck.draft.slides.length - 1) {
    if (!privateQuestionRecap) elements.push(text("body", slide.body, frame(64, 216, 528, 188), 28));
    elements.push(text("question-starters", "Why...?\nWhat changes if...?\nHow could we test...?", frame(64, privateQuestionRecap ? 450 : 424, 528, 100), 24));
    elements.push(text("task", slide.task, frame(64, privateQuestionRecap ? 232 : 544, 528, 152), 28, "body", true, "087368"));
    elements.push(text("question-card", "MY QUESTION\n\n________________________\n\n________________________\n\n________________________", frame(656, 216, 560, privateQuestionRecap ? 432 : 372), 28, "body", false, "1553A4"));
  } else if (images.length === 2) {
    elements.push(text("body", slide.body, openingPair ? frame(64, 198, 1152, 72) : mapping ? frame(64, 112, 1152, 72) : frame(64, 168, 1152, 76), openingPair || mapping ? 26 : 28));
    elements.push(text("task", mapping ? [slide.task, mapping.responseStarter].filter(Boolean).join("\n") : slide.task, openingPair ? frame(64, 606, 1152, 90) : mapping ? frame(64, 598, 1152, 98) : frame(64, 592, 1152, 92), openingPair ? 26 : mapping ? 24 : 28, "body", true, "087368"));
    if (mapping && !sixStep) {
      elements.push(text("mapping-hint", mapping.mappingHint, frame(64, 524, 1152, 66), 24, "body", false, "1553A4"));
    }
  } else if (images.length === 1) {
    elements.push(text("body", slide.body, index === 0 ? frame(64, 240, 528, 172) : frame(64, 192, 528, 204), 28));
    elements.push(text("task", slide.task, frame(64, 434, 528, 212), 28, "body", true, "087368"));
  } else {
    elements.push(text("body", slide.body, frame(64, index === 0 || showLearningTarget ? 240 : 216, 1152, 176), 34));
    elements.push(text("task", slide.task, frame(64, 472, 1152, 164), 34, "body", true, "087368"));
  }
  images.forEach((id, i) => {
    const visual = deck.draft.visuals.find(item => item.id === id)!;
    const asset = deck.assets[id];
    const paired = images.length === 2;
    if (paired && deck.strategy === "analogy" && !sixStep) elements.push(text(`role-${id}`, slide.stage === "predict" ? (i === 0 ? "Setup A" : "Setup B") : (i === 0 ? "Familiar situation" : "Science situation"), frame(64 + i * 600, openingPair ? 282 : mapping ? 192 : 252, 552, 36), 24, "caption", true, "1553A4"));
    const pairTop = slide.body.trim() ? (mapping ? 200 : 260) : 176;
    const region = paired && sixStep ? frame(64 + i * 600, pairTop, 552, (visual.caption ? 504 : 576) - pairTop) : paired ? frame(64 + i * 600, openingPair ? 334 : mapping ? 244 : 304, 552, openingPair ? 174 : mapping ? 190 : 184) : index === 0 ? frame(640, 240, 576, 326) : frame(640, 182, 576, 384);
    elements.push({ id: `image-${id}`, kind: "image", frame: containImage(asset?.width ?? 1536, asset?.height ?? 1024, region), fit: "contain", data: asset?.data, alt: visual.alt });
    elements.push(text(`caption-${id}`, visual.caption, paired && sixStep ? frame(64 + i * 600, 520, 552, 64) : paired ? frame(64 + i * 600, openingPair ? 524 : mapping ? 450 : 508, 552, openingPair || mapping ? 66 : 68) : frame(640, 586, 576, 68), 24, "caption", false, "48535E"));
  });
  return elements.filter(element => element.kind !== "text" || element.text.trim());
}

export function wrapElements(elements: SlideElement[], measure: MeasureText): SlideElement[] {
  return elements.map(element => element.kind === "text" ? { ...element, renderedLines: wrapText(element.text, element.frame.width - 4, (value: string) => measure(value, element)) } : element);
}

export function layoutErrors(deck: SlideDeck, measure: MeasureText): string[] {
  const errors = draftErrors(deck.draft, deck.strategy);
  if (errors.length) return errors;
  deck.draft.slides.forEach((_, index) => {
    try {
      const elements = wrapElements(slideElements(deck, index), measure);
      assertSlideLayout({ ...CANVAS, elements, slide: String(index + 1), measureText: measure });
    } catch (error) { errors.push(error instanceof Error ? error.message : `Slide ${index + 1}: invalid layout.`); }
  });
  return errors;
}

export function exportErrors(deck: SlideDeck, measure: MeasureText): string[] {
  const errors = [...layoutErrors(deck, measure), ...qualityErrors(deck)];
  for (const visual of deck.draft.visuals) if (!isSlideAsset(deck.assets[visual.id])) errors.push(`Image ${visual.id}: generate an image before downloading.`);
  return errors;
}

export function browserMeasure(): MeasureText {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("Your browser cannot measure slide text.");
  return (text, element) => {
    context.font = `${element.bold ? "bold " : ""}${element.fontSize}px Arial`;
    return context.measureText(text).width;
  };
}
