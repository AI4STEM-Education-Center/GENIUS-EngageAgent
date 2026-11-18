"use client";
import { useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import type { SavedGalleryCopySummary } from "@/lib/material-gallery";
import { getEngagementStrategyLabel } from "@/lib/engagement-strategies";
import GalleryFirstSlidePreview from "./GalleryFirstSlidePreview";
import GalleryMaterialDetails from "./GalleryMaterialDetails";

const field = "min-h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink";
export default function SavedMaterialsPanel({ items, format, loading, busy, onOpen }: {
  items: SavedGalleryCopySummary[]; format: "slides" | "video"; loading: boolean; busy: boolean; onOpen(id: string): void;
}) {
  const [search, setSearch] = useState("");
  const [lesson, setLesson] = useState("");
  const [strategy, setStrategy] = useState("");
  const [grade, setGrade] = useState("");
  const [failed, setFailed] = useState<Record<string, string>>({});
  const available = items.filter(item => item.format === format);
  const visible = available.filter(item => (!lesson || item.lessonNumber === Number(lesson)) && (!strategy || item.strategy === strategy) && (!grade || item.gradeBand === grade)
    && (!search.trim() || [item.title, item.source.title, item.strategy, getEngagementStrategyLabel(item.strategy), item.experienceContext, item.gradeBand, ...Object.values(item.generation?.tags || {})].join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  return <section aria-label="Saved materials" className="rounded-xl border border-line bg-canvas/60 p-4 sm:p-5">
    <h3 className="font-semibold">My saved materials</h3><p className="mt-1 text-xs text-mute">Your private library. Open a material to edit it or choose a class to send it to.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <label className="text-xs font-semibold text-mute">Lesson<select aria-label="Filter saved materials by lesson" className={`${field} ml-2`} value={lesson} onChange={e => setLesson(e.target.value)}><option value="">All lessons</option>{[...new Set(available.map(item => item.lessonNumber))].sort((a, b) => a - b).map(n => <option key={n} value={n}>Lesson {n}</option>)}</select></label>
      <label className="text-xs font-semibold text-mute">Strategy<select aria-label="Filter saved materials by strategy" className={`${field} ml-2`} value={strategy} onChange={e => setStrategy(e.target.value)}><option value="">All strategies</option>{["analogy", "cognitive conflict", "engaged critiquing", "experience bridging"].map(value => <option key={value} value={value}>{getEngagementStrategyLabel(value)}</option>)}</select></label>
      <label className="text-xs font-semibold text-mute">Grade<select aria-label="Filter saved materials by grade" className={`${field} ml-2`} value={grade} onChange={e => setGrade(e.target.value)}><option value="">All grades</option>{[...new Set(available.map(item => item.gradeBand).filter(Boolean))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <label className="mt-4 flex items-center gap-2"><Search size={17} aria-hidden="true" /><input aria-label="Search saved materials" className={`${field} min-w-0 flex-1`} value={search} maxLength={160} placeholder="Search materials, tags or source titles" onChange={e => setSearch(e.target.value)} /></label>
    <p className="mt-3 text-xs text-mute" role="status">{loading ? "Loading saved materials…" : `${visible.length} saved ${visible.length === 1 ? "material" : "materials"}`}</p>
    {loading && <LoaderCircle size={16} className="mt-4 animate-spin" />}
    <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">{visible.map(item => <article key={item.copyId} className="flex min-w-0 flex-col rounded-xl border border-line bg-white p-4">
      <GalleryFirstSlidePreview material={item} imageFailed={failed[item.copyId] === item.previewImage} onImageError={() => setFailed(current => ({ ...current, [item.copyId]: item.previewImage! }))} />
      <div className="flex justify-between gap-2 text-xs text-mute"><span>{item.format === "slides" ? `${item.slideCount || ""} slides` : "Animated video"}</span><span>Private · Version {item.revision}</span></div>
      <h4 className="mt-3 text-lg font-bold">{item.title}</h4>
      <GalleryMaterialDetails {...item} privateMaterial compact promptTags={item.generation?.tags} />
      <p className="mt-3 text-xs text-mute">Saved {new Date(item.savedAt).toLocaleDateString()}{!item.source.private && ` · From ${item.source.title}`}</p>
      <button type="button" disabled={busy} onClick={() => onOpen(item.copyId)} className="mt-4 min-h-10 self-start rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Open</button>
    </article>)}</div>
    {!loading && !visible.length && <div className="py-8 text-center"><p className="font-semibold">{available.length ? "No saved materials match" : "No saved materials yet"}</p><p className="mt-2 text-sm text-mute">{available.length ? "Try another filter or search." : "Save a generated material or an editable Gallery copy to find it here."}</p>{available.length > 0 && <button type="button" className="mt-3 text-sm font-semibold text-brand" onClick={() => { setSearch(""); setLesson(""); setStrategy(""); setGrade(""); }}>Clear filters</button>}</div>}
  </section>;
}
