"use client";
import { useEffect, useRef, useState } from "react";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import type { GalleryScope } from "@/lib/material-gallery";
import { applySharingEdits, parseSharingEdits, sharingTextFields, type SharingEdit } from "@/lib/sharing-privacy";

export default function SharingPrivacyReview<T>({ scope, value, onApply, disabled }: { scope: GalleryScope; value: T; onApply(value: T): void; disabled?: boolean }) {
  const [edits, setEdits] = useState<SharingEdit[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const fields = sharingTextFields(value), signature = JSON.stringify(fields);
  async function check() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setEdits(null); setSnapshot(signature);
    try {
      const response = await fetch("/api/material-gallery/clean-sharing", { method: "POST", headers: { "Content-Type": "application/json", ...scopedClientAuthHeaders(scope) }, body: JSON.stringify({ ...scope, ...(!scope.classId ? { library: true } : {}), fields }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Text could not be checked. You can still review it manually.");
      const suggestions = parseSharingEdits(result.edits, fields);
      if (!controller.signal.aborted) { setEdits(suggestions); setSelected(suggestions.map(e => e.field)); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Text could not be checked."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-sm font-semibold">Remove class details · text assistance</summary>
    <p className="mt-2 text-xs text-mute">Review suggested changes before applying them to this shared copy. Images and video still need your review.</p>
    <button type="button" disabled={disabled || busy} onClick={() => void check()} className="mt-3 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">{busy ? "Checking shared text…" : "Suggest text cleanup"}</button>
    {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    {edits && signature !== snapshot && <p role="status" className="mt-2 text-sm text-warn">The text changed. Check it again for current suggestions.</p>}
    {edits && signature === snapshot && <>{!edits.length ? <p role="status" className="mt-2 text-sm">No text changes suggested. Please complete your own review before sharing.</p> : <>
      <ul className="mt-3 space-y-3">{edits.map(edit => <li key={edit.field} className="rounded-lg bg-canvas p-3 text-sm"><label className="flex gap-2"><input type="checkbox" checked={selected.includes(edit.field)} onChange={e => setSelected(current => e.target.checked ? [...current, edit.field] : current.filter(f => f !== edit.field))} /><span>{edit.reason}</span></label><p className="mt-2"><span className="font-semibold">Before: </span>{edit.before}</p><p className="mt-1"><span className="font-semibold">Suggested: </span>{edit.after}</p></li>)}</ul>
      <button type="button" disabled={disabled || !selected.length} onClick={() => { onApply(applySharingEdits(value, edits.filter(e => selected.includes(e.field)))); setEdits(null); }} className="mt-3 rounded-lg bg-ai px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Apply selected changes</button>
    </>}</>}
  </details>;
}
