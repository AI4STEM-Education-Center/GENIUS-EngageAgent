"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scopedClientAuthHeaders } from "@/lib/client-auth";
import { activityContextParagraph, appendActivityContext, hasActivityContext, CLASSROOM_CONTEXT_LIMIT } from "@/lib/activity-context";
import type { TaskInterests } from "@/lib/task-interests";

type Props = {
  classId: string;
  assignmentId: string;
  context: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

export default function ActivityContextSuggestion({ classId, assignmentId, context, onChange, disabled = false }: Props) {
  const [interests, setInterests] = useState<TaskInterests | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const hasScope = Boolean(classId && assignmentId);

  const load = useCallback(async () => {
    const request = ++activeRequest.current;
    controller.current?.abort();
    setInterests(null);
    setError(null);
    if (!classId || !assignmentId) {
      setLoading(false);
      return;
    }
    const abortController = new AbortController();
    controller.current = abortController;
    setLoading(true);
    try {
      const response = await fetch(`/api/survey-analysis?${new URLSearchParams({ classId, assignmentId })}`, {
        headers: scopedClientAuthHeaders({ classId, assignmentId }),
        cache: "no-store",
        signal: abortController.signal,
      });
      const data = await response.json().catch(() => ({})) as { interests?: TaskInterests | null; error?: string };
      if (request !== activeRequest.current || abortController.signal.aborted) return;
      if (!response.ok) throw new Error(data.error ?? "The survey suggestion could not be loaded.");
      setInterests(data.interests ?? null);
    } catch (cause) {
      if (request !== activeRequest.current || abortController.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "The survey suggestion could not be loaded.");
    } finally {
      if (request === activeRequest.current && !abortController.signal.aborted) setLoading(false);
    }
  }, [classId, assignmentId]);

  useEffect(() => {
    void load();
    return () => {
      activeRequest.current += 1;
      controller.current?.abort();
    };
  }, [load]);

  const activity = interests?.enoughResponses ? interests.top[0] : undefined;
  const paragraph = interests && activity ? activityContextParagraph(interests, activity) : "";
  const added = Boolean(interests && activity && hasActivityContext(context, interests, activity));
  const nextContext = paragraph ? appendActivityContext(context, paragraph) : null;
  const remaining = Math.max(0, CLASSROOM_CONTEXT_LIMIT - context.length - (context ? 2 : 0));

  return (
    <section aria-label="Survey activity suggestion" className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Use this activity in your next generation? (optional)</h3>
          <p className="mt-1 text-sm text-slate-600">Use top activity adds survey details to the editable Classroom context below. They will be used the next time you select Generate materials. You can generate materials without adding this activity.</p>
        </div>
        {hasScope && !error && <button type="button" onClick={() => void load()} disabled={loading || disabled}
          className="shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50">
          Refresh suggestion
        </button>}
      </div>

      {loading && <p className="mt-3 text-sm text-slate-500">Checking this task&apos;s survey responses…</p>}
      {!loading && !hasScope && <p className="mt-3 text-sm text-slate-500">Open a class task to see its survey activity suggestion.</p>}
      {!loading && error && <div className="mt-3 flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-slate-600">{error} You can still enter classroom context and generate materials.</p>
        <button type="button" onClick={() => void load()} disabled={disabled}
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50">Retry</button>
      </div>}
      {!loading && !error && hasScope && !interests && <p className="mt-3 text-sm text-slate-500">No survey responses are available for this task yet. You can enter classroom context yourself.</p>}
      {!loading && !error && interests && !interests.enoughResponses && <p className="mt-3 text-sm text-slate-500">At least 3 students must submit the survey before an activity can be suggested. Current responses: {interests.responseCount}.</p>}
      {!loading && !error && interests?.enoughResponses && !activity && <p className="mt-3 text-sm text-slate-500">No clear activity was found in the submitted responses. You can enter classroom context yourself.</p>}

      {!loading && !error && interests?.stale && <p className="mt-3 text-sm font-medium text-amber-700">Last available analysis: newer responses could not be analyzed. Refresh the suggestion to try again.</p>}
      {!loading && !error && interests && activity && <div className="mt-3 space-y-2">
        <p className="text-xs font-medium text-slate-500">Survey topic: {interests.dailyExperienceTopic}</p>
        <p className="text-lg font-semibold text-slate-900">{activity.activity}</p>
        <p className="text-sm text-slate-600">{activity.studentCount} of {interests.responseCount} respondents mentioned it · {activity.doCount} do it · {activity.watchedCount} have watched it</p>
        {activity.objects.length > 0 && <p className="text-sm text-slate-600"><span className="font-medium">Reported objects:</span> {activity.objects.join(", ")}</p>}
        {activity.incidents[0] && <p className="text-sm text-slate-600"><span className="font-medium">Example from responses:</span> {activity.incidents[0]}</p>}
        <button type="button" disabled={disabled || added || nextContext === null}
          onClick={() => { if (!disabled && !added && nextContext !== null) onChange(nextContext); }}
          className="rounded-full bg-[#BA0C2F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9a0a27] disabled:cursor-not-allowed disabled:bg-slate-300">
          {added ? "Activity added" : "Use top activity (optional)"}
        </button>
        {added && <p className="text-xs text-slate-500">You can edit or remove the added paragraph in Classroom context below.</p>}
        {!added && nextContext === null && <p role="status" className="text-sm text-amber-700">There is not enough space to add this suggestion: it needs {paragraph.length} characters and {remaining} remain. Shorten the classroom context or add the relevant details yourself. Your existing text will be preserved.</p>}
      </div>}
    </section>
  );
}
