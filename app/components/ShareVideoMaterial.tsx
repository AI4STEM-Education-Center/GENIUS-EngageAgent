"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGrid, LoaderCircle, X } from "lucide-react";
import { shareVideoMaterial } from "@/lib/material-gallery-client";
import type { GalleryScope } from "@/lib/material-gallery";
import type { ContentItem } from "@/lib/types";
import { focusForStrategy, type StrategyFocus } from "@/lib/strategy-focus";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50";
const input = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm font-normal";
type Props = { scope: GalleryScope; item: ContentItem; lessonNumber: number; focus?: StrategyFocus; videoUrl?: string; imageUrl?: string; disabled?: boolean; onShared: () => void };

export default function ShareVideoMaterial({ scope, item, lessonNumber, focus, videoUrl, imageUrl, disabled, onShared }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState(() => structuredClone(item));
  const [confirmed, setConfirmed] = useState(false);
  const [grade, setGrade] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setConfirmed(false), [draft, grade, description, focus, videoUrl, imageUrl]);
  useEffect(() => () => request.current?.abort(), []);
  async function share() {
    if (!confirmed || busy || request.current || !draft.title.trim()) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const selected = focus ? focusForStrategy(focus, item.strategy) : undefined;
      await shareVideoMaterial(scope, { ...draft, id: item.id, title: draft.title.trim() }, lessonNumber, {
        title: draft.title.trim(), description: description.trim(), gradeBand: grade.trim(),
        ...(selected ? { focus: { misconceptions: selected.misconceptions ?? [], coreIdeas: selected.coreIdeas ?? [] } } : {}), sharingConfirmed: true,
      }, controller.signal);
      if (controller.signal.aborted) return;
      setShared(true); onShared(); dialog.current?.close();
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to share the video material.");
    } finally {
      if (request.current === controller) { request.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }
  return <>
    <button type="button" className={`${button} mt-3`} disabled={disabled || busy} onClick={() => { setDraft(structuredClone(item)); setConfirmed(false); setError(""); dialog.current?.showModal(); }}><LayoutGrid size={16} />{shared ? "Share updated copy" : "Share to Gallery"}</button>
    {shared && <p role="status" className="mt-2 text-sm text-ok">Shared with teachers. Sending to students is a separate action.</p>}
    <dialog ref={dialog} aria-label="Share video to Gallery" onCancel={event => { if (busy) event.preventDefault(); }} className="fixed inset-0 m-auto max-h-[90vh] w-[94vw] max-w-2xl overflow-auto rounded-2xl border border-line bg-white p-6 backdrop:bg-ink/50">
      <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-bold">Share with other teachers</h3><button type="button" className={button} aria-label="Close video sharing" disabled={busy} onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <p className="mt-3 text-sm leading-6 text-mute">Review this shared copy and remove student names, quotes and class details from its text and video. Your class’s material stays unchanged. Students never see the Gallery.</p>
      <fieldset disabled={busy} className="mt-5 grid min-w-0 gap-4">
        <div className="rounded-xl border border-line bg-canvas p-3">
          <h4 className="text-sm font-semibold">Video to share</h4>
          {videoUrl ? <video aria-label="Video to share" src={videoUrl} poster={imageUrl} controls playsInline preload="metadata" className="mt-3 max-h-80 w-full rounded-lg bg-ink" />
            : <p className="mt-2 text-sm text-mute">Review the saved video in your materials before sharing.</p>}
          {imageUrl && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-ink-2">Review accompanying image</summary><img src={imageUrl} alt="Image included with this video material" className="mt-2 max-h-64 w-full rounded-lg object-contain" /></details>}
          <p className="mt-3 text-xs leading-relaxed text-mute">Editing the text below does not change the video or image. If either contains private details, close this dialog and replace that media before sharing.</p>
        </div>
        <label className="text-sm font-semibold">Shared title<input className={input} value={draft.title} maxLength={160} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></label>
        <label className="text-sm font-semibold">Description<textarea className={input} value={description} maxLength={1000} onChange={event => setDescription(event.target.value)} /></label>
        <label className="text-sm font-semibold">Grade band (optional)<input className={input} value={grade} maxLength={80} onChange={event => setGrade(event.target.value)} placeholder="e.g. Grades 6–8" /></label>
        <label className="text-sm font-semibold">Activity text<textarea className={input} rows={4} value={draft.body} onChange={event => setDraft(value => ({ ...value, body: event.target.value }))} /></label>
        {draft.activity?.stages.map((stage, index) => <fieldset key={stage.id} className="grid gap-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-semibold">Stage {index + 1}</legend>
          <label className="text-sm font-semibold">Stage title<input aria-label={`Stage ${index + 1} title`} className={input} maxLength={100} value={stage.title} onChange={event => setDraft(value => ({ ...value, activity: value.activity && { ...value.activity, stages: value.activity.stages.map((entry, n) => n === index ? { ...entry, title: event.target.value } : entry) } }))} /></label>
          <label className="text-sm font-semibold">Stage text<textarea aria-label={`Stage ${index + 1} text`} className={input} rows={3} maxLength={1600} readOnly={item.strategy === "cognitive conflict" && stage.id === "compare"} value={stage.text} onChange={event => setDraft(value => ({ ...value, activity: value.activity && { ...value.activity, stages: value.activity.stages.map((entry, n) => n === index ? { ...entry, text: event.target.value } : entry) } }))} /></label>
          {item.strategy === "cognitive conflict" && stage.id === "compare" && <p className="text-xs text-mute">The comparison uses the observed outcome below. Edit that outcome to update this text.</p>}
        </fieldset>)}
        {draft.visualBrief !== undefined && <label className="text-sm font-semibold">Video scene description<textarea className={input} rows={3} value={draft.visualBrief} onChange={event => setDraft(value => ({ ...value, visualBrief: event.target.value }))} /></label>}
        {draft.activity && <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-sm font-semibold">Review image descriptions and teaching details</summary><div className="mt-4 grid gap-4">
          <label className="text-sm font-semibold">Scene<textarea className={input} value={draft.activity.image.scene} onChange={event => setDraft(value => ({ ...value, activity: value.activity && { ...value.activity, image: { ...value.activity.image, scene: event.target.value } } }))} /></label>
          {draft.activity.observedOutcome !== undefined && <label className="text-sm font-semibold">Observed outcome<textarea className={input} value={draft.activity.observedOutcome} onChange={event => setDraft(value => ({ ...value, activity: value.activity && { ...value.activity, observedOutcome: event.target.value, stages: value.activity.stages.map(stage => item.strategy === "cognitive conflict" && stage.id === "compare" ? { ...stage, text: `What we observed in the activity: ${event.target.value.trim()}\nHow did what we observed match or differ from your recorded prediction?` } : stage) } }))} /></label>}
          {draft.activity.image.panels?.map((panel, n) => <fieldset key={n} className="grid gap-3 rounded-lg border border-line p-3"><legend className="text-sm font-semibold">Image panel {n + 1}</legend>{(["description", "caption", "alt"] as const).map(field => <label key={field} className="text-sm">{field === "alt" ? "Image description for screen readers" : field === "caption" ? "Caption" : "Description"}<textarea aria-label={`Image panel ${n + 1} ${field}`} className={input} value={panel[field]} onChange={event => setDraft(value => ({ ...value, activity: value.activity && { ...value.activity, image: { ...value.activity.image, panels: value.activity.image.panels?.map((entry, i) => i === n ? { ...entry, [field]: event.target.value } : entry) } } }))} /></label>)}</fieldset>)}
          {draft.activity.analogyMapping && <fieldset className="grid gap-3 rounded-lg border border-line p-3"><legend className="text-sm font-semibold">Analogy mapping</legend>{(["target", "analogue"] as const).map(field => <label key={field} className="text-sm">{field === "target" ? "Target concept" : "Familiar comparison"}<textarea className={input} value={draft.activity!.analogyMapping![field]} onChange={event => setDraft(value => ({ ...value, activity: value.activity && { ...value.activity, analogyMapping: value.activity.analogyMapping && { ...value.activity.analogyMapping, [field]: event.target.value } } }))} /></label>)}
            {draft.activity.analogyMapping.correspondences.map((pair, n) => <div key={n} className="grid gap-2">{(["targetPart", "analoguePart", "relationship"] as const).map(field => <label key={field} className="text-sm">{field === "targetPart" ? "Concept part" : field === "analoguePart" ? "Comparison part" : "Relationship"}<textarea aria-label={`Mapping ${n + 1} ${field}`} className={input} value={pair[field]} onChange={event => setDraft(value => ({ ...value, activity: value.activity && { ...value.activity, analogyMapping: value.activity.analogyMapping && { ...value.activity.analogyMapping, correspondences: value.activity.analogyMapping.correspondences.map((entry, i) => i === n ? { ...entry, [field]: event.target.value } : entry) } } }))} /></label>)}</div>)}
          </fieldset>}
        </div></details>}
        <label className="flex items-start gap-3 rounded-lg bg-canvas p-3 text-sm"><input className="mt-1 accent-brand" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed the shared text and video and removed private class details. Other teachers may view and copy it.</label>
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button><button type="button" className={`${button} !border-brand !bg-brand !text-white hover:!bg-brand-dark`} disabled={busy || !confirmed || !draft.title.trim()} onClick={() => void share()}>{busy && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}{busy ? "Sharing…" : "Share video material"}</button></div>
    </dialog>
  </>;
}
