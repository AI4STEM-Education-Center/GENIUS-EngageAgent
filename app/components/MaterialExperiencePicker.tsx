"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import type { TaskInterests } from "@/lib/task-interests";
import { focusForStrategy, type StrategyFocus } from "@/lib/strategy-focus";
import type { ExperienceSuggestions } from "@/lib/material-experiences";

type Props = { classId: string; assignmentId: string; lessonNumber: number; strategy: string; focus: StrategyFocus;
  contextRef?: string; interests: TaskInterests | null; value: string; missingSelection?: boolean; onChange(value: string, source?: "reported" | "ai_suggested" | "teacher_entered"): void; disabled?: boolean };
export default function MaterialExperiencePicker(props: Props) {
  const [suggestions, setSuggestions] = useState<ExperienceSuggestions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const scope = JSON.stringify([props.classId, props.assignmentId, props.lessonNumber, props.strategy, props.focus, props.contextRef, props.interests?.analyzedAt]);
  const autoScope = useRef("");
  useEffect(() => { setSuggestions(null); setError(""); setBusy(false); autoScope.current = ""; return () => request.current?.abort(); }, [scope]);
  async function suggest(refresh = false) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/material-experiences", { method: "POST", headers: { "Content-Type": "application/json", ...scopedClientAuthHeaders(props) },
        body: JSON.stringify({ contextRef: props.contextRef, refresh, classId: props.classId, assignmentId: props.assignmentId, lessonNumber: props.lessonNumber, strategy: props.strategy, focus: focusForStrategy(props.focus, props.strategy) }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Suggestions could not load. Try again.");
      if (!controller.signal.aborted) setSuggestions(data);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Suggestions could not load."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    if (!props.interests?.activities.length || props.disabled || autoScope.current === scope) return;
    autoScope.current = scope;
    void suggest();
    // A new task/focus/check-in version is the only automatic trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, props.disabled, props.interests?.activities.length]);
  const choice = (activity: string, count?: number, reason?: string, weak?: boolean) => <button key={activity} type="button" aria-pressed={props.value === activity}
    disabled={props.disabled || busy} onClick={() => props.onChange(props.value === activity ? "" : activity, count === undefined ? "ai_suggested" : "reported")} title={reason}
    className={`rounded-lg border px-3 py-2 text-sm ${props.value === activity ? "border-ai bg-ai text-white" : "border-line bg-white text-ink hover:bg-canvas"}`}>
    {activity}{count !== undefined && <span className="ml-2 opacity-70">{count}</span>}{weak && <span className="ml-2 rounded bg-warn-light px-1 text-xs text-warn">weak fit</span>}</button>;
  const selectedReason = suggestions?.suggestions.find(item => item.activity === props.value)?.reason || suggestions?.fit.find(item => item.activity === props.value)?.reason;
  return <section aria-label="Familiar experience" className="mt-4 rounded-xl border border-line bg-white p-5">
    <h3 className="font-semibold">{props.strategy === "analogy" ? "Familiar experience to compare it to" : "Everyday experience to build on"}</h3>
    <p className="mt-2 text-xs text-mute">From the experience check-in</p>
    {props.missingSelection && <div role="status" className="mt-2 rounded-lg bg-warn-light p-3 text-sm">Your selected experience “{props.value}” is from earlier check-in information. Choose a current experience or <button type="button" className="font-semibold underline" disabled={props.disabled} onClick={() => props.onChange(props.value, "teacher_entered")}>keep it as my own example</button>.</div>}
    {props.interests?.activities.length && !suggestions ? <p role="status" className="mt-2 text-xs text-mute">{busy ? "Checking how these experiences fit your selected concept…" : "Fit has not been checked. Use Suggest experiences to retry."}</p> : null}
    {suggestions && suggestions.fit.filter(item => item.fit === "good").length < 2 && <p role="status" className="mt-2 text-sm text-warn">Fewer than two reported experiences fit this concept well. Try an AI suggestion or write your own.</p>}
    {props.interests?.activities.length ? <div className="mt-2 flex flex-wrap gap-2">{props.interests.activities.slice(0, 12).map(item => {
      const fit = suggestions?.fit.find(result => result.activity === item.activity);
      return choice(item.activity, item.studentCount, fit?.reason, fit?.fit === "weak");
    })}</div> : <p className="mt-2 text-sm text-mute">No reported experiences available. Choose an AI suggestion or write your own.</p>}
    <div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-ai">AI suggestions</span>
      <button type="button" disabled={props.disabled || busy} onClick={() => void suggest(true)} className="inline-flex items-center gap-1 rounded-lg border border-ai-mid px-3 py-1.5 text-sm font-semibold text-ai disabled:opacity-50"><Sparkles size={14} />{busy ? "Finding experiences…" : suggestions ? "Refresh suggestions" : "Suggest experiences"}</button></div>
    {suggestions && <div className="mt-2 flex flex-wrap gap-2">{suggestions.suggestions.map(item => choice(item.activity, undefined, item.reason))}</div>}
    {selectedReason && <p className="mt-2 text-sm text-mute">{selectedReason}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    <label className="mt-4 block text-sm font-semibold">Write your own<input aria-label="Familiar experience" value={props.value} maxLength={160} disabled={props.disabled || busy} onChange={event => props.onChange(event.target.value, "teacher_entered")}
      placeholder="e.g. a ball bouncing off a goalpost" className="mt-1.5 block w-full rounded-lg border border-line px-3 py-2.5 font-normal" /></label>
    <p className="mt-2 text-xs text-mute">Used for this focus and carried into the material. AI suggestions are examples, not student survey results.</p>
  </section>;
}
