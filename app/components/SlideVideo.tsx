"use client";
import { useState } from "react";
import { slideVideo } from "@/lib/slides/video";
import type { SlideElement } from "@/lib/slides/layout";

export default function SlideVideo({ url, elements }: { url: string; elements: SlideElement[] }) {
  const media = slideVideo(url);
  const [failed, setFailed] = useState(false);
  if (!media) return null;
  const frame = elements.find(element => element.kind === "image")?.frame;
  return <div className={frame ? "absolute overflow-hidden rounded-lg bg-ink" : "relative mt-3 aspect-video overflow-hidden rounded-lg bg-ink"}
    style={frame ? { left: `${frame.left / 12.8}%`, top: `${frame.top / 7.2}%`, width: `${frame.width / 12.8}%`, height: `${frame.height / 7.2}%` } : undefined}>
    {!failed && (media.kind === "video" ? <video aria-label="Slide video" src={media.embed} controls playsInline preload="metadata" onError={() => setFailed(true)} className="h-full w-full object-contain" />
      : <iframe title="Slide video" src={media.embed} loading="lazy" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full border-0" />)}
    <a href={media.url} target="_blank" rel="noopener noreferrer" className="absolute right-1 top-1 rounded bg-black/75 px-2 py-1 text-xs text-white">{failed ? "Open video in a new tab" : "Open video"}</a>
  </div>;
}
