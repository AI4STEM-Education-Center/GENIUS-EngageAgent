"use client";

import { useEffect, useRef, useState } from "react";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import type { GalleryScope } from "@/lib/material-gallery";
import type { MaterialAdaptation } from "@/lib/material-teaching-context";
import type { ContentItem } from "@/lib/types";

export default function VideoAdaptation({ scope, item, adaptation, disabled, onChange, onBusyChange }: {
  scope: GalleryScope; item: ContentItem; adaptation?: MaterialAdaptation; disabled?: boolean;
  onChange: (item: ContentItem) => void; onBusyChange: (busy: boolean) => void;
}) {
  const request = useRef<AbortController | null>(null);
  const started = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<{ previous: ContentItem; result: ContentItem } | null>(null);
  const latest = useRef({ scope, item, adaptation, onChange, onBusyChange });
  latest.current = { scope, item, adaptation, onChange, onBusyChange };
  useEffect(() => () => { request.current?.abort(); request.current = null; latest.current.onBusyChange(false); }, []);
  async function adapt() {
    if (request.current) return;
    const { scope, item, adaptation, onChange, onBusyChange } = latest.current;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); onBusyChange(true); setError("");
    try {
      const response = await fetch("/api/material-gallery/adapt-video", { method: "POST", signal: controller.signal,
        headers: { ...scopedClientAuthHeaders(scope), "Content-Type": "application/json" },
        body: JSON.stringify({ ...scope, ...(!scope.classId && !scope.assignmentId ? { library: true } : {}), copyId: item.id.replace(/^gallery-copy-/u, ""), item,
          classroomContext: adaptation?.classroomContext ?? item.classroomContext ?? "", teachingContext: adaptation?.teachingContext ?? item.teachingContext }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to adapt the text. Your original is retained.");
      if (result.item?.id !== item.id || typeof result.item.body !== "string" || typeof result.item.title !== "string") throw new Error("The adapted text was incomplete. Your original is retained.");
      controller.signal.throwIfAborted();
      setUndo({ previous: item, result: result.item }); onChange(result.item);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to adapt this material."); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted) { setBusy(false); onBusyChange(false); } } }
  }
  useEffect(() => {
    if (!adaptation || started.current.has(adaptation.requestId)) return;
    const timer = setTimeout(() => { started.current.add(adaptation.requestId); void adapt(); }, 0);
    return () => clearTimeout(timer);
  }, [adaptation]);
  return <details open={!!adaptation || busy || !!error} className="my-4 rounded-lg border border-line p-3">
    <summary className="cursor-pointer text-sm font-semibold">Adapt with AI</summary>
    <p className="my-3 text-sm text-mute">Adjust the language and questions to your class. The video stays the same; review it alongside the adapted text.</p>
    <div className="flex flex-wrap gap-3"><button type="button" disabled={disabled || busy} onClick={() => void adapt()} className="min-h-10 rounded-lg border border-line px-3 text-sm font-semibold disabled:opacity-50">{busy ? "Adapting activity text…" : "Adapt activity text"}</button>
      {undo && undo.result === item && <button type="button" disabled={disabled || busy} onClick={() => { onChange(undo.previous); setUndo(null); }} className="text-sm font-semibold text-brand">Undo AI edit</button>}</div>
    {undo?.result === item && !busy && <p role="status" className="mt-3 text-sm text-ok">Activity text adapted. Review it, then save your copy.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
  </details>;
}
