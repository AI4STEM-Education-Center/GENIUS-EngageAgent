"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGrid, LoaderCircle, X } from "lucide-react";
import { shareSlideMaterial } from "@/lib/material-gallery-client";
import type { GalleryMaterial, GalleryScope } from "@/lib/material-gallery";
import type { SlideDeck, TeachingSlide } from "@/lib/slides/model";

const input = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/10 disabled:opacity-50";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-[9px] border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-45";

type Props = { deck: SlideDeck; scope: GalleryScope; onClose(): void; onShared(material: GalleryMaterial): void };

/** Sharing edits an independent source. It never updates the class draft or sends to students. */
export default function ShareSlidesDialog({ deck, scope, onClose, onShared }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState(() => structuredClone(deck.draft));
  const [title, setTitle] = useState(deck.draft.title);
  const [description, setDescription] = useState("");
  const [gradeBand, setGradeBand] = useState("");
  const [experienceContext, setExperienceContext] = useState("");
  const [quizPattern, setQuizPattern] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
    return () => request.current?.abort();
  }, []);

  function editSlide(index: number, field: keyof Omit<TeachingSlide, "stage">, value: string | string[]) {
    setConfirmed(false);
    setDraft(current => ({ ...current, slides: current.slides.map((slide, n) => n === index ? { ...slide, [field]: value } : slide) }));
  }

  async function share() {
    if (!confirmed || !title.trim() || busy) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      // Context, review findings and provider prompts belong to the class draft.
      // The reusable source contains only the teacher-reviewed deck and assets.
      const source: SlideDeck = { id: deck.id, lessonNumber: deck.lessonNumber, strategy: deck.strategy,
        draft: { ...draft, title: title.trim() }, assets: deck.assets, focus: deck.focus, ...(deck.gallerySource ? { gallerySource: deck.gallerySource } : {}) };
      const material = await shareSlideMaterial(scope, source, {
        title: title.trim(), description: description.trim(), gradeBand: gradeBand.trim(),
        experienceContext: experienceContext.trim(), quizPattern: quizPattern.trim(),
        ...(deck.focus ? { focus: { misconceptions: deck.strategy === "cognitive conflict" || deck.strategy === "engaged critiquing" ? deck.focus.misconceptions ?? [] : [], coreIdeas: deck.strategy === "analogy" || deck.strategy === "experience bridging" ? deck.focus.coreIdeas ?? [] : [] } } : {}),
        sharingConfirmed: true,
      }, controller.signal);
      if (!controller.signal.aborted) onShared(material);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The material could not be shared. Please try again.");
    } finally {
      if (!controller.signal.aborted) { setBusy(false); request.current = null; }
    }
  }

  return <dialog ref={dialog} aria-labelledby="share-material-heading" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}
    className="fixed inset-0 m-auto max-h-[90vh] w-[calc(100%_-_32px)] max-w-3xl overflow-y-auto rounded-xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-ink/50">
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-white p-5">
      <div><p className="text-xs font-bold uppercase tracking-wide text-faint">Share to Gallery</p><h2 id="share-material-heading" className="mt-1 text-xl font-semibold">Share with other teachers</h2>
        <p className="mt-2 text-sm text-mute">Teachers can preview and copy this version. Students receive materials only when you choose Send to students.</p></div>
      <button type="button" className="rounded-lg p-2 hover:bg-canvas disabled:opacity-45" aria-label="Close sharing" disabled={busy} onClick={onClose}><X size={20} /></button>
    </div>
    <fieldset disabled={busy} className="min-w-0 space-y-4 p-5">
      <label className="block text-sm font-semibold text-ink-2">Gallery title<input className={input} maxLength={80} value={title} onChange={event => { setTitle(event.target.value); setConfirmed(false); }} /></label>
      <label className="block text-sm font-semibold text-ink-2">Description (optional)<textarea className={input} maxLength={800} rows={2} value={description} onChange={event => { setDescription(event.target.value); setConfirmed(false); }} /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-semibold text-ink-2">Grade band (optional)<input className={input} maxLength={80} placeholder="e.g. Grades 7–8" value={gradeBand} onChange={event => { setGradeBand(event.target.value); setConfirmed(false); }} /></label>
        <label className="block text-sm font-semibold text-ink-2">Experience context (optional)<input className={input} maxLength={160} placeholder="e.g. Soccer" value={experienceContext} onChange={event => { setExperienceContext(event.target.value); setConfirmed(false); }} /></label>
        <label className="block text-sm font-semibold text-ink-2">Quiz pattern (optional)<input className={input} maxLength={160} placeholder="e.g. Force and damage" value={quizPattern} onChange={event => { setQuizPattern(event.target.value); setConfirmed(false); }} /></label>
      </div>
      <div className="rounded-lg border border-amber-200 bg-warn-light p-3 text-sm leading-relaxed text-warn">
        Classroom context is excluded. Review the slides, notes and images below and remove student names, counts, survey quotes and other class details. Changes here apply only to the Gallery copy.
      </div>
      {draft.slides.map((slide, i) => <details key={slide.stage} className="rounded-lg border border-line bg-white p-3" open={i === 0}>
        <summary className="cursor-pointer text-sm font-semibold">Slide {i + 1} · {slide.title}</summary>
        <div className="mt-3 grid gap-3">
          <label className="block text-xs font-semibold text-ink-2">Title<input aria-label={`Shared slide ${i + 1} title`} className={input} value={slide.title} onChange={event => editSlide(i, "title", event.target.value)} /></label>
          <label className="block text-xs font-semibold text-ink-2">Body<textarea aria-label={`Shared slide ${i + 1} body`} className={input} rows={2} value={slide.body} onChange={event => editSlide(i, "body", event.target.value)} /></label>
          <label className="block text-xs font-semibold text-ink-2">Thinking task<input aria-label={`Shared slide ${i + 1} task`} className={input} value={slide.task} onChange={event => editSlide(i, "task", event.target.value)} /></label>
          <label className="block text-xs font-semibold text-ink-2">Teacher notes<textarea aria-label={`Shared slide ${i + 1} notes`} className={input} rows={3} value={slide.teacherNotes.join("\n\n")} onChange={event => editSlide(i, "teacherNotes", event.target.value.split(/\n\s*\n/u).filter(Boolean))} /></label>
        </div>
      </details>)}
      {draft.analogyPlan && <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold">Review shared teaching plan</summary>
        <p className="mt-2 text-xs text-mute">Other teachers receive this planning context with the reusable material. Remove class-specific details here too.</p>
        <div className="mt-3 space-y-3">{Object.entries(draft.analogyPlan).map(([field, value]) => {
          const fixed = ["depth", "boundaryDecision", "applicationMode"].includes(field);
          return <label key={field} className="block text-xs font-semibold capitalize text-ink-2">{field.replace(/([A-Z])/gu, " $1").toLowerCase()}
            <textarea aria-label={`Shared teaching plan ${field}`} className={`${input} ${fixed ? "bg-canvas" : ""}`} rows={2} readOnly={fixed} value={value ?? ""} onChange={event => {
              setConfirmed(false);
              setDraft(current => current.analogyPlan ? { ...current, analogyPlan: { ...current.analogyPlan, [field]: event.target.value } } : current);
            }} />
          </label>;
        })}</div>
      </details>}
      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold">Review shared images and descriptions</summary>
        <div className="mt-3 space-y-5">{draft.visuals.map((visual, i) => <div key={visual.id}>
          {deck.assets[visual.id] && <img src={deck.assets[visual.id].data} alt={visual.alt} className="mb-3 max-h-56 w-full rounded-lg object-contain" />}
          {(["prompt", "caption", "alt"] as const).map(field => <label key={field} className="mt-2 block text-xs font-semibold text-ink-2">{visual.id} · {field}<textarea aria-label={`Shared ${visual.id} ${field}`} className={input} rows={field === "prompt" ? 3 : 2} value={visual[field]} onChange={event => { setConfirmed(false); setDraft(current => ({ ...current, visuals: current.visuals.map((entry, n) => n === i ? { ...entry, [field]: event.target.value } : entry) })); }} /></label>)}
        </div>)}</div>
      </details>
      <label className="flex items-start gap-3 text-sm leading-relaxed text-ink-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed the shared text, teacher notes and images and removed class and student details.</label>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </fieldset>
    <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-line bg-white p-4">
      <button type="button" className={button} disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className={`${button} !border-brand !bg-brand !text-white hover:!bg-brand-dark`} disabled={!confirmed || !title.trim() || busy} onClick={() => void share()}>
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <LayoutGrid size={16} />}{busy ? "Sharing…" : "Share to Gallery"}
      </button>
    </div>
  </dialog>;
}
