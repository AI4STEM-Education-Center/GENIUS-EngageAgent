"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import { contextSourceLabel, type ClassroomContextSnapshot } from "@/lib/classroom-context";

// Refresh transport metadata automatically when the inputs are unchanged. A
// recovered connection is not a new teaching decision; changed facts still need
// the teacher's acceptance before they replace the generation context.
function sameInputs(a: ClassroomContextSnapshot, b: ClassroomContextSnapshot) {
  const inputs = (s: ClassroomContextSnapshot) => ({ classId: s.classId, assignmentId: s.assignmentId,
    geniusClassId: s.geniusClassId, geniusConnected: s.geniusConnected, summary: s.summary,
    sources: [s.profile, s.experiences].map(source => ({ provider: source.provider, version: source.version,
      updatedAt: source.updatedAt, value: source.value })) });
  // DynamoDB maps can return keys in a different order after a cached read.
  const encode = (s: ClassroomContextSnapshot) => JSON.stringify(inputs(s), (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
  return [b.profile.status, b.experiences.status].every(status => status === "ready" || status === "empty")
    && encode(a) === encode(b);
}

export function useClassroomContext(classId: string, assignmentId: string, enabled: boolean) {
  const scope = `${classId}:${assignmentId}`;
  const [state, setState] = useState<{ scope: string; accepted?: ClassroomContextSnapshot; candidate?: ClassroomContextSnapshot; loading: boolean; error?: string }>({ scope, loading: false });
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled || !classId || !assignmentId) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setState(s => ({ ...(s.scope === scope ? s : { scope }), loading: true }));
    try {
      const response = await fetch(`/api/classroom-context?${new URLSearchParams({ classId, assignmentId })}`, { headers: scopedClientAuthHeaders({ classId, assignmentId }), signal: controller.signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.context?.id) throw new Error(data.error || "Class information could not load.");
      if (!controller.signal.aborted) setState(s => {
        const accepted = s.scope === scope && s.accepted && s.accepted.geniusClassId === data.context.geniusClassId
          && ![data.context.profile?.status, data.context.experiences?.status].includes("forbidden")
          && !sameInputs(s.accepted, data.context) ? s.accepted : data.context;
        return { scope, loading: false, accepted, candidate: data.context };
      });
    } catch (e) { if (!controller.signal.aborted) setState(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Class information could not load." })); }
  }, [classId, assignmentId, enabled, scope]);
  useEffect(() => { void refresh(); return () => request.current?.abort(); }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    const timer = window.setInterval(update, 60_000);
    return () => { window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); window.clearInterval(timer); };
  }, [enabled, refresh]);
  const current = state.scope === scope ? state : { scope, loading: true };
  return { ...current, classId, assignmentId, refresh, accept: () => setState(s => ({ ...s, accepted: s.candidate })) };
}

