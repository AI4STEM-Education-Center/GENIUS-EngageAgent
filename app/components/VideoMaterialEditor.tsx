"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { parseMaterialActivity, type MaterialActivity } from "@/lib/material-activities";
import type { ContentItem } from "@/lib/types";

export type VideoMaterialEditorProps = {
  item: ContentItem;
  onChange: (updated: ContentItem) => void;
  disabled?: boolean;
  videoUrl?: string;
  imageUrl?: string;
};

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50";
const input = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm font-normal";
const hasControlCharacters = (value: string) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);

function TextField({ label, value, onChange, maxLength, rows = 3, readOnly = false }: {
  label: string; value: string; onChange: (value: string) => void; maxLength: number; rows?: number; readOnly?: boolean;
}) {
  return <label className="block text-sm font-semibold">{label}<textarea className={`${input} read-only:bg-canvas`} value={value} rows={rows} maxLength={maxLength} readOnly={readOnly} onChange={event => onChange(event.target.value)} /></label>;
}

/** Edits the class's saved text; the parent owns persistence, media and sending. */
export default function VideoMaterialEditor({ item, onChange, disabled, videoUrl, imageUrl }: VideoMaterialEditorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editingId = useRef<string | null>(null);
  const [draft, setDraft] = useState<ContentItem>(() => structuredClone(item));
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);

  // A mounted card can be reused when a teacher switches materials or classes.
  useEffect(() => {
    if (editingId.current !== null && editingId.current !== item.id) {
      dialog.current?.close();
      editingId.current = null;
    }
  }, [item.id]);

  function open() {
    setDraft(structuredClone(item));
    setError("");
    setSavedId(null);
    editingId.current = item.id;
    dialog.current?.showModal();
  }

  function updateActivity(update: (activity: MaterialActivity) => MaterialActivity) {
    setDraft(value => value.activity ? { ...value, activity: update(value.activity) } : value);
  }

  function updateOutcome(value: string) {
    updateActivity(activity => ({
      ...activity,
      observedOutcome: value,
      stages: activity.stages.map(stage => draft.strategy === "cognitive conflict" && stage.id === "compare"
        ? { ...stage, text: `What we observed in the activity: ${value.trim()}\nHow did what we observed match or differ from your recorded prediction?` }
        : stage),
    }));
  }

  function save() {
    if (disabled || editingId.current !== item.id) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || title.length > 160 || hasControlCharacters(title)) {
      setError("Enter a material title of 1–160 characters.");
      return;
    }
    if (!body || body.length > 16_000 || hasControlCharacters(body)) {
      setError("Enter activity text of 1–16,000 characters.");
      return;
    }
    const activity = draft.activity ? parseMaterialActivity(draft.activity, item.strategy) : undefined;
    if (draft.activity && !activity) {
      setError("Complete every stage title and text, observed outcome, image description and analogy mapping shown below before saving.");
      return;
    }
    // Preserve the parent's current identity, focus and provenance metadata.
    // Media lives separately and is never regenerated or replaced by this editor.
    onChange({ ...item, title, body,
      ...(draft.visualBrief !== undefined ? { visualBrief: draft.visualBrief } : {}),
      ...(activity ? { activity } : {}),
    });
    editingId.current = null;
    dialog.current?.close();
    setSavedId(item.id);
  }

  return <>
    <button type="button" className={`${button} mt-3`} disabled={disabled} onClick={open}><Pencil size={16} aria-hidden="true" />Edit material</button>
    {savedId === item.id && <p role="status" className="mt-2 text-sm text-ok">Changes saved to this class’s material. Send it to students when it is ready.</p>}
    <dialog ref={dialog} aria-label="Edit video material" onClose={() => { editingId.current = null; }} className="fixed inset-0 m-auto max-h-[90vh] w-[94vw] max-w-3xl overflow-auto rounded-2xl border border-line bg-white p-6 backdrop:bg-ink/50">
      <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-bold">Edit this class’s material</h3><button type="button" className={button} aria-label="Close material editor" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <p className="mt-3 text-sm leading-6 text-mute">Save your changes to this class’s copy. The Gallery original stays unchanged. Sending to students is a separate action.</p>
      <div className="mt-4 rounded-xl border border-line bg-canvas p-3">
        {videoUrl && <video aria-label="Video being adapted" src={videoUrl} poster={imageUrl} controls playsInline preload="metadata" className="max-h-72 w-full rounded-lg bg-ink" />}
        <p className="mt-2 text-sm text-mute">Text edits do not change the video or image. Preview the media to make sure it still matches your activity.</p>
      </div>
      <fieldset disabled={disabled} className="mt-5 grid min-w-0 gap-4">
        <label className="text-sm font-semibold">Material title<input className={input} value={draft.title} maxLength={160} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></label>
        <TextField label="Activity text" value={draft.body} maxLength={16_000} rows={4} onChange={body => setDraft(value => ({ ...value, body }))} />
        {draft.activity?.stages.map((stage, index) => {
          const isCompare = draft.strategy === "cognitive conflict" && stage.id === "compare";
          return <fieldset key={stage.id} className="grid gap-3 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-semibold">Stage {index + 1}</legend>
            <label className="text-sm font-semibold">Stage {index + 1} title<input className={input} maxLength={100} value={stage.title} onChange={event => updateActivity(activity => ({ ...activity, stages: activity.stages.map((entry, n) => n === index ? { ...entry, title: event.target.value } : entry) }))} /></label>
            <TextField label={`Stage ${index + 1} text`} value={stage.text} maxLength={1600} readOnly={isCompare} onChange={text => updateActivity(activity => ({ ...activity, stages: activity.stages.map((entry, n) => n === index ? { ...entry, text } : entry) }))} />
            {isCompare && <p className="text-xs text-mute">This comparison uses the observed outcome. Edit that outcome below to update this text.</p>}
          </fieldset>;
        })}
        {draft.activity?.observedOutcome !== undefined && <TextField label="Observed outcome" value={draft.activity.observedOutcome} maxLength={800} onChange={updateOutcome} />}
        {draft.visualBrief !== undefined && <TextField label="Video scene description" value={draft.visualBrief} maxLength={5000} onChange={visualBrief => setDraft(value => ({ ...value, visualBrief }))} />}
        {draft.activity && <details className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-sm font-semibold">Image descriptions and teaching details</summary>
          <div className="mt-4 grid gap-4">
            <TextField label="Scene description" value={draft.activity.image.scene} maxLength={5000} onChange={scene => updateActivity(activity => ({ ...activity, image: { ...activity.image, scene } }))} />
            {draft.activity.image.panels?.map((panel, index) => <fieldset key={index} className="grid gap-3 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold">Image panel {index + 1}</legend>
              {(["description", "caption", "alt"] as const).map(field => <TextField key={field} label={`Image panel ${index + 1} ${field === "alt" ? "screen reader description" : field}`} value={panel[field]} maxLength={field === "description" ? 1400 : field === "caption" ? 100 : 500} onChange={text => updateActivity(activity => ({ ...activity, image: { ...activity.image, panels: activity.image.panels?.map((entry, n) => n === index ? { ...entry, [field]: text } : entry) } }))} />)}
            </fieldset>)}
            {draft.activity.analogyMapping && <fieldset className="grid gap-3 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold">Analogy mapping</legend>
              {(["target", "analogue"] as const).map(field => <TextField key={field} label={field === "target" ? "Target concept" : "Familiar comparison"} value={draft.activity!.analogyMapping![field]} maxLength={250} onChange={text => updateActivity(activity => ({ ...activity, analogyMapping: activity.analogyMapping && { ...activity.analogyMapping, [field]: text } }))} />)}
              {draft.activity.analogyMapping.correspondences.map((pair, index) => <div key={index} className="grid gap-3 border-t border-line pt-3">
                {(["targetPart", "analoguePart", "relationship"] as const).map(field => <TextField key={field} label={`Mapping ${index + 1} ${field === "targetPart" ? "concept part" : field === "analoguePart" ? "comparison part" : "relationship"}`} value={pair[field]} maxLength={field === "relationship" ? 400 : 200} onChange={text => updateActivity(activity => ({ ...activity, analogyMapping: activity.analogyMapping && { ...activity.analogyMapping, correspondences: activity.analogyMapping.correspondences.map((entry, n) => n === index ? { ...entry, [field]: text } : entry) } }))} />)}
              </div>)}
            </fieldset>}
          </div>
        </details>}
      </fieldset>
      {error && <p role="alert" className="mt-4 text-sm text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" className={button} onClick={() => dialog.current?.close()}>Cancel</button><button type="button" className={`${button} !border-brand !bg-brand !text-white hover:!bg-brand-dark`} disabled={disabled} onClick={save}>Save changes</button></div>
    </dialog>
  </>;
}
