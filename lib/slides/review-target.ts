import { draftVisibleVisualIds, type SlideDeck } from "./model";

export function reviewTarget(finding: string, deck: SlideDeck): { slideIndex?: number; visualId?: string } {
  const numbered = /\bSlide\s+(\d+)(?=[.:\s])/iu.exec(finding);
  if (numbered) {
    const slideIndex = Number(numbered[1]) - 1;
    if (slideIndex >= 0 && slideIndex < deck.draft.slides.length) return { slideIndex };
  }
  const visual = deck.draft.visuals.find(item => new RegExp(`^(?:Image\\s+)?${item.id}(?:\\s+image)?[.:\\s]`, "iu").test(finding));
  if (visual) {
    const index = deck.draft.slides.findIndex((_, i) => draftVisibleVisualIds(deck.draft, deck.strategy, i).includes(visual.id));
    return { ...(index >= 0 ? { slideIndex: index } : {}), visualId: visual.id };
  }
  return {};
}
