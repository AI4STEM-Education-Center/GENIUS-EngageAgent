"use client";

import { useCallback, useEffect, useState } from "react";
import type { DailyExperienceSummary, RankedActivity } from "@/lib/daily-experience-analysis";

type Props = {
  classId: string;
  assignmentId: string;
  surveyId: string;
};

type AnalysisView = {
  analyzedAt: string;
  summary: DailyExperienceSummary;
};

type AnalysisResponse = { analysis: AnalysisView | null; submittedCount: number };

const RANK_LABELS = ["Most common", "Second most common"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function ActivityCard({ activity, rank }: { activity: RankedActivity; rank: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-slate-400">{RANK_LABELS[rank]}</p>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">
          {activity.category}
        </span>
      </div>
      <p className="text-lg font-semibold text-slate-900">{activity.activity}</p>
      <p className="text-sm text-slate-600">
        {plural(activity.studentCount, "student")} · {activity.doCount} do it · {activity.watchedCount} watched
      </p>
      {activity.objects.length > 0 && (
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-700">Objects: </span>
          {activity.objects.map((o) => o.name).join(", ")}
        </p>
      )}
      {activity.incidents[0] && (
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-700">Example moment: </span>
          {activity.incidents[0]}
        </p>
      )}
    </div>
  );
}

/**
 * Most and second-most common daily experiences in a survey's responses,
 * analyzed against the survey's DAILY EXPERIENCE TOPIC (#114). The teacher
 * runs the analysis on demand; the last result is saved and shown here.
 */
export default function ClassInterestsPanel({ classId, assignmentId, surveyId }: Props) {
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ classId, assignmentId, surveyId });
      const res = await fetch(`/api/survey-analysis?${q}`);
      if (res.ok) {
        const data = (await res.json()) as AnalysisResponse;
        setAnalysis(data.analysis);
        setSubmittedCount(data.submittedCount);
      }
    } catch {
      // Best-effort: the Analyze button still works if this fails.
    } finally {
      setLoading(false);
    }
  }, [classId, assignmentId, surveyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const analyze = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/survey-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, assignmentId, surveyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "The analysis could not be completed.");
      setAnalysis((data as AnalysisResponse).analysis);
      setSubmittedCount((data as AnalysisResponse).submittedCount);
    } catch (err) {
      // Keep showing the previous analysis, if any.
      setError(err instanceof Error ? err.message : "The analysis could not be completed.");
    } finally {
      setRunning(false);
    }
  };

  const summary = analysis?.summary;
  const newResponses = summary ? Math.max(submittedCount - summary.responseCount, 0) : 0;
  const others = summary?.enoughResponses ? summary.activities.slice(2) : [];

  return (
    <section aria-label="Class interests" className="mt-5 rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Class interests</p>
          <p className="text-sm text-slate-500">
            The most common activities in students&apos; answers, for personalizing materials.
          </p>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={running || loading || submittedCount === 0}
          className="rounded-xl bg-[#BA0C2F] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#8F0A25] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Analyzing…" : analysis ? "Re-analyze responses" : "Analyze responses"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      {!loading && !summary && !running && (
        <p className="mt-3 text-sm text-slate-500">
          {submittedCount === 0
            ? "Students haven't submitted this survey yet."
            : `${plural(submittedCount, "response")} ready to analyze.`}
        </p>
      )}

      {running && (
        <p className="mt-3 text-sm text-slate-500">Analyzing {plural(submittedCount, "response")}…</p>
      )}

      {summary && !summary.enoughResponses && (
        <p className="mt-3 text-sm text-slate-500">
          Not enough responses yet. The analysis needs at least 3 submitted responses.
        </p>
      )}

      {summary && summary.enoughResponses && summary.top.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">No clear activities were found in the responses.</p>
      )}

      {summary && summary.top.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {summary.top.map((activity, rank) => (
            <ActivityCard key={`${activity.category}-${activity.activity}`} activity={activity} rank={rank} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          <span className="font-semibold text-slate-700">Also mentioned: </span>
          {others.map((a) => `${a.activity} (${a.studentCount})`).join(", ")}
        </p>
      )}

      {summary && analysis && (
        <p className="mt-3 text-xs text-slate-400">
          Analyzed {formatWhen(analysis.analyzedAt)} from {plural(summary.responseCount, "response")}
          {summary.unclassifiedCount > 0 ? ` · ${summary.unclassifiedCount} with no clear activity` : ""}
          {newResponses > 0 && (
            <span className="font-semibold text-amber-600">
              {" "}· {plural(newResponses, "new response")} since this analysis
            </span>
          )}
        </p>
      )}
    </section>
  );
}
