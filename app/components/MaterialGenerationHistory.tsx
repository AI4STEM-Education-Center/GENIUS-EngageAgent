"use client";
import { useEffect, useRef, useState } from "react";
import { galleryGenerationHistory, type MaterialGenerationHistory as History } from "@/lib/material-gallery-client";
import { GALLERY_TAG_LABELS, type GalleryScope } from "@/lib/material-gallery";

export default function MaterialGenerationHistory({ scope, id, copyId, revision }: { scope: GalleryScope; id?: string; copyId?: string; revision?: number }) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { setData(null); setError(""); setBusy(false); return () => request.current?.abort(); }, [id, copyId, revision, scope.classId, scope.assignmentId]);
  async function load() {
    if (busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    try { const value = await galleryGenerationHistory(scope, { id, copyId }, controller.signal); if (!controller.signal.aborted) setData(value); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Generation records could not load."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <details className="mt-3 rounded-lg border border-line p-3" onToggle={event => { if (event.currentTarget.open && !data && !busy && !error) void load(); }}>
    <summary className="cursor-pointer text-sm font-semibold">Generation history</summary>
    <p className="mt-2 text-xs text-mute">{copyId ? `Records for saved version ${revision || 1}. Save changes to include a new AI revision.` : "Records for this shared version."} Original inputs and later teacher-confirmed tags are kept separate. Private classroom inputs stay private.</p>
    {busy && <p role="status" className="mt-3 text-sm">Loading generation records…</p>}
    {error && <div role="alert" className="mt-3 text-sm"><p>{error}</p><button className="mt-2 font-semibold text-brand" onClick={() => void load()}>Retry generation records</button></div>}
    {data?.parts.map((part, index) => <section key={`${index}-${part.label}`} className="mt-4 border-t border-line pt-3">
      <h5 className="text-sm font-semibold">{part.label}</h5>
      {!part.records.length && <p className="mt-2 text-xs text-mute">Original generation was not recorded. No generation history has been inferred from later labels.</p>}
      {part.records.map((record, i) => <details key={record.id} className="mt-2 rounded-lg bg-canvas p-3">
        <summary className="cursor-pointer text-xs font-semibold">{i === 0 ? "Current asset" : "Earlier operation"} · {record.operation.replaceAll("-", " ")} · {record.model} · {new Date(record.capturedAt).toLocaleString()}</summary>
        <div className="mt-3 text-xs">
          <p className="font-semibold">{record.focus?.origin === "source-material" ? "Focus of the source material" : "Teaching focus at generation"}</p>
          {record.focus ? <ul className="mt-1 list-disc space-y-1 pl-4">{record.focus.items.map((item, index) =>
            <li key={index}>{item.id && <strong>{item.id} · </strong>}{item.label}</li>)}</ul>
            : <p className="mt-1 text-mute">Not recorded for this operation.</p>}
        </div>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">{Object.entries(record.tags).filter(([key]) => key !== "FOCUS_ITEMS" || !record.focus).map(([key, value]) => <div key={key}><dt className="font-semibold">{key === "FOCUS_ITEMS" ? "Retained focus tag" : GALLERY_TAG_LABELS[key] || key}</dt><dd className="mt-1 break-words text-mute">{value}</dd></div>)}</dl>
        <p className="mt-3 break-all text-xs text-mute">Record {record.id} · Input fingerprint {record.promptHash.slice(0, 16)}</p>
      </details>)}
      {part.incomplete && <p className="mt-2 text-xs text-mute">Earlier records are unavailable in this material’s retained history.</p>}
    </section>)}
  </details>;
}
