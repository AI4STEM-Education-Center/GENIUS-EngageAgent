import type { GalleryMaterial } from "@/lib/material-gallery";

/** The cover follows slide 1's reveal order, including text-only legacy decks. */
export default function GalleryFirstSlidePreview({ material, imageFailed, onImageError }: {
  material: GalleryMaterial; imageFailed: boolean; onImageError: () => void;
}) {
  const slide = material.previewSlide;
  if (!slide && !material.previewImage) return null;
  const image = material.previewImage && !imageFailed
    ? <img src={material.previewImage} alt="" loading="lazy" onError={onImageError} className="h-full w-full object-contain" /> : null;
  if (!slide) return <div className="mb-3 aspect-video max-h-44 overflow-hidden rounded-lg bg-canvas">{image || <p className="flex h-full items-center justify-center text-xs text-mute">Preview image unavailable</p>}</div>;
  return <div aria-label={`First slide: ${slide.title}`} className="mb-3 flex aspect-video max-h-44 gap-3 overflow-hidden rounded-lg border border-line bg-canvas p-3">
    <div className="flex min-w-0 flex-1 flex-col">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-mute">Slide 1 · {slide.stage.replaceAll("_", " ")}</p>
      <p className="mt-1 line-clamp-2 text-sm font-bold leading-tight text-ink">{slide.title}</p>
      <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-ink-2">{slide.body}</p>
      {slide.task && <p className="mt-auto line-clamp-2 pt-2 text-[10px] font-semibold text-ok">{slide.task}</p>}
    </div>
    {image && <div className="w-2/5 shrink-0 overflow-hidden rounded bg-white">{image}</div>}
  </div>;
}
