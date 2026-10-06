"use client";

import { useMemo } from "react";
import { browserMeasure, CANVAS, slideElements, wrapElements, type SlideElement } from "@/lib/slides/layout";
import type { SlideDeck } from "@/lib/slides/model";

export default function SlidePreview({ deck, index }: { deck: SlideDeck; index: number }) {
  const { elements, error } = useMemo((): { elements: SlideElement[]; error: string } => {
    if (typeof document === "undefined") return { elements: [], error: "" };
    try { return { elements: wrapElements(slideElements(deck, index), browserMeasure()), error: "" }; }
    catch { return { elements: [], error: "Shorten the text to preview this slide." }; }
  }, [deck, index]);
  return <div className="w-full overflow-hidden border border-gray-300 bg-white" style={{ aspectRatio: "16 / 9" }}>
    {error ? <p role="alert" className="p-5 text-sm text-red-800">{error}</p> : <svg viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`} role="img" aria-label={`Slide ${index + 1}: ${deck.draft.slides[index].title}`} className="block h-full w-full">
      <title>{deck.draft.slides[index].title}</title>
      {elements.map(element => element.kind === "image" ? (element.data ?
        <image key={element.id} href={element.data} x={element.frame.left} y={element.frame.top} width={element.frame.width} height={element.frame.height} preserveAspectRatio="xMidYMid meet"><title>{element.alt}</title></image> :
        <g key={element.id}><rect x={element.frame.left} y={element.frame.top} width={element.frame.width} height={element.frame.height} fill="#F1F4F5" /><text x={element.frame.left + 20} y={element.frame.top + 44} fontSize={24} fontFamily="Arial" fill="#48535E">Image pending</text></g>) :
        <svg key={element.id} x={element.frame.left} y={element.frame.top} width={element.frame.width} height={element.frame.height} overflow="hidden">
          <text fill={`#${element.color}`} fontFamily="Arial" fontSize={element.fontSize} fontWeight={element.bold ? 700 : 400}>
            {element.renderedLines?.map((line, n) => <tspan key={n} x={0} y={element.fontSize + n * element.fontSize * 1.26}>{line}</tspan>)}
          </text>
        </svg>)}
    </svg>}
  </div>;
}
