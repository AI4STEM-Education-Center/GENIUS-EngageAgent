"use client";

import { useMemo } from "react";
import { browserMeasure, CANVAS, wrapElements, type SlideElement } from "@/lib/slides/layout";

type Props = {
  elements: SlideElement[];
  title: string;
  index: number;
  ariaHidden?: boolean;
  onImageError?: (id: string) => void;
};

/** The editor, web reader and PowerPoint export share the same slide geometry. */
export default function SlideCanvas({ elements: source, title, index, ariaHidden = false, onImageError }: Props) {
  const { elements, error } = useMemo((): { elements: SlideElement[]; error: string } => {
    if (typeof document === "undefined") return { elements: [], error: "" };
    try { return { elements: wrapElements(source, browserMeasure()), error: "" }; }
    catch { return { elements: [], error: "Shorten the text to preview this slide." }; }
  }, [source]);

  return <div className="w-full overflow-hidden border border-gray-300 bg-white" style={{ aspectRatio: "16 / 9" }}>
    {error ? <p role="alert" className="p-5 text-sm text-red-800">{error}</p> : <svg viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`} role={ariaHidden ? undefined : "img"}
      aria-hidden={ariaHidden || undefined} aria-label={ariaHidden ? undefined : `Slide ${index + 1}: ${title}`} className="block h-full w-full">
      <title>{title}</title>
      {elements.map(element => element.kind === "image" ? (element.data ?
        <image key={element.id} href={element.data} x={element.frame.left} y={element.frame.top} width={element.frame.width} height={element.frame.height}
          preserveAspectRatio="xMidYMid meet" onError={() => onImageError?.(element.id)}><title>{element.alt}</title></image> :
        <g key={element.id}><rect x={element.frame.left} y={element.frame.top} width={element.frame.width} height={element.frame.height} fill="#F1F4F5" /><text x={element.frame.left + 20} y={element.frame.top + 44} fontSize={24} fontFamily="Arial" fill="#48535E">Image pending</text></g>) :
        <svg key={element.id} x={element.frame.left} y={element.frame.top} width={element.frame.width} height={element.frame.height} overflow="hidden">
          <text fill={`#${element.color}`} fontFamily="Arial" fontSize={element.fontSize} fontWeight={element.bold ? 700 : 400}>
            {element.renderedLines?.map((line, n) => <tspan key={n} x={0} y={element.fontSize + n * element.fontSize * 1.26}>{line}</tspan>)}
          </text>
        </svg>)}
    </svg>}
  </div>;
}
