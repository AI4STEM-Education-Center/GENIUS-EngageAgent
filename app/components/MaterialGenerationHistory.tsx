"use client";
import { useEffect, useState } from "react";
import { galleryGenerationHistory, type MaterialGenerationHistory as History } from "@/lib/material-gallery-client";
import { GALLERY_TAG_LABELS, type GalleryScope } from "@/lib/material-gallery";

export function GenerationFocusDetails({ record }: { record: import("@/lib/generation-record").GenerationRecord }) {
  return <div className="mt-3 text-xs">
    <p className="font-semibold">{record.focus?.origin === "source-material" ? "Focus of the source material" : "Teaching focus at generation"}</p>
    {record.focus ? <ul className="mt-1 list-disc space-y-1 pl-4">{record.focus.items.map((item, index) =>
      <li key={index}>{item.id && <strong>{item.id} · </strong>}{item.label}</li>)}</ul>
      : <><p className="mt-1 text-mute">Not recorded for this operation.</p>
        {record.tags.FOCUS_ITEMS && <p className="mt-1 text-mute">Retained focus tag: {record.tags.FOCUS_ITEMS}</p>}</>}
  </div>;
}

export default function MaterialGenerationHistory({ scope, id, copyId, sourceCopyId, revision }: { scope: GalleryScope; id?: string; copyId?: string; sourceCopyId?: string; revision?: number }) {
  const [response, setResponse] = useState<{ key: string; data?: History; error?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { classId, assignmentId } = scope;
  const key = JSON.stringify([classId, assignmentId, id, copyId, sourceCopyId, revision, attempt]);
  const current = response?.key === key ? response : undefined;
  useEffect(() => {
    if (!open || current) return;
    const controller = new AbortController();
    galleryGenerationHistory({ classId, assignmentId }, { id, copyId, sourceCopyId }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResponse({ key, data }); })
      .catch(reason => {
        if (!controller.signal.aborted) setResponse({ key, error: reason instanceof Error ? reason.message : "Generation records could not load." });
      });
    return () => controller.abort();
  }, [open, current, key, id, copyId, sourceCopyId, classId, assignmentId]);
  return <details className="mt-3 rounded-lg border border-line p-3" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold">Generation history</summary>
    <p className="mt-2 text-xs text-mute">{copyId ? (revision ? `Records for saved version ${revision}.` : "Source records for this unsaved copy.") : "Records for this shared version."} Original inputs and later teacher-confirmed tags are kept separate. Private classroom inputs stay private.</p>
    {open && !current && <p role="status" className="mt-3 text-sm">Loading generation records…</p>}
    {current?.error && <div role="alert" className="mt-3 text-sm"><p>{current.error}</p><button className="mt-2 font-semibold text-brand" onClick={() => setAttempt(value => value + 1)}>Retry generation records</button></div>}
    {current?.data?.parts.map((part, index) => <section key={`${index}-${part.label}`} className="mt-4 border-t border-line pt-3">
      <h5 className="text-sm font-semibold">{part.label}</h5>
      {!part.records.length && <p className="mt-2 text-xs text-mute">Original generation was not recorded. No generation history has been inferred from later labels.</p>}
      {part.records.map((record, i) => <details key={record.id} className="mt-2 rounded-lg bg-canvas p-3">
        <summary className="cursor-pointer text-xs font-semibold">{i === 0 ? "Current asset" : "Earlier operation"} · {record.operation.replaceAll("-", " ")} · {record.model} · {new Date(record.capturedAt).toLocaleString()}</summary>
        <GenerationFocusDetails record={record} />
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">{Object.entries(record.tags).filter(([key]) => key !== "FOCUS_ITEMS").map(([key, value]) => <div key={key}><dt className="font-semibold">{GALLERY_TAG_LABELS[key] || key}</dt><dd className="mt-1 break-words text-mute">{value}</dd></div>)}</dl>
        <p className="mt-3 break-all text-xs text-mute">Record {record.id} · Input fingerprint {record.promptHash.slice(0, 16)}</p>
      </details>)}
      {part.incomplete && <p className="mt-2 text-xs text-mute">Earlier records are unavailable in this material’s retained history.</p>}
    </section>)}
  </details>;
}