function GeniusClassConnection({ context, disabled }: { context: ReturnType<typeof useClassroomContext>; disabled?: boolean }) {
  const [classes, setClasses] = useState<{ id: string; name: string }[] | null>(null);
  const [selected, setSelected] = useState(context.accepted?.geniusClassId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = { classId: context.classId, assignmentId: context.assignmentId };
  async function load() {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/classroom-context/link?${new URLSearchParams(scope)}`, { headers: scopedClientAuthHeaders(scope), cache: "no-store" });
      const data = await r.json(); if (!r.ok) throw new Error(data.error || "GENIUS classes could not load.");
      setClasses(data.classes); setSelected(data.selected || "");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/classroom-context/link", { method: "PUT", headers: { ...scopedClientAuthHeaders(scope), "Content-Type": "application/json" }, body: JSON.stringify({ ...scope, geniusClassId: selected || null }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error || "The class connection could not be saved.");
      await context.refresh(); setClasses(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="mt-3">
    <button type="button" disabled={disabled || busy} className="font-semibold text-brand disabled:opacity-50" onClick={() => void load()}>{busy ? "Connecting…" : context.accepted?.geniusClassId ? "Change connected class" : "Connect GENIUS class"}</button>
    {error && <p role="alert" className="mt-2 text-bad">{error}</p>}
    {classes && <div className="mt-2 space-y-2"><p className="text-mute">Choose the matching class you own in GENIUS. Its profile and experience totals will be used for this EngageAgent class.</p>
      <label className="block">GENIUS class<select className="mt-1 block w-full rounded-lg border border-line p-2" disabled={disabled || busy} value={selected} onChange={e => setSelected(e.target.value)}><option value="">Use EngageAgent class information</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {!classes.length && <p className="text-mute">No GENIUS classes belong to this account yet.</p>}
      <button type="button" disabled={disabled || busy} className="rounded-lg bg-brand px-3 py-2 text-white disabled:opacity-50" onClick={() => void save()}>Save connection</button>
    </div>}
  </div>;
}

export default function ClassroomContextPanel({ context, disabled, supplement }: { context: ReturnType<typeof useClassroomContext>; disabled?: boolean; supplement: string }) {
  const accepted = context.accepted;
  const changed = context.candidate && accepted && context.candidate.id !== accepted.id && ![context.candidate.profile.status, context.candidate.experiences.status].some(status => ["stale", "error", "forbidden"].includes(status));
  return <section aria-label="Class information" className="rounded-xl border border-line bg-white p-4 text-sm">
    <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">Class information</h4>
      <button type="button" className="font-semibold text-brand disabled:opacity-50" disabled={disabled || context.loading} onClick={() => void context.refresh()}>{context.loading ? "Updating…" : "Refresh"}</button></div>
    {context.error && <p role="alert" className="mt-2 text-bad">{context.error} Your additional context is unchanged.</p>}
    {accepted && <>
      {!accepted.geniusConnected && <p className="mt-2 text-mute">{accepted.canLinkGenius ? "This class uses EngageAgent information. Connect its GENIUS class to sync the class profile and experience check-in." : "GENIUS data is not connected yet. Your EngageAgent class information is available below."}</p>}
      {accepted.geniusManageUrl && <p className="mt-2 text-mute">Syncs when you open this task, return to it, and every minute. <a className="font-semibold text-brand" href={accepted.geniusManageUrl} target="_blank" rel="noreferrer">Edit class information in GENIUS</a></p>}
      {accepted.canLinkGenius && <GeniusClassConnection key={`${context.classId}:${accepted.geniusClassId || "local"}`} context={context} disabled={disabled} />}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{[["Class profile", accepted.profile], ["Experience check-in", accepted.experiences]].map(([label, raw]) => {
        const source = raw as ClassroomContextSnapshot["profile"];
        return <div key={String(label)}><p className="font-medium">{String(label)}</p><p className="text-mute">{contextSourceLabel(source)}</p>
          {source.updatedAt && <p className="text-xs text-mute">Updated {new Date(source.updatedAt).toLocaleString()}</p>}</div>;
      })}</div>
      {accepted.experiences.value && <p className="mt-2 text-mute">{accepted.experiences.value.responseCount} student responses · {accepted.experiences.value.activities.length} reported activities</p>}
      <details className="mt-3"><summary className="cursor-pointer font-medium">Context used for generation</summary>
        <p className="mt-2 whitespace-pre-wrap text-mute">{[accepted.summary, supplement].filter(Boolean).join("\n\n") || "No class summary supplied. The lesson and your teaching choices will be used."}</p>
        <p className="mt-2 text-xs text-mute">Your selected grade, focus and familiar experience are included too.</p></details>
    </>}
    {context.candidate && [context.candidate.profile.status, context.candidate.experiences.status].some(status => status === "stale" || status === "error") && <p role="alert" className="mt-3 text-warn">The latest class information could not be loaded. Any displayed information is from the last successful update. Your additional context is unchanged.</p>}
    {changed && <div role="status" className="mt-3 rounded-lg bg-brand-light p-3"><p>New class information is available. Your additional context and existing materials will stay unchanged.</p>
      <p className="mt-1 text-xs">Experience responses: {accepted?.experiences.value?.responseCount ?? "unknown"} → {context.candidate?.experiences.value?.responseCount ?? "unknown"}{context.candidate?.profile.updatedAt ? ` · Updated ${new Date(context.candidate.profile.updatedAt).toLocaleString()}` : ""}</p>
      <button type="button" disabled={disabled} onClick={context.accept} className="mt-2 font-semibold text-brand">Use updated information</button></div>}
  </section>;
}
