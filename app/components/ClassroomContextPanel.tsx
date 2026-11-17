"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import { contextSourceLabel, type ClassroomContextSnapshot } from "@/lib/classroom-context";

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
      if (!controller.signal.aborted) setState(s => ({ scope, loading: false, accepted: s.scope === scope && s.accepted && ![data.context.profile?.status, data.context.experiences?.status].includes("forbidden") ? s.accepted : data.context, candidate: data.context }));
    } catch (e) { if (!controller.signal.aborted) setState(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Class information could not load." })); }
  }, [classId, assignmentId, enabled, scope]);
  useEffect(() => { void refresh(); return () => request.current?.abort(); }, [refresh]);
  const current = state.scope === scope ? state : { scope, loading: true };
  return { ...current, refresh, accept: () => setState(s => ({ ...s, accepted: s.candidate })) };
}

export default function ClassroomContextPanel({ context, disabled, supplement }: { context: ReturnType<typeof useClassroomContext>; disabled?: boolean; supplement: string }) {
  const accepted = context.accepted;
  const changed = context.candidate && accepted && context.candidate.id !== accepted.id && ![context.candidate.profile.status, context.candidate.experiences.status].some(status => ["stale", "error", "forbidden"].includes(status));
  return <section aria-label="Class information" className="rounded-xl border border-line bg-white p-4 text-sm">
    <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">Class information</h4>
      <button type="button" className="font-semibold text-brand disabled:opacity-50" disabled={disabled || context.loading} onClick={() => void context.refresh()}>{context.loading ? "Updating…" : "Refresh"}</button></div>
    {context.error && <p role="alert" className="mt-2 text-bad">{context.error} Your additional context is unchanged.</p>}
    {accepted && <>
      {!accepted.geniusConnected && <p className="mt-2 text-mute">GENIUS data is not connected yet. Your EngageAgent class information is available below.</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{[["Class profile", accepted.profile], ["Experience check-in", accepted.experiences]].map(([label, raw]) => {
        const source = raw as ClassroomContextSnapshot["profile"];
        return <div key={String(label)}><p className="font-medium">{String(label)}</p><p className="text-mute">{contextSourceLabel(source)}</p>
          {source.updatedAt && <p className="text-xs text-mute">Updated {new Date(source.updatedAt).toLocaleString()}</p>}</div>;
      })}</div>
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
