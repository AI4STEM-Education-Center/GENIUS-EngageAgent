"use client";

import { useMemo } from "react";
import { slideElements } from "@/lib/slides/layout";
import type { SlideDeck } from "@/lib/slides/model";
import SlideCanvas from "./SlideCanvas";

export default function SlidePreview({ deck, index }: { deck: SlideDeck; index: number }) {
  const { elements, error } = useMemo(() => {
    try { return { elements: slideElements(deck, index), error: "" }; }
    catch { return { elements: [], error: "Shorten the text to preview this slide." }; }
  }, [deck, index]);
  if (error) return <p role="alert" className="p-5 text-sm text-red-800">{error}</p>;
  return <SlideCanvas elements={elements} index={index} title={deck.draft.slides[index].title} />;
}
