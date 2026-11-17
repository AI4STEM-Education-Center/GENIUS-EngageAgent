"use client";

import { useEffect, useRef, useState } from "react";
import type { GalleryScope } from "@/lib/material-gallery";

type Props = { current?: GalleryScope; className?: string; taskTitle?: string; onClose(): void; onSend(scope: GalleryScope): Promise<void> };
const button = "min-h-10 rounded-lg border border-line px-4 py-2 text-sm font-semibold disabled:opacity-50";

/** Choosing a destination is separate from creating or editing a material. */
export default function SendMaterialDialog({ current, className, taskTitle, onClose, onSend }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const embedded = !!current?.classId && !current.classId.startsWith("ea-class-");
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([]);
  const [classId, setClassId] = useState(current?.classId || "");
  const [assignmentId, setAssignmentId] = useState(current?.assignmentId || "");
  const [loadingClasses, setLoadingClasses] = useState(!embedded);
  const [loadedClassId, setLoadedClassId] = useState("");
  const loading = !embedded && (loadingClasses || !!classId && loadedClassId !== classId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (embedded) return;
    const controller = new AbortController();
    fetch("/api/workspace", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load classes.");
      if (!controller.signal.aborted) setClasses(data.classes || []);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingClasses(false); });
    return () => controller.abort();
  }, [embedded]);
  useEffect(() => {
    if (embedded || !classId) return;
    const controller = new AbortController();
    fetch(`/api/workspace?${new URLSearchParams({ classId })}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load tasks.");
      if (!controller.signal.aborted) setTasks(data.assignments || []);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadedClassId(classId); });
    return () => controller.abort();
  }, [classId, embedded]);
  async function send() {
    if (busy || !classId || !assignmentId) return;
    setBusy(true); setError("");
    try { await onSend({ classId, assignmentId }); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to send. Please retry."); setBusy(false); }
  }
  const input = "mt-2 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm font-normal";
  return <dialog ref={dialog} aria-labelledby="send-material-heading" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="fixed inset-0 m-auto w-[94vw] max-w-lg rounded-2xl border border-line bg-white p-6 shadow-xl backdrop:bg-ink/50">
    <h2 id="send-material-heading" className="text-xl font-bold">Send to students</h2>
    <p className="mt-2 text-sm text-mute">Students receive this saved version. Your material stays in your library for reuse.</p>
    {embedded ? <p className="my-5 rounded-lg bg-canvas p-4 text-sm font-semibold">{className || "Current GENIUS class"} · {taskTitle || "Current task"}</p>
      : <div className="my-5 grid gap-4"><label className="text-sm font-semibold">Class<select className={input} value={classId} disabled={busy} onChange={event => { setClassId(event.target.value); setAssignmentId(""); setTasks([]); setLoadedClassId(""); setError(""); }}><option value="">Choose a class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Task<select className={input} value={assignmentId} disabled={!classId || loading || busy} onChange={event => setAssignmentId(event.target.value)}><option value="">Choose a task</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        {!loading && !classes.length && <p className="text-sm text-mute">Create a class and task in My class before sending. Your material can be saved here now.</p>}
      </div>}
    {error && <p role="alert" className="my-3 text-sm text-bad">{error}</p>}
    {loading && <p role="status" className="my-3 text-sm text-mute">Loading destinations…</p>}
    <div className="mt-5 flex justify-end gap-3"><button type="button" className={button} disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={`${button} border-brand bg-brand text-white`} disabled={busy || loading || !classId || !assignmentId} onClick={() => void send()}>{busy ? "Sending…" : "Send material"}</button></div>
  </dialog>;
}
