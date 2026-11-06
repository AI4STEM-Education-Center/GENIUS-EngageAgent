"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, LoaderCircle, Search, X } from "lucide-react";
import { copyGalleryMaterial, listMaterialGallery, previewGalleryMaterial, previewGallerySlideDeck, unshareGalleryMaterial } from "@/lib/material-gallery-client";
import type { GalleryCopy, GalleryFilters, GalleryMaterial, GalleryPreviewSource, GalleryScope } from "@/lib/material-gallery";
import { getEngagementStrategyLabel } from "@/lib/engagement-strategies";
import { loadTaskLesson } from "@/lib/lesson-client";
import SlidePreview from "./SlidePreview";
import type { SlideDeck } from "@/lib/slides/model";
import type { StrategyFocus } from "@/lib/strategy-focus";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} !border-brand !bg-brand !text-white hover:!bg-brand-dark`;
type Props = { scope: GalleryScope; lessonNumber: number; strategy: string; format: "slides" | "video"; focus?: StrategyFocus; disabled?: boolean; onUse: (copy: GalleryCopy, material: GalleryMaterial) => void; refreshKey?: number; browseRequest?: number; standalone?: boolean };

export default function MaterialGalleryPanel({ scope, lessonNumber, strategy, format, focus, disabled, onUse, refreshKey = 0, browseRequest = 0, standalone = false }: Props) {
  const [filter, setFilter] = useState<"topic" | "strategy" | "all" | "mine">(standalone ? "all" : "topic");
  const [expanded, setExpanded] = useState(standalone);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GalleryMaterial[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copying, setCopying] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<GalleryPreviewSource | null>(null);
  const [previewDeck, setPreviewDeck] = useState<SlideDeck | null>(null);
  const [previewItem, setPreviewItem] = useState<GalleryMaterial | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [removeTarget, setRemoveTarget] = useState<GalleryMaterial | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const operation = useRef<AbortController | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const scopeKey = JSON.stringify([scope.classId, scope.assignmentId]);

  const load = useCallback(async (nextCursor?: string) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    const filters: GalleryFilters = { format, search: query || undefined, limit: expanded ? 12 : 6, cursor: nextCursor,
      ...(filter === "topic" && lessonNumber > 0 ? { lessonNumber } : filter === "strategy" && strategy ? { strategy } : filter === "mine" ? { mine: true } : {}) };
    try {
      const result = await listMaterialGallery({ classId: scope.classId, assignmentId: scope.assignmentId }, filters, controller.signal);
      if (controller.signal.aborted) return;
      setItems(old => nextCursor ? [...old, ...result.items.filter(item => !old.some(existing => existing.id === item.id))] : result.items);
      setCursor(result.nextCursor);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load shared materials.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [scope.classId, scope.assignmentId, format, query, expanded, filter, lessonNumber, strategy]);
  useEffect(() => { setItems([]); setCursor(undefined); void load(); return () => request.current?.abort(); }, [load, refreshKey, reload]);
  useEffect(() => {
    operation.current?.abort(); previewRequest.current?.abort(); if (dialog.current?.open) dialog.current.close();
    setCopying(""); setPreview(null); setPreviewDeck(null); setPreviewItem(null); setPreviewLoading(false); setRemoveTarget(null); setNotice("");
    return () => { operation.current?.abort(); previewRequest.current?.abort(); };
  }, [scopeKey]);
  useEffect(() => { if (browseRequest > 0) { setExpanded(true); setFilter("all"); } }, [browseRequest]);

  function closePreview() {
    previewRequest.current?.abort(); setPreviewLoading(false); if (dialog.current?.open) dialog.current.close();
  }

  async function selectMaterial(material: GalleryMaterial, mode: "use" | "adapt") {
    if (disabled || copying || (!standalone && material.lessonNumber !== lessonNumber)) return;
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller;
    setCopying(material.id); setError("");
    try {
      const copy = await copyGalleryMaterial(scope, material.id, mode, controller.signal);
      if (controller.signal.aborted) return;
      onUse(copy, material);
      closePreview();
      setNotice(standalone ? "Your copy is ready to edit." : mode === "adapt" ? material.format === "video"
        ? "Your own copy is ready below. Open Edit material to adapt its text and teaching details."
        : "Your own copy is ready below. Edit it or describe the changes you want in Revise with AI."
        : "Your own copy is ready to review below. The Gallery original is unchanged.");
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to copy this material."); }
    finally { if (!controller.signal.aborted) setCopying(""); }
  }
  async function openPreview(material: GalleryMaterial) {
    previewRequest.current?.abort(); const controller = new AbortController(); previewRequest.current = controller;
    setPreviewItem(material); setPreview(null); setPreviewDeck(null); setPreviewIndex(0); setPreviewLoading(true); setError("");
    dialog.current?.showModal();
    try {
      const detail = await previewGalleryMaterial(scope, material.id, controller.signal);
      if (controller.signal.aborted) return;
      setPreview(detail);
      if (material.format === "slides") {
        const deck = await previewGallerySlideDeck(scope, material.id, controller.signal);
        // A lesson added in the app needs loading for its slide heading. If this fails, the preview says it can't show the slide.
        await loadTaskLesson(scope, material.lessonNumber).catch(() => null);
        if (!controller.signal.aborted) setPreviewDeck(deck);
      }
    }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to preview this material."); }
    finally { if (!controller.signal.aborted) setPreviewLoading(false); }
  }
  async function remove() {
    if (!removeTarget) return;
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller;
    setCopying(removeTarget.id); setError("");
    try {
      await unshareGalleryMaterial(scope, removeTarget.id, controller.signal);
      if (controller.signal.aborted) return;
      setItems(previous => previous.filter(item => item.id !== removeTarget.id)); setRemoveTarget(null);
      setNotice("Removed from the Gallery. Existing classroom copies are unchanged.");
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to remove the shared material."); }
    finally { if (!controller.signal.aborted) setCopying(""); }
  }
  const focusMatches = (item: GalleryMaterial) => item.lessonNumber === lessonNumber && !!focus && !!item.focus && (item.focus.misconceptions.some(id => focus.misconceptions.includes(id)) || item.focus.coreIdeas.some(id => focus.coreIdeas.includes(id)));
  const previewSlide = preview?.draft?.slides[previewIndex];

  return <section aria-label="Materials Gallery" className="rounded-xl border border-line bg-canvas/60 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-base font-semibold"><LayoutGrid size={18} />{standalone ? "Shared materials" : expanded ? "Materials Gallery" : "Matches from the Gallery"}</h3><p className="mt-1 text-xs text-mute">{standalone ? "Open a material to edit your own copy." : "Shared by teachers · use a copy or adapt it to your class"}</p></div>
      {!standalone && <button type="button" className={button} onClick={() => setExpanded(value => !value)}>{expanded ? "Show matches" : "Open Gallery"}<ChevronRight size={16} /></button>}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Gallery filters" className="flex flex-wrap rounded-lg bg-line-2 p-1">
        {([["topic", "Same topic"], ["strategy", "Same strategy"], ["all", "All"], ["mine", "Shared by me"]] as const).filter(([id]) => !standalone || id === "all" || id === "mine").map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={`rounded-md px-3 py-2 text-sm font-semibold ${filter === id ? "bg-white text-ink shadow-sm" : "text-mute"}`}>{label}</button>)}
      </div>
      {expanded && <form className="flex min-w-0 flex-1 gap-2" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); }}><input aria-label="Search shared materials" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search materials" maxLength={160} className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm" /><button className={button} aria-label="Search Gallery"><Search size={17} /></button></form>}
    </div>
    {loading && !items.length && <p role="status" className="mt-5 flex items-center gap-2 text-sm text-mute"><LoaderCircle size={16} className="animate-spin" />Finding shared materials…</p>}
    {error && <div role="alert" className="mt-4 rounded-lg bg-bad-light p-3 text-sm text-bad">{error}<button type="button" className={`${button} ml-3`} onClick={() => setReload(value => value + 1)}>Try again</button></div>}
    {notice && <p role="status" className="mt-4 rounded-lg bg-ok-light p-3 text-sm text-ok">{notice}</p>}
    {!loading && !error && !items.length && <div className="py-8 text-center"><p className="font-semibold text-ink">No shared materials match yet</p><p className="mt-2 text-sm text-mute">{standalone ? "Try another filter or search. Materials shared by teachers will appear here." : "Try another filter, or generate a new material below. You can share it after reviewing."}</p></div>}
    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(material => <article key={material.id} className="flex min-w-0 flex-col rounded-xl border border-line bg-white p-4">
      <div className="flex justify-between gap-2 text-xs text-mute"><span>{material.format === "slides" ? `${material.slideCount ?? ""} slides` : "Animated video"}</span>{material.isOwner && <span className="font-semibold">Shared by you</span>}</div>
      <h4 className="mt-3 text-lg font-bold text-ink">{material.title}</h4>
      <p className="mt-2 text-sm text-mute">Lesson {material.lessonNumber} · {getEngagementStrategyLabel(material.strategy)}</p>
      {material.description && <p className="mt-3 text-sm leading-6 text-ink-2">{material.description}</p>}
      <div className="my-3 flex flex-wrap gap-2 text-xs font-semibold">{material.lessonNumber === lessonNumber && <span className="rounded-full bg-ok-light px-2.5 py-1 text-ok">Same topic</span>}{material.strategy === strategy && <span className="rounded-full bg-info-light px-2.5 py-1 text-info">Same strategy</span>}{focusMatches(material) && <span className="rounded-full bg-ai-light px-2.5 py-1 text-ai">Same focus</span>}{material.gradeBand && <span className="rounded-full bg-line-2 px-2.5 py-1 text-mute">{material.gradeBand}</span>}</div>
      <div className="mt-auto flex flex-wrap gap-2 pt-3"><button type="button" className={primary} disabled={disabled || !!copying || (!standalone && material.lessonNumber !== lessonNumber)} onClick={() => void selectMaterial(material, standalone ? "adapt" : "use")}>{copying === material.id ? "Opening…" : standalone ? "Open" : "Use as is"}</button>{!standalone && <button type="button" className={button} disabled={disabled || !!copying || material.lessonNumber !== lessonNumber} onClick={() => void selectMaterial(material, "adapt")}>Adapt</button>}<button type="button" className={button} onClick={() => void openPreview(material)}>Preview</button></div>
      {!standalone && material.lessonNumber !== lessonNumber && <p className="mt-2 text-xs text-mute">Choose Lesson {material.lessonNumber} in Assessment to use this material.</p>}
      {material.isOwner && <button type="button" className="mt-3 self-start text-xs font-semibold text-mute underline" disabled={!!copying} onClick={() => setRemoveTarget(material)}>Remove from Gallery</button>}
    </article>)}</div>
    {cursor && <button type="button" className={`${button} mt-4`} disabled={loading} onClick={() => void load(cursor)}>{loading ? "Loading…" : "Load more"}</button>}
    {removeTarget && <div role="alertdialog" aria-label="Remove shared material" className="mt-4 rounded-lg border border-warn bg-warn-light p-4 text-sm"><p>Remove “{removeTarget.title}” from the Gallery? Teachers who already copied it keep their copies.</p><div className="mt-3 flex gap-2"><button className={button} type="button" onClick={() => setRemoveTarget(null)}>Keep shared</button><button className={button} type="button" disabled={!!copying} onClick={() => void remove()}>Remove shared material</button></div></div>}
    <dialog ref={dialog} aria-label="Gallery material preview" onCancel={closePreview} className="fixed inset-0 m-auto max-h-[90vh] w-[94vw] max-w-3xl overflow-auto rounded-2xl border border-line bg-white p-6 backdrop:bg-ink/50">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-mute">Gallery preview</p><h3 className="mt-1 text-xl font-bold">{previewItem?.title}</h3></div><button type="button" className={button} aria-label="Close Gallery preview" onClick={closePreview}><X size={18} /></button></div>
      {previewLoading && <p role="status" className="py-10 text-mute">Loading preview…</p>}
      {previewSlide && <>{previewDeck ? <div className="mt-5"><SlidePreview deck={previewDeck} index={previewIndex} /></div> : <div className="mt-5 rounded-xl border border-line bg-canvas p-6"><p className="text-xs font-semibold uppercase text-mute">{previewSlide.stage}</p><h4 className="mt-3 text-2xl font-bold">{previewSlide.title}</h4><p className="mt-4 whitespace-pre-wrap text-lg leading-relaxed">{previewSlide.body}</p><p className="mt-6 font-semibold text-ok">{previewSlide.task}</p></div>}<div className="mt-3 flex items-center justify-between"><button type="button" className={button} disabled={previewIndex === 0} onClick={() => setPreviewIndex(value => value - 1)}><ChevronLeft size={16} />Previous</button><span className="text-sm text-mute">Slide {previewIndex + 1} of {preview?.draft?.slides.length}</span><button type="button" className={button} disabled={previewIndex >= (preview?.draft?.slides.length ?? 0) - 1} onClick={() => setPreviewIndex(value => value + 1)}>Next<ChevronRight size={16} /></button></div></>}
      {preview?.item && <div className="mt-5 space-y-4">{preview.media?.video && <video aria-label="Shared video preview" src={preview.media.video} poster={preview.media.image} controls playsInline preload="metadata" className="max-h-96 w-full rounded-xl bg-ink" />}<p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{preview.item.body}</p>{preview.item.activity?.stages.map(stage => <div key={stage.id}><h4 className="font-semibold">{stage.title}</h4><p className="mt-1 text-sm text-mute">{stage.text}</p></div>)}</div>}
      {!previewLoading && !previewSlide && !preview?.item && <p className="mt-5 text-sm text-mute">{previewItem?.description || "This material could not be previewed. Please retry."}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      {previewItem && <div className="mt-5 flex flex-wrap gap-2"><button type="button" className={primary} disabled={disabled || !!copying || (!standalone && previewItem.lessonNumber !== lessonNumber)} onClick={() => void selectMaterial(previewItem, standalone ? "adapt" : "use")}>{standalone ? "Open and edit" : "Use as is"}</button>{!standalone && <button type="button" className={button} disabled={disabled || !!copying || previewItem.lessonNumber !== lessonNumber} onClick={() => void selectMaterial(previewItem, "adapt")}>Adapt for my class</button>}</div>}
    </dialog>
  </section>;
}
