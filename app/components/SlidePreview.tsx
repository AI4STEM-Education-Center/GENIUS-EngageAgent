"use client";

import { useMemo } from "react";
import { slideElements } from "@/lib/slides/layout";
import type { SlideDeck } from "@/lib/slides/model";
import SlideCanvas from "./SlideCanvas";
import SlideVideo from "./SlideVideo";

export default function SlidePreview({ deck, index, interactive = true }: { deck: SlideDeck; index: number; interactive?: boolean }) {
  const { elements, error } = useMemo(() => {
    try { return { elements: slideElements(deck, index), error: "" }; }
    catch { return { elements: [], error: "Shorten the text to preview this slide." }; }
  }, [deck, index]);
  if (error) return <p role="alert" className="p-5 text-sm text-red-800">{error}</p>;
  return <div className="relative"><SlideCanvas elements={elements} index={index} title={deck.draft.slides[index].title} />{interactive && deck.draft.slides[index].videoUrl && <SlideVideo key={deck.draft.slides[index].videoUrl} url={deck.draft.slides[index].videoUrl!} elements={elements} />}</div>;
}
